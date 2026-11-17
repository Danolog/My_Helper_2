/**
 * #193 P5a-1, decyzja CTO 4: `waiting-list.ts` bez puli `db`.
 *
 * - `acceptEarlierSlot` / `declineEarlierSlot` (token, bez sesji salonu): salon
 *   ustalany wyłącznie przez wyjście `resolveWaitingListToken(token)`; każdy
 *   odczyt i zapis (wizyta, status wpisu, notyfikacja) idzie przez
 *   `forSalon(salonId z wyniku)`. Token nieznany albo wskazujący inny wpis →
 *   odmowa bez żadnego zapisu.
 * - `notifyWaitingList`: wszystko przez `forSalon(params.salonId)`, odczyt
 *   wpisów z warunkiem `waiting_list.salon_id = params.salonId`; push dopiero
 *   po zamknięciu callbacku bramy.
 * - `system/waiting-list.ts`: tylko odczyt, kolumny id i salon_id, dopasowanie
 *   równościowe po tokenie, pusty token = null bez zapytania.
 *
 * Pula `db` i `dbSystem` rzucają przy każdym użyciu poza wyjściem — powrót do
 * nich w bibliotece daje czerwony test.
 */
import { eq } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";
import { waitingList } from "@/lib/schema";
import { createChainMock } from "../api/helpers";

const h = vi.hoisted(() => {
  const throwingPool = (name: string) =>
    new Proxy(
      {},
      {
        get: () => {
          throw new Error(`${name} użyte poza bramą salonu`);
        },
      }
    );
  return {
    throwingPool,
    resolve: vi.fn(),
    calc: vi.fn(),
    push: vi.fn(),
    tx: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
    gate: { salonIds: [] as string[], depth: 0, pushDepths: [] as number[] },
    sys: {
      selectCalls: 0,
      cols: [] as unknown[],
      where: [] as unknown[],
      limit: [] as unknown[],
      rows: [] as unknown[],
    },
  };
});

vi.mock("@/lib/db", () => ({ db: h.throwingPool("db") }));
vi.mock("@/lib/server/system/db-system", () => ({
  dbSystem: {
    select: (cols: unknown) => {
      h.sys.selectCalls++;
      h.sys.cols.push(cols);
      return {
        from: () => ({
          where: (w: unknown) => {
            h.sys.where.push(w);
            return {
              limit: async (n: unknown) => {
                h.sys.limit.push(n);
                return h.sys.rows;
              },
            };
          },
        }),
      };
    },
    insert: () => {
      throw new Error("dbSystem.insert w system/waiting-list.ts");
    },
    update: () => {
      throw new Error("dbSystem.update w system/waiting-list.ts");
    },
    delete: () => {
      throw new Error("dbSystem.delete w system/waiting-list.ts");
    },
  },
}));
vi.mock("@/lib/server/system", () => ({
  resolveWaitingListToken: (...a: unknown[]) => h.resolve(...a),
}));
vi.mock("@/lib/server/repository", () => ({
  forSalon: (salonId: string) => ({
    salonId,
    raw: async (fn: (tx: unknown) => unknown) => {
      h.gate.salonIds.push(salonId);
      h.gate.depth++;
      try {
        return await fn(h.tx);
      } finally {
        h.gate.depth--;
      }
    },
  }),
}));
vi.mock("@/lib/push", () => ({
  sendPushNotification: (...a: unknown[]) => {
    h.gate.pushDepths.push(h.gate.depth);
    return h.push(...a);
  },
}));
vi.mock("@/lib/sms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sms")>()),
  sendSms: vi.fn(),
}));
vi.mock("@/lib/deposit-calculation", () => ({ calculateExpectedDeposit: (...a: unknown[]) => h.calc(...a) }));
// Stan modułów salonu (przełącznik przy wysyłce) — lista oczekujących włączona.
vi.mock("@/lib/server/modules", async () => {
  const { resolveModules } = await vi.importActual<typeof import("@/lib/features")>("@/lib/features");
  return { getSalonModules: async () => resolveModules({ modules: { waitingList: true } }) };
});

import { acceptEarlierSlot, declineEarlierSlot, notifyWaitingList } from "@/lib/waiting-list";

const SALON_A = "salon-A";
const SALON_B = "salon-B";
const START = new Date(Date.now() + 2 * 86_400_000);
START.setUTCSeconds(0, 0);
const END = new Date(START.getTime() + 3_600_000);

function entry(extra: Record<string, unknown> = {}) {
  return {
    id: "wl-A",
    salonId: SALON_A,
    clientId: "client-A",
    serviceId: "service-A",
    preferredEmployeeId: null,
    offeredEmployeeId: "emp-A",
    existingAppointmentId: null,
    acceptToken: "tok-A",
    accepted: null,
    offeredStartTime: START,
    offeredEndTime: END,
    ...extra,
  };
}

const dialect = new PgDialect();
const render = (w: unknown) => {
  const q = dialect.sqlToQuery(w as Parameters<PgDialect["sqlToQuery"]>[0]);
  return { sql: q.sql, params: q.params };
};

beforeEach(() => {
  vi.clearAllMocks();
  h.tx.select.mockReset();
  h.tx.insert.mockReset();
  h.tx.update.mockReset();
  h.tx.insert.mockReturnValue(createChainMock([{ id: "new-row" }]));
  h.tx.update.mockReturnValue(createChainMock([]));
  h.calc.mockResolvedValue({ ok: true, required: false, amount: 0, serviceName: "X" });
  h.resolve.mockImplementation(async (token: string) =>
    token === "tok-A" ? { waitingListId: "wl-A", salonId: SALON_A } : token === "tok-B" ? { waitingListId: "wl-B", salonId: SALON_B } : null
  );
  h.gate.salonIds = [];
  h.gate.depth = 0;
  h.gate.pushDepths = [];
  h.sys = { selectCalls: 0, cols: [], where: [], limit: [], rows: [] };
});

describe("acceptEarlierSlot: salon z tokenu, zapisy przez forSalon", () => {
  it("token nieznany → odmowa, brak bramy i zapisu", async () => {
    const res = await acceptEarlierSlot("wl-A", "nieznany");

    expect(res).toEqual({ success: false, message: "Nieprawidlowy token akceptacji" });
    expect(h.resolve).toHaveBeenCalledWith("nieznany");
    expect(h.gate.salonIds).toEqual([]);
    expect(h.tx.insert).not.toHaveBeenCalled();
    expect(h.tx.update).not.toHaveBeenCalled();
  });

  it("token salonu B z id wpisu salonu A → odmowa, dane A bez zmian", async () => {
    const res = await acceptEarlierSlot("wl-A", "tok-B");

    expect(res).toEqual({ success: false, message: "Nieprawidlowy token akceptacji" });
    expect(h.gate.salonIds).toEqual([]);
    expect(h.tx.insert).not.toHaveBeenCalled();
    expect(h.tx.update).not.toHaveBeenCalled();
  });

  it("happy path: każdy odczyt i zapis w forSalon(salon z tokenu)", async () => {
    h.tx.select.mockReturnValueOnce(createChainMock([entry()])).mockReturnValueOnce(createChainMock([]));

    const res = await acceptEarlierSlot("wl-A", "tok-A");

    expect(res).toMatchObject({ success: true, appointmentId: "new-row" });
    // odczyt wpisu, kolizja, insert wizyty, accepted, notyfikacja
    expect(h.gate.salonIds).toEqual([SALON_A, SALON_A, SALON_A, SALON_A, SALON_A]);
    expect(h.tx.insert).toHaveBeenCalledTimes(2);
    expect(h.tx.update).toHaveBeenCalledTimes(1);
    expect(h.calc).toHaveBeenCalledWith(expect.objectContaining({ salonId: SALON_A }));
  });

  it("przeniesienie istniejącej wizyty: update wizyty i wpisu w forSalon(salon z tokenu)", async () => {
    h.tx.select
      .mockReturnValueOnce(createChainMock([entry({ existingAppointmentId: "apt-A" })]))
      .mockReturnValueOnce(createChainMock([]))
      .mockReturnValueOnce(createChainMock([{ id: "apt-A", status: "scheduled", startTime: END, notes: null }]));

    const res = await acceptEarlierSlot("wl-A", "tok-A");

    expect(res).toMatchObject({ success: true, appointmentId: "apt-A" });
    expect(new Set(h.gate.salonIds)).toEqual(new Set([SALON_A]));
    expect(h.tx.update).toHaveBeenCalledTimes(2);
  });

  it("zadatek wymagany (#63) → odmowa, brak zapisu wizyty i wpisu", async () => {
    h.calc.mockResolvedValue({ ok: true, required: true, amount: 50, serviceName: "X" });
    h.tx.select.mockReturnValueOnce(createChainMock([entry()])).mockReturnValueOnce(createChainMock([]));

    const res = await acceptEarlierSlot("wl-A", "tok-A");

    expect(res.success).toBe(false);
    expect(h.tx.insert).not.toHaveBeenCalled();
    expect(h.tx.update).not.toHaveBeenCalled();
  });
});

describe("declineEarlierSlot: salon z tokenu, zapis przez forSalon", () => {
  it("token nieznany → odmowa, brak bramy i zapisu", async () => {
    const res = await declineEarlierSlot("wl-A", "nieznany");

    expect(res).toEqual({ success: false, message: "Nieprawidlowy token" });
    expect(h.gate.salonIds).toEqual([]);
    expect(h.tx.update).not.toHaveBeenCalled();
  });

  it("token salonu B z id wpisu salonu A → odmowa, brak zapisu", async () => {
    const res = await declineEarlierSlot("wl-A", "tok-B");

    expect(res).toEqual({ success: false, message: "Nieprawidlowy token" });
    expect(h.gate.salonIds).toEqual([]);
    expect(h.tx.update).not.toHaveBeenCalled();
  });

  it("happy path: odczyt i zapis w forSalon(salon z tokenu)", async () => {
    h.tx.select.mockReturnValueOnce(createChainMock([entry()]));

    const res = await declineEarlierSlot("wl-A", "tok-A");

    expect(res).toEqual({ success: true, message: "Termin zostal odrzucony." });
    expect(h.gate.salonIds).toEqual([SALON_A, SALON_A]);
    expect(h.tx.update).toHaveBeenCalledTimes(1);
  });
});

describe("notifyWaitingList: forSalon(params.salonId), push poza callbackiem", () => {
  const params = {
    salonId: SALON_A,
    serviceId: null,
    employeeId: null,
    startTime: START,
    endTime: END,
    serviceName: "Usługa",
    employeeName: "Anna",
    salonName: "Salon A",
  };

  it("odczyt wpisów z warunkiem salon_id = params.salonId, zapisy w tym samym salonie", async () => {
    const entries = createChainMock([
      { entry: entry({ notifiedAt: null }), client: { id: "client-A", firstName: "Jan", lastName: "K", email: "jan@example.com" } },
    ]);
    h.tx.select
      .mockReturnValueOnce(entries)
      .mockReturnValueOnce(createChainMock([{ id: "user-A" }]));
    h.push.mockResolvedValue({ success: true, sent: 1, failed: 0 });

    const res = await notifyWaitingList(params);

    expect(res).toMatchObject({ notified: 1, pushCount: 1, errors: 0 });
    expect(new Set(h.gate.salonIds)).toEqual(new Set([SALON_A]));
    const where = render((entries.where as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    const salonCond = render(eq(waitingList.salonId, SALON_A));
    expect(where.sql).toContain(salonCond.sql);
    expect(where.params).toContain(SALON_A);
    expect(h.tx.update).toHaveBeenCalledTimes(1);
  });

  it("push wysyłany poza otwartym callbackiem bramy", async () => {
    h.tx.select
      .mockReturnValueOnce(
        createChainMock([
          { entry: entry(), client: { id: "client-A", firstName: "Jan", lastName: "K", email: "jan@example.com" } },
        ])
      )
      .mockReturnValueOnce(createChainMock([{ id: "user-A" }]));
    h.push.mockResolvedValue({ success: true, sent: 1, failed: 0 });

    await notifyWaitingList(params);

    expect(h.gate.pushDepths).toEqual([0]);
  });

  it("błąd odczytu wpisów → errors = 1, brak zapisu, log tylko z nazwą klasy błędu", async () => {
    h.tx.select.mockImplementationOnce(() => {
      throw new Error("odczyt");
    });
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => {});

    const res = await notifyWaitingList(params);

    expect(res.errors).toBe(1);
    expect(h.tx.update).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith("Failed to notify waiting list", { errorName: "Error" });
    errorLog.mockRestore();
  });
});

/**
 * Kontrakt `raw()` (repository.ts): każde zapytanie do tabeli z salon_id ma jawne
 * `eq(<tabela>.salonId, <salon bramy>)`, nie tylko RLS. W accept/decline jedynym
 * źródłem salonu jest wynik tokenu (`target.salonId`), nie `entry.salonId`.
 * Fikstura wpisu ma celowo inny `salonId` (OTHER), żeby wykryć drugie źródło.
 */
describe("jawny warunek salonu w każdym zapytaniu raw (kontrakt repository.ts)", () => {
  const OTHER = "salon-OTHER";
  type ChainT = ReturnType<typeof createChainMock>;

  /** Czy warunek zawiera `"<tabela>"."salon_id" = $n` z parametrem `salon`. */
  function salonCond(chain: ChainT | undefined, table: string, salon: string): boolean {
    const w = (chain?.where as ReturnType<typeof vi.fn> | undefined)?.mock.calls[0]?.[0];
    return condHasSalon(w, table, salon);
  }
  /** Czy warunek złączenia (drugi argument `innerJoin`) zawiera `"<tabela>"."salon_id" = $n` z `salon`. */
  function joinSalonCond(chain: ChainT | undefined, table: string, salon: string): boolean {
    const w = (chain?.innerJoin as ReturnType<typeof vi.fn> | undefined)?.mock.calls[0]?.[1];
    return condHasSalon(w, table, salon);
  }
  function condHasSalon(w: unknown, table: string, salon: string): boolean {
    if (!w) return false;
    const q = render(w);
    const re = new RegExp(`"${table}"\\."salon_id" = \\$(\\d+)`, "g");
    for (const m of q.sql.matchAll(re)) {
      if (q.params[Number(m[1]) - 1] === salon) return true;
    }
    return false;
  }
  function recordWrites() {
    const updates: ChainT[] = [];
    const inserted: Record<string, unknown>[] = [];
    h.tx.update.mockImplementation(() => {
      const c = createChainMock([]);
      updates.push(c);
      return c;
    });
    h.tx.insert.mockImplementation(() => {
      const c = createChainMock([{ id: "new-row" }]);
      c.values = vi.fn((v: Record<string, unknown>) => (inserted.push(v), c));
      return c;
    });
    return { updates, inserted };
  }

  it("accept, przeniesienie: odczyt wpisu, odczyt i update wizyty, update accepted — warunek salonu z tokenu", async () => {
    const w = recordWrites();
    const entryRead = createChainMock([entry({ salonId: OTHER, existingAppointmentId: "apt-A" })]);
    const overlap = createChainMock([]);
    const apptRead = createChainMock([{ id: "apt-A", status: "scheduled", startTime: END, notes: null }]);
    h.tx.select.mockReturnValueOnce(entryRead).mockReturnValueOnce(overlap).mockReturnValueOnce(apptRead);

    const res = await acceptEarlierSlot("wl-A", "tok-A");

    expect(res.success).toBe(true);
    expect(salonCond(entryRead, "waiting_list", SALON_A), "odczyt wpisu").toBe(true);
    expect(salonCond(overlap, "appointments", SALON_A), "kolizja: salon z tokenu").toBe(true);
    expect(salonCond(overlap, "appointments", OTHER), "kolizja: nie entry.salonId").toBe(false);
    expect(salonCond(apptRead, "appointments", SALON_A), "odczyt wizyty").toBe(true);
    expect(w.updates).toHaveLength(2);
    expect(salonCond(w.updates[0], "appointments", SALON_A), "update wizyty").toBe(true);
    expect(salonCond(w.updates[1], "waiting_list", SALON_A), "update accepted").toBe(true);
    expect(w.inserted).toEqual([expect.objectContaining({ salonId: SALON_A })]); // notyfikacja
  });

  it("accept, nowa wizyta: insert wizyty i notyfikacji oraz zadatek z salonem z tokenu", async () => {
    const w = recordWrites();
    h.tx.select
      .mockReturnValueOnce(createChainMock([entry({ salonId: OTHER })]))
      .mockReturnValueOnce(createChainMock([]));

    const res = await acceptEarlierSlot("wl-A", "tok-A");

    expect(res.success).toBe(true);
    expect(w.inserted).toEqual([
      expect.objectContaining({ salonId: SALON_A, status: "scheduled" }),
      expect.objectContaining({ salonId: SALON_A, type: "sms" }),
    ]);
    expect(salonCond(w.updates[0], "waiting_list", SALON_A), "update accepted").toBe(true);
    expect(h.calc).toHaveBeenCalledWith(expect.objectContaining({ salonId: SALON_A }));
  });

  it("decline: odczyt wpisu i update accepted z warunkiem salonu z tokenu", async () => {
    const w = recordWrites();
    const entryRead = createChainMock([entry({ salonId: OTHER })]);
    h.tx.select.mockReturnValueOnce(entryRead);

    const res = await declineEarlierSlot("wl-A", "tok-A");

    expect(res.success).toBe(true);
    expect(salonCond(entryRead, "waiting_list", SALON_A), "odczyt wpisu").toBe(true);
    expect(salonCond(w.updates[0], "waiting_list", SALON_A), "update accepted").toBe(true);
  });

  it("notify: update notifiedAt z warunkiem salonu params.salonId", async () => {
    const w = recordWrites();
    h.tx.select
      .mockReturnValueOnce(
        createChainMock([
          { entry: entry(), client: { id: "client-A", firstName: "Jan", lastName: "K", email: "jan@example.com" } },
        ])
      )
      .mockReturnValueOnce(createChainMock([{ id: "user-A" }]));
    h.push.mockResolvedValue({ success: true, sent: 1, failed: 0 });

    await notifyWaitingList({
      salonId: SALON_A,
      serviceId: null,
      employeeId: null,
      startTime: START,
      endTime: END,
      serviceName: "U",
      employeeName: "E",
      salonName: "S",
    });

    expect(w.updates).toHaveLength(1);
    expect(salonCond(w.updates[0], "waiting_list", SALON_A), "update notifiedAt").toBe(true);
  });

  it("notify: złączenie klientów z warunkiem clients.salon_id = salon bramy", async () => {
    const entriesRead = createChainMock([]);
    h.tx.select.mockReturnValueOnce(entriesRead);

    await notifyWaitingList({
      salonId: SALON_A,
      serviceId: null,
      employeeId: null,
      startTime: START,
      endTime: END,
      serviceName: "U",
      employeeName: "E",
      salonName: "S",
    });

    expect(salonCond(entriesRead, "waiting_list", SALON_A), "odczyt wpisów").toBe(true);
    expect(joinSalonCond(entriesRead, "clients", SALON_A), "złączenie klientów").toBe(true);
  });

  it("notify: odczyt wpisów tylko z potwierdzoną prośbą klienta (warunek w SQL zapytania)", async () => {
    const entriesRead = createChainMock([]);
    h.tx.select.mockReturnValueOnce(entriesRead);

    await notifyWaitingList({
      salonId: SALON_A,
      serviceId: "service-A",
      employeeId: "emp-A",
      startTime: START,
      endTime: END,
      serviceName: "U",
      employeeName: "E",
      salonName: "S",
    });

    const w = (entriesRead.where as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(w, "warunek WHERE odczytu wpisów").toBeDefined();
    expect(render(w).sql).toContain('"waiting_list"."client_request_confirmed_at" is not null');
    expect(salonCond(entriesRead, "waiting_list", SALON_A), "odczyt wpisów").toBe(true);
  });
});

/**
 * Jedno miejsce odczytu konta klienta (tabela kont) w module: funkcja
 * `findVerifiedLinkedUserId`. Każde inne odwołanie do tabeli kont w
 * `waiting-list.ts` = czerwony; zamiana na wyjście systemowe ma być wymianą
 * w jednym miejscu.
 */
describe("waiting-list.ts: odczyt konta klienta tylko w findVerifiedLinkedUserId", () => {
  it("jedno odwołanie do tabeli kont, wewnątrz findVerifiedLinkedUserId", async () => {
    const { readFileSync } = await vi.importActual<typeof import("node:fs")>("node:fs");
    const src = readFileSync(`${process.cwd()}/src/lib/waiting-list.ts`, "utf8");

    const refs = [...src.matchAll(/\.from\(\s*user\s*\)/g)].map((m) => m.index!);
    expect(refs, "odwołania .from(user)").toHaveLength(1);

    const fnStart = src.indexOf("async function findVerifiedLinkedUserId(");
    expect(fnStart, "funkcja findVerifiedLinkedUserId").toBeGreaterThanOrEqual(0);
    // koniec funkcji: pierwsza linia z samym "}" (LF albo CRLF)
    const rel = src.slice(fnStart).search(/\r?\n\}\r?\n/);
    const fnEnd = rel < 0 ? -1 : fnStart + rel;
    expect(fnEnd, "koniec funkcji").toBeGreaterThan(fnStart);
    expect(src.slice(fnStart, fnEnd), "odczyt wewnątrz funkcji").toMatch(/\.from\(\s*user\s*\)/);
  });
});

describe("system/waiting-list.ts: resolveWaitingListToken (tylko odczyt)", () => {
  async function load() {
    vi.resetModules();
    vi.doUnmock("@/lib/server/system");
    return import("@/lib/server/system/waiting-list");
  }

  it("dopasowanie równościowe po tokenie, tylko id i salon_id, limit 1", async () => {
    const mod = await load();
    h.sys.rows = [{ waitingListId: "wl-A", salonId: SALON_A }];

    expect(await mod.resolveWaitingListToken("tok-A")).toEqual({ waitingListId: "wl-A", salonId: SALON_A });
    expect(Object.keys(h.sys.cols[0] as object).sort()).toEqual(["salonId", "waitingListId"]);
    expect(render(h.sys.where[0])).toEqual(render(eq(waitingList.acceptToken, "tok-A")));
    expect(h.sys.limit).toEqual([1]);
  });

  it("token nieistniejący → null", async () => {
    const mod = await load();
    h.sys.rows = [];

    expect(await mod.resolveWaitingListToken("nieznany")).toBeNull();
  });

  it("pusty token → null bez zapytania", async () => {
    const mod = await load();

    expect(await mod.resolveWaitingListToken("")).toBeNull();
    expect(h.sys.selectCalls).toBe(0);
  });
});
