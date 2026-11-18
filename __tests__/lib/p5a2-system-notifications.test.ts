/**
 * #193 P5a-2: crony przypomnień (push 1h, push 24h, SMS) i `reminders/appointment`
 * idą przez wyjścia `system/notifications.ts` (pula systemowa), nie przez pulę
 * żądań. Crony są celowo cross-salon (sekret crona, nie sesja).
 *
 * `reminders/appointment` (decyzja A): `?salonId=` to filtr danych wołającego
 * crona. DoD: bez sekretu → 401, zły UUID → 400 (oba bez zapytania), z salonId
 * → zapytanie ma warunek `"appointments"."salon_id" = salonId`, bez salonId →
 * bez warunku salonu (oba salony). Odczyt kończy się przed wysyłką SMS.
 *
 * Podgląd (GET) czyta jednego salonu przez bramę `forSalon(salonId).raw`.
 *
 * `dbSystem` i transakcja bramy to prawdziwe budowniczy zapytań drizzle
 * (`pg-proxy`) zapisujące SQL i parametry osobno; pula `db` rzuca przy użyciu.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRequest, parseResponse } from "../api/helpers";

const h = vi.hoisted(() => {
  const throwingPool = (name: string) =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return undefined;
          throw new Error(`${name} użyte w trasie systemowej (${String(prop)})`);
        },
      }
    );
  return {
    throwingPool,
    captured: [] as Array<{ sql: string; params: unknown[] }>,
    /** Zapytania w transakcji bramy salonu i salonId każdego wywołania `forSalon`. */
    gateCaptured: [] as Array<{ sql: string; params: unknown[] }>,
    forSalonCalls: [] as string[],
    rows: [] as Array<[RegExp, unknown[][]]>,
    sendSms: vi.fn(),
    sendReminderSms: vi.fn(),
    push1h: vi.fn(),
    push24h: vi.fn(),
    /** Liczba zapytań w chwili każdego wywołania wysyłki. */
    queriesAtSend: [] as number[],
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    /** Zapytanie puli systemowej pasujące do wzorca rzuca błąd z treścią SQL i parametrami. */
    throwOn: null as RegExp | null,
  };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: (...a: unknown[]) => h.debug(...a),
    info: (...a: unknown[]) => h.info(...a),
    warn: (...a: unknown[]) => h.warn(...a),
    error: (...a: unknown[]) => h.error(...a),
  },
}));

vi.mock("@/lib/db", () => ({ db: h.throwingPool("db") }));
// Brama salonu: `raw` dostaje budowniczego pg-proxy zapisującego SQL osobno od puli systemowej.
vi.mock("@/lib/server/repository", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const tx = drizzle(async (sql: string, params: unknown[]) => {
    h.gateCaptured.push({ sql, params });
    return { rows: [] };
  });
  return {
    forSalon: (salonId: string) => {
      h.forSalonCalls.push(salonId);
      return { salonId, raw: <T,>(fn: (t: typeof tx) => Promise<T>) => fn(tx) };
    },
  };
});
vi.mock("@/lib/server/system/db-system", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return {
    dbSystem: drizzle(async (sql: string, params: unknown[]) => {
      h.captured.push({ sql, params });
      if (h.throwOn?.test(sql)) {
        throw Object.assign(new Error(`zapytanie nieudane: ${sql} ${JSON.stringify(params)}`), { code: "57014" });
      }
      const hit = h.rows.find(([re]) => re.test(sql));
      return { rows: hit ? hit[1] : [] };
    }),
  };
});
vi.mock("@/lib/sms", async (orig) => ({
  SMS_TIME_ZONE: (await orig<typeof import("@/lib/sms")>()).SMS_TIME_ZONE,
  SMS_PROVIDER_UNAVAILABLE_ERROR: (await orig<typeof import("@/lib/sms")>()).SMS_PROVIDER_UNAVAILABLE_ERROR,
  smsProviderUnavailablePlatform: () => null,
  sendSms: (...a: unknown[]) => {
    h.queriesAtSend.push(h.captured.length);
    return h.sendSms(...a);
  },
  sendAppointmentReminderSms: (...a: unknown[]) => h.sendReminderSms(...a),
}));
vi.mock("@/lib/push", () => ({
  sendAppointmentReminderPush: (...a: unknown[]) => h.push1h(...a),
  sendAppointmentReminder24hPush: (...a: unknown[]) => h.push24h(...a),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

import * as push1h from "@/app/api/cron/push-reminders/route";
import * as push24h from "@/app/api/cron/push-reminders-24h/route";
import * as smsReminders from "@/app/api/cron/sms-reminders/route";
import * as reminders from "@/app/api/reminders/appointment/route";

const SALON_A = "00000000-0000-4000-8000-00000000000a";
const SECRET = "test-cron-secret";
const START = "2026-11-17 10:00:00";

const req = (path: string, method: "GET" | "POST", secret: string | null = SECRET) =>
  createMockRequest(`http://localhost${path}`, {
    method,
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

const salonParamIndexes = (q: { sql: string; params: unknown[] }) =>
  [...q.sql.matchAll(/"appointments"\."salon_id" = \$(\d+)/g)].map((m) => Number(m[1]));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  h.captured.length = 0;
  h.gateCaptured.length = 0;
  h.forSalonCalls.length = 0;
  h.queriesAtSend.length = 0;
  h.rows = [];
  h.throwOn = null;
  h.sendSms.mockResolvedValue({ success: true });
  h.sendReminderSms.mockResolvedValue({ success: true });
  h.push1h.mockResolvedValue({ success: true, sent: 1 });
  h.push24h.mockResolvedValue({ success: true, sent: 1 });
});

describe("crony przypomnień przez pulę systemową", () => {
  const pushRow = ["appt-1", START, SALON_A, "Salon A", "c-1", "Ala", "Nowak", "user-1", "Ewa", "Kowal", "Strzyżenie"];

  it.each([
    ["push 1h", push1h.POST, h.push1h, "reminder_push_1h_sent_at"],
    ["push 24h", push24h.POST, h.push24h, "reminder_push_sent_at"],
  ] as const)("%s POST: odczyt, oznaczenie, subskrypcje, wysyłka", async (_n, POST, send, flag) => {
    h.rows = [
      [/^select .* from "appointments"/, [pushRow]],
      [/from "push_subscriptions"/, [["user-1"]]],
    ];
    const { status, body } = await parseResponse(await POST(req("/api/cron/x", "POST")));
    expect(status, JSON.stringify(body)).toBe(200);
    // wybór, zliczenie pominiętych, oznaczenie, subskrypcje
    expect(h.captured).toHaveLength(4);
    expect(h.captured[1]!.sql).toMatch(/^select count\(\*\) from "appointments"/);
    expect(h.captured[2]!.sql).toMatch(new RegExp(`^update "appointments" set "${flag}"`));
    expect(h.captured[2]!.sql).toMatch(/where "appointments"\."id" in \(\$\d+\)/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["push 1h", push1h.GET],
    ["push 24h", push24h.GET],
  ] as const)("%s GET ?status=1: dwa odczyty przez pulę systemową", async (_n, GET) => {
    const { status } = await parseResponse(await GET(req("/api/cron/x?status=1", "GET")));
    expect(status).toBe(200);
    expect(h.captured).toHaveLength(2);
  });

  it("SMS POST: odczyt, oznaczenie, wysyłka", async () => {
    h.rows = [[/^select .* from "appointments"/, [["appt-1", START, SALON_A, "Salon A", "c-1", "Ala", "Nowak", "+48500100200", "Ewa", "Kowal", null]]]];
    const { status, body } = await parseResponse(await smsReminders.POST(req("/api/cron/sms-reminders", "POST")));
    expect(status, JSON.stringify(body)).toBe(200);
    expect(h.captured).toHaveLength(3);
    expect(h.captured[1]!.sql).toMatch(/^select count\(\*\) from "appointments"/);
    expect(h.captured[2]!.sql).toMatch(/^update "appointments" set "reminder_1h_sent_at"/);
    expect(h.sendReminderSms).toHaveBeenCalledTimes(1);
  });

  it("SMS GET ?status=1: jeden odczyt przez pulę systemową", async () => {
    const { status } = await parseResponse(await smsReminders.GET(req("/api/cron/sms-reminders?status=1", "GET")));
    expect(status).toBe(200);
    expect(h.captured).toHaveLength(1);
  });

  it.each([
    ["push 1h", push1h.POST],
    ["push 24h", push24h.POST],
    ["SMS", smsReminders.POST],
  ] as const)("%s bez sekretu → 401 bez zapytania", async (_n, POST) => {
    const res = await POST(req("/api/cron/x", "POST", null));
    expect(res.status).toBe(401);
    expect(h.captured).toEqual([]);
  });
});

describe("reminders/appointment: filtr salonu wołającego crona (decyzja A)", () => {
  const row = ["appt-1", START, "2026-11-17 11:00:00", SALON_A, "c-1", "s-1", "e-1", "scheduled", "Ala", "Nowak", "+48500100200", "Salon A", "Strzyżenie", "Ewa", "Kowal"];

  it("POST bez sekretu → 401 bez zapytania", async () => {
    const res = await reminders.POST(req("/api/reminders/appointment", "POST", null));
    expect(res.status).toBe(401);
    expect(h.captured).toEqual([]);
  });

  it.each([
    ["POST", () => reminders.POST(req("/api/reminders/appointment?salonId=abc", "POST"))],
    // Podany, ale pusty salonId nie może zamienić filtra jednego salonu w przebieg po wszystkich.
    ["POST z pustym salonId", () => reminders.POST(req("/api/reminders/appointment?salonId=", "POST"))],
    ["GET", () => reminders.GET(req("/api/reminders/appointment?salonId=abc", "GET"))],
    ["GET bez salonId", () => reminders.GET(req("/api/reminders/appointment", "GET"))],
  ] as const)("%s ze złym albo brakującym salonId → 400 bez zapytania", async (_n, call) => {
    const res = await call();
    expect(res.status).toBe(400);
    expect(h.captured).toEqual([]);
    expect(h.forSalonCalls).toEqual([]);
    expect(h.gateCaptured).toEqual([]);
  });

  it("POST z salonId → odczyt z warunkiem salonu, wysyłka po odczycie, potem oznaczenie", async () => {
    h.rows = [[/^select .* from "appointments"/, [row]]];
    const { status, body } = await parseResponse(await reminders.POST(req(`/api/reminders/appointment?salonId=${SALON_A}`, "POST")));
    expect(status, JSON.stringify(body)).toBe(200);
    expect(h.captured).toHaveLength(3);
    const sel = h.captured[0]!;
    expect(salonParamIndexes(sel).some((n) => sel.params[n - 1] === SALON_A), sel.sql).toBe(true);
    // zliczenie pominiętych też z filtrem salonu
    const cnt = h.captured[1]!;
    expect(cnt.sql).toMatch(/^select count\(\*\) from "appointments"/);
    expect(salonParamIndexes(cnt).some((n) => cnt.params[n - 1] === SALON_A), cnt.sql).toBe(true);
    expect(h.queriesAtSend).toEqual([2]);
    expect(h.captured[2]!.sql).toMatch(/^update "appointments" set "reminder_sent_at"/);
  });

  it("POST bez salonId → odczyt bez warunku salonu (wszystkie salony)", async () => {
    const { status } = await parseResponse(await reminders.POST(req("/api/reminders/appointment", "POST")));
    expect(status).toBe(200);
    expect(h.captured).toHaveLength(2);
    expect(h.captured[1]!.sql).not.toMatch(/"appointments"\."salon_id" = \$\d+/);
    // Join po `"appointments"."salon_id" = "salons"."id"` zostaje; brak tylko warunku z parametrem.
    expect(h.captured[0]!.sql).not.toMatch(/"appointments"\."salon_id" = \$\d+/);
    expect(h.captured[0]!.sql).toMatch(/"appointments"\."salon_id" = "salons"\."id"/);
  });

  it("GET z salonId → podgląd przez bramę salonu (forSalon), z warunkiem salonu; pula systemowa nieużyta", async () => {
    const { status } = await parseResponse(await reminders.GET(req(`/api/reminders/appointment?salonId=${SALON_A}`, "GET")));
    expect(status).toBe(200);
    expect(h.forSalonCalls).toEqual([SALON_A]);
    expect(h.captured).toEqual([]);
    expect(h.gateCaptured).toHaveLength(1);
    const sel = h.gateCaptured[0]!;
    expect(salonParamIndexes(sel).some((n) => sel.params[n - 1] === SALON_A), sel.sql).toBe(true);
  });
});

/**
 * Złączenia wyboru przypomnień: `ON` każdej tabeli złączonej z wizytą (klient,
 * pracownik, usługa) to dokładnie klucz złączenia `and` warunek
 * `<tabela>.salon_id = appointments.salon_id` — nic więcej; salon jest złączony
 * wyłącznie po `appointments.salon_id = salons.id` (tabela `salons` nie ma
 * `salon_id`). Jedna asercja porównuje pełną treść czterech `ON`, więc brak
 * klucza, brak warunku salonu albo inny łącznik niż `and` daje czerwony wynik.
 */
const JOINED = ["clients", "employees", "services"] as const;

/** Treść `ON` złączenia tabeli (do następnego złączenia albo `where`). */
function joinOn(sql: string, table: string): string | null {
  const m = sql.match(new RegExp(`join "${table}" on (.*?)(?= (?:left |inner )?join | where | limit |$)`));
  return m ? m[1]! : null;
}

function joinOnClauses(sql: string) {
  const out: Record<string, string | null> = {};
  for (const t of [...JOINED, "salons"]) out[t] = joinOn(sql, t);
  return out;
}

const EXPECTED_ON = {
  clients: `("appointments"."client_id" = "clients"."id" and "clients"."salon_id" = "appointments"."salon_id")`,
  employees: `("appointments"."employee_id" = "employees"."id" and "employees"."salon_id" = "appointments"."salon_id")`,
  services: `("appointments"."service_id" = "services"."id" and "services"."salon_id" = "appointments"."salon_id")`,
  salons: `"appointments"."salon_id" = "salons"."id"`,
};

describe("wyjścia przypomnień: jawny warunek salonu w złączeniach", () => {
  it.each([
    ["push 1h (findDuePushReminders)", () => push1h.POST(req("/api/cron/x", "POST"))],
    ["push 24h (findDuePushReminders)", () => push24h.POST(req("/api/cron/x", "POST"))],
    ["SMS 1h (findDueSmsReminders)", () => smsReminders.POST(req("/api/cron/sms-reminders", "POST"))],
    ["SMS 24h (findDueAppointmentReminders)", () => reminders.POST(req("/api/reminders/appointment", "POST"))],
  ] as const)("%s: każde złączenie z kluczem i warunkiem salonu połączonymi przez and", async (_n, call) => {
    const res = await call();
    expect(res.status).toBe(200);
    const sel = h.captured[0]!;
    expect(sel.sql).toMatch(/^select .* from "appointments"/);
    expect(joinOnClauses(sel.sql), sel.sql).toEqual(EXPECTED_ON);
  });

  it("SMS 24h (findDueAppointmentReminders): złączenia zewnętrzne, warunek salonu tylko w ON — wiersz wizyty zostaje", async () => {
    const res = await reminders.POST(req("/api/reminders/appointment", "POST"));
    expect(res.status).toBe(200);
    const sql = h.captured[0]!.sql;
    for (const t of [...JOINED, "salons"]) expect(sql, t).toMatch(new RegExp(`left join "${t}" on `));
    expect(sql).not.toMatch(/inner join/);
    const where = sql.slice(sql.indexOf(" where "));
    for (const t of JOINED) expect(where, t).not.toMatch(new RegExp(`"${t}"\\.`));
  });

  it("SMS 24h: klient spoza salonu wizyty (puste kolumny klienta po złączeniu) → pominięty bez wysyłki", async () => {
    // Wiersz po złączeniu zewnętrznym z niespełnionym warunkiem salonu: kolumny klienta NULL.
    h.rows = [
      [/^select .* from "appointments"/, [["appt-x", START, "2026-11-17 11:00:00", SALON_A, "c-obcy", "s-1", "e-1", "scheduled", null, null, null, "Salon A", null, null, null]]],
    ];
    const { status, body } = await parseResponse<{ data: { results: Array<Record<string, unknown>> } }>(
      await reminders.POST(req("/api/reminders/appointment", "POST"))
    );
    expect(status).toBe(200);
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(body.data.results).toEqual([
      { appointmentId: "appt-x", clientName: "Nieznany", success: false, error: "Brak numeru telefonu klienta" },
    ]);
  });

  it("podgląd SMS 24h (GET przez bramę): każde złączenie z kluczem i warunkiem salonu połączonymi przez and", async () => {
    const res = await reminders.GET(req(`/api/reminders/appointment?salonId=${SALON_A}`, "GET"));
    expect(res.status).toBe(200);
    const sel = h.gateCaptured[0]!;
    expect(sel, "podgląd ma iść przez bramę salonu").toBeDefined();
    expect(joinOnClauses(sel.sql), sel.sql).toEqual(EXPECTED_ON);
  });
});

/**
 * Log pominiętych: osobne zliczenie wizyt w tym samym oknie, odsianych przez
 * warunek salonu w złączeniu. Jedna linia warn na przebieg, tylko gdy liczba > 0,
 * w treści wyłącznie rodzaj przypomnienia i liczba.
 */
describe("wyjścia przypomnień: log wizyt pominiętych przez warunek salonu", () => {
  const COUNT_RE = /^select count\(\*\) from "appointments"/;
  const pushRow = ["appt-1", START, SALON_A, "Salon A", "c-1", "Ala", "Nowak", "user-1", "Ewa", "Kowal", "Strzyżenie"];
  const smsRow = ["appt-1", START, SALON_A, "Salon A", "c-1", "Ala", "Nowak", "+48500100200", "Ewa", "Kowal", null];
  const row24 = ["appt-1", START, "2026-11-17 11:00:00", SALON_A, "c-1", "s-1", "e-1", "scheduled", "Ala", "Nowak", "+48500100200", "Salon A", "Strzyżenie", "Ewa", "Kowal"];

  const CASES = [
    ["push1h", () => push1h.POST(req("/api/cron/x", "POST")), pushRow],
    ["push24h", () => push24h.POST(req("/api/cron/x", "POST")), pushRow],
    ["sms1h", () => smsReminders.POST(req("/api/cron/sms-reminders", "POST")), smsRow],
    ["sms24h", () => reminders.POST(req("/api/reminders/appointment", "POST")), row24],
  ] as const;

  /** Wiersze: najpierw zliczenie (kolejność ma znaczenie — wybór też zaczyna się od `select`). */
  const withCount = (countRows: unknown[][], mainRow: readonly unknown[]): Array<[RegExp, unknown[][]]> => [
    [COUNT_RE, countRows],
    [/^select .* from "appointments"/, [[...mainRow]]],
    [/from "push_subscriptions"/, [["user-1"]]],
  ];

  /** Treść `where` wyboru (bez `limit`) — warunek okna i stanu wizyty. */
  const whereOf = (sql: string) => sql.slice(sql.indexOf(" where ") + 7).replace(/ limit \$\d+$/, "");

  it.each(CASES)("%s: zliczenie z tym samym warunkiem okna i tymi samymi parametrami co wybór", async (_k, call, mainRow) => {
    h.rows = withCount([[0]], mainRow);
    expect((await call()).status).toBe(200);
    const sel = h.captured[0]!;
    const cnt = h.captured.find((q) => COUNT_RE.test(q.sql));
    expect(cnt, "brak zapytania zliczającego").toBeDefined();
    const due = whereOf(sel.sql);
    expect(cnt!.sql, `${cnt!.sql}\n--- warunek wyboru:\n${due}`).toContain(due);
    for (const m of due.matchAll(/\$(\d+)/g)) {
      const i = Number(m[1]) - 1;
      expect(cnt!.params[i], `parametr $${i + 1}`).toEqual(sel.params[i]);
    }
    // bez grupowania (jedna liczba na przebieg)
    expect(cnt!.sql).not.toMatch(/group by/);
  });

  it.each(CASES)("%s: liczba > 0 → dokładnie jedna linia warn z rodzajem i liczbą, bez danych wizyty", async (kind, call, mainRow) => {
    h.rows = withCount([[3]], mainRow);
    expect((await call()).status).toBe(200);
    expect(h.warn).toHaveBeenCalledTimes(1);
    const [msg, ctx] = h.warn.mock.calls[0]!;
    expect(typeof msg).toBe("string");
    // toStrictEqual: także klucz z wartością `undefined` (np. dopisane id) jest czerwony.
    expect(ctx).toStrictEqual({ reminder: kind, skipped: 3 });
    const logged = JSON.stringify(h.warn.mock.calls);
    for (const v of ["appt-1", "c-1", "e-1", "s-1", "user-1", SALON_A, "Ala", "Nowak", "Ewa", "Kowal", "+48500100200", "Salon A"]) {
      expect(logged, v).not.toContain(v);
    }
  });

  it.each(CASES)("%s: liczba 0 → brak linii", async (_k, call, mainRow) => {
    h.rows = withCount([[0]], mainRow);
    expect((await call()).status).toBe(200);
    expect(h.warn).not.toHaveBeenCalled();
  });

  it.each(CASES)("%s: wynik zliczenia nie jest liczbą (brak wiersza, tekst, null) → brak linii", async (_k, call, mainRow) => {
    for (const countRows of [[], [["abc"]], [[null]]] as unknown[][][]) {
      h.warn.mockClear();
      h.captured.length = 0;
      h.rows = withCount(countRows, mainRow);
      expect((await call()).status).toBe(200);
      expect(h.warn, JSON.stringify(countRows)).not.toHaveBeenCalled();
    }
  });

  const FAIL_CASES = [
    ["push1h", () => push1h.POST(req("/api/cron/x", "POST")), pushRow, h.push1h, "reminder_push_1h_sent_at"],
    ["push24h", () => push24h.POST(req("/api/cron/x", "POST")), pushRow, h.push24h, "reminder_push_sent_at"],
    ["sms1h", () => smsReminders.POST(req("/api/cron/sms-reminders", "POST")), smsRow, h.sendReminderSms, "reminder_1h_sent_at"],
    ["sms24h", () => reminders.POST(req("/api/reminders/appointment", "POST")), row24, h.sendSms, "reminder_sent_at"],
  ] as const;

  it.each(FAIL_CASES)(
    "%s: zliczenie rzuca błąd → 200, wysyłka i oznaczenie wykonane, jedna linia logu tylko z rodzajem",
    async (kind, call, mainRow, send, flag) => {
      h.rows = withCount([[0]], mainRow);
      h.throwOn = COUNT_RE;
      const { status, body } = await parseResponse(await call());
      expect(status, JSON.stringify(body)).toBe(200);
      const cnt = h.captured.find((q) => COUNT_RE.test(q.sql));
      expect(cnt, "brak zapytania zliczającego").toBeDefined();
      expect(send).toHaveBeenCalledTimes(1);
      const mark = h.captured.find((q) => q.sql.startsWith(`update "appointments" set "${flag}"`));
      expect(mark, `brak oznaczenia ${flag}`).toBeDefined();
      expect(mark!.params).toContain("appt-1");

      expect(h.error).not.toHaveBeenCalled();
      expect(h.warn).toHaveBeenCalledTimes(1);
      const [msg, ctx] = h.warn.mock.calls[0]!;
      expect(typeof msg).toBe("string");
      expect(ctx).toStrictEqual({ reminder: kind });

      // Linia o nieudanym zliczeniu: bez danych wizyty i bez parametrów zapytania.
      const warned = JSON.stringify(h.warn.mock.calls);
      const forbidden = ["appt-1", "c-1", "e-1", "s-1", "user-1", SALON_A, "Ala", "Nowak", "Ewa", "Kowal", "+48500100200", "Salon A"];
      for (const v of [...forbidden, ...cnt!.params.map(String)]) {
        expect(warned, v).not.toContain(v);
      }
      // Treść błędu (SQL i parametry) nie trafia do logu na żadnym poziomie.
      const allLogs = JSON.stringify([h.debug, h.info, h.warn, h.error].map((f) => f.mock.calls));
      for (const v of ["zapytanie nieudane", "select count"]) {
        expect(allLogs, v).not.toContain(v);
      }
    }
  );

  it("push1h/push24h/sms1h: liczone niezgodny klient LUB pracownik; sms24h: tylko niezgodny klient", async () => {
    h.rows = withCount([[0]], pushRow);
    await push1h.POST(req("/api/cron/x", "POST"));
    const cron = h.captured.find((q) => COUNT_RE.test(q.sql))!.sql;
    expect(cron).toMatch(/"clients"\."salon_id" <> "appointments"\."salon_id" or "employees"\."salon_id" <> "appointments"\."salon_id"/);

    h.captured.length = 0;
    h.rows = withCount([[0]], row24);
    await reminders.POST(req("/api/reminders/appointment", "POST"));
    const d24 = h.captured.find((q) => COUNT_RE.test(q.sql))!.sql;
    expect(d24).toMatch(/"clients"\."salon_id" <> "appointments"\."salon_id"/);
    expect(d24).not.toMatch(/"employees"\."salon_id" <>/);
    expect(d24).not.toMatch(/"services"\."salon_id" <>/);
  });
});
