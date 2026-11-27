/**
 * Automatyczna blokada rezerwacji online w POST /api/appointments/[id]/no-show.
 *
 * Próg z `salons.settingsJson.noShowAutoBlockThreshold` (1, 2, 3, null = wyłączony).
 * Blokada zapisuje się w tej samej transakcji co oznaczenie „Nie przyszedł”.
 * Cofnięcie (DELETE) blokady nie zdejmuje.
 *
 * Kolejność wyników txRows w transakcji POST:
 *   [wizyta], [update wizyty], [próg salonu], [karty FOR NO KEY UPDATE w kolejności id],
 *   potem dla każdej karty: [licznik no_show], [update karty RETURNING] (tylko po progu).
 * Wizyta z kartą: jedna karta, ta z wizyty. Wizyta online (bez karty): karty
 * salonu ze zweryfikowanym e-mailem konta rezerwującego (reguła blokady, bez
 * telefonu; telefon liczy tylko licznik na karcie) — dopasowanie robi baza, więc tu
 * sprawdzamy kształt zapytań; działanie na danych dowodzi test pg
 * (__tests__/pg/no-show-online-auto-block.pg.test.ts).
 *
 * Mockowane tylko krawędzie z salon-staff-harness; forSalon prawdziwe.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DELETE, POST } from "@/app/api/appointments/[id]/no-show/route";
import { SALON_A } from "./salon-staff-harness";
import type { SQL } from "drizzle-orm";

const h = await vi.hoisted(async () => {
  const m = (await import("./salon-staff-harness")).createSalonStaffMocks();
  const selectWheres: unknown[] = [];
  const setArgs: Record<string, unknown>[] = [];
  const lockModes: string[] = [];
  const orderBys: unknown[][] = [];
  /**
   * failSelectNo: numer odczytu w transakcji (od 1), który odrzuca baza;
   * failCode: kod SQLSTATE tego błędu (pusty = błąd bez kodu).
   */
  const state = { transactions: 0, failSelectNo: 0, failCode: "" };

  type Tx = Parameters<Parameters<typeof m.db.transaction>[0]>[0];
  type Chain = Record<string, (...args: unknown[]) => unknown>;
  const db = {
    transaction: (fn: (tx: Tx) => unknown) => {
      state.transactions += 1;
      let selects = 0;
      return Promise.resolve(
        m.db.transaction((tx) =>
          fn({
            ...tx,
            select: () => {
              selects += 1;
              const chain = tx.select() as Chain;
              if (selects === state.failSelectNo) {
                const error = Object.assign(new Error("deadlock detected"), state.failCode ? { code: state.failCode } : {});
                chain.then = (_resolve: unknown, reject: unknown) =>
                  Promise.reject(error).catch(reject as (e: unknown) => unknown);
              }
              chain.where = (w: unknown) => {
                selectWheres.push(w);
                return chain;
              };
              chain.for = (mode: unknown) => {
                lockModes.push(String(mode));
                return chain;
              };
              chain.orderBy = (...columns: unknown[]) => {
                orderBys.push(columns);
                return chain;
              };
              return chain;
            },
            update: () => {
              const chain = tx.update() as Chain;
              chain.set = (v: unknown) => {
                setArgs.push(v as Record<string, unknown>);
                return chain;
              };
              return chain;
            },
          })
        )
      );
    },
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { m, selectWheres, setArgs, lockModes, orderBys, state, db, logger };
});

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: h.m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: h.m.dbSystem }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: h.m.hasTemporaryAccess }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));

const { m } = h;
const dialect = new PgDialect();

const APPT_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-27T12:00:00.000Z");
const YESTERDAY = new Date("2026-11-26T10:00:00.000Z");

function call(handler: typeof POST) {
  return handler(new Request(`http://localhost/api/appointments/${APPT_ID}/no-show`, { method: "POST" }), {
    params: Promise.resolve({ id: APPT_ID }),
  });
}

/** Wizyta z kartą klienta i odpowiedzi bazy na ścieżce progu. */
function givenMarkable(opts: { threshold: unknown; noShowCount?: number; blockedNow?: boolean; clientMissing?: boolean }) {
  m.txRows.push(
    [{ id: APPT_ID, status: "scheduled", startTime: YESTERDAY, clientId: CLIENT_ID }],
    [], // update wizyty
    [{ threshold: opts.threshold }]
  );
  if (opts.threshold === null || ![1, 2, 3].includes(opts.threshold as number)) return;
  m.txRows.push(opts.clientMissing ? [] : [{ id: CLIENT_ID }]);
  if (opts.clientMissing) return;
  m.txRows.push([{ noShowCount: opts.noShowCount ?? 0 }]);
  if ((opts.noShowCount ?? 0) >= (opts.threshold as number)) {
    m.txRows.push(opts.blockedNow === false ? [] : [{ id: CLIENT_ID }]);
  }
}

function clientUpdates() {
  return h.setArgs.filter((s) => "blockedAt" in s);
}

/**
 * Reguła blokady: zweryfikowany e-mail konta rezerwującego równy e-mailowi
 * karty. Bez telefonu — numer z formularza nie wskazuje kart do blokady.
 */
function verifiedAccountSql(card: string, appt: string, verifiedParam: number): string {
  return (
    `exists (select 1 from "user" "booking_account" where ("booking_account"."id" = ${appt}."booked_by_user_id" ` +
    `and "booking_account"."email_verified" = $${verifiedParam} ` +
    `and lower(nullif(btrim("booking_account"."email"), '')) = lower(nullif(btrim(${card}."email"), ''))))`
  );
}

/**
 * Próg blokady: wizyty no_show karty plus wizyty online tego samego klienta
 * dopasowane TYLKO po zweryfikowanym e-mailu konta (bez guest_phone).
 */
const COUNT_WHERE_SQL =
  '("appointments"."salon_id" = $1 and "appointments"."status" = $2 and ("appointments"."client_id" = $3 or ' +
  '("appointments"."client_id" is null and exists (select 1 from "clients" "no_show_card" where ' +
  '("no_show_card"."id" = $4 and "no_show_card"."salon_id" = $5 and ' +
  verifiedAccountSql('"no_show_card"', '"appointments"', 6) +
  ')))))';
const COUNT_WHERE_PARAMS = (clientId: string) => [SALON_A, "no_show", clientId, clientId, SALON_A, true];

/** Karty wizyty online do blokady: wizyta bez karty, zweryfikowany e-mail konta, salon z sesji. */
const ONLINE_CARDS_WHERE_SQL =
  '(exists (select 1 from "appointments" "online_appointment" where ("online_appointment"."id" = $1 ' +
  'and "online_appointment"."salon_id" = $2 and "online_appointment"."client_id" is null and ' +
  verifiedAccountSql('"clients"', '"online_appointment"', 3) +
  ')) and "clients"."salon_id" = $4)';

/** Wizyta online (bez karty) i odpowiedzi bazy: próg, pasujące karty, licznik i UPDATE każdej. */
function givenOnline(opts: {
  threshold: unknown;
  cards?: { id: string; noShowCount: number; blockedNow?: boolean }[];
}) {
  m.txRows.push(
    [{ id: APPT_ID, status: "scheduled", startTime: YESTERDAY, clientId: null }],
    [], // update wizyty
    [{ threshold: opts.threshold }]
  );
  if (opts.threshold === null || ![1, 2, 3].includes(opts.threshold as number)) return;
  const cards = opts.cards ?? [];
  m.txRows.push(cards.map((c) => ({ id: c.id })));
  for (const card of cards) {
    m.txRows.push([{ noShowCount: card.noShowCount }]);
    if (card.noShowCount >= (opts.threshold as number)) {
      m.txRows.push(card.blockedNow === false ? [] : [{ id: card.id }]);
    }
  }
}

beforeEach(() => {
  m.reset();
  h.selectWheres.length = 0;
  h.setArgs.length = 0;
  h.lockModes.length = 0;
  h.orderBys.length = 0;
  h.state.transactions = 0;
  h.state.failSelectNo = 0;
  h.state.failCode = "";
  vi.clearAllMocks();
  m.hasTemporaryAccess.mockResolvedValue(false);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("próg osiągnięty → blokada 'auto' w tej samej transakcji", () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [2, 5],
  ])("próg %i, licznik %i → blokada", async (threshold, noShowCount) => {
    m.asOwnerOf(SALON_A);
    givenMarkable({ threshold, noShowCount });

    const res = await call(POST);

    expect(res.status).toBe(200);
    // Panel dowiaduje się o założonej blokadzie z odpowiedzi.
    expect((await res.json()).data).toEqual({
      appointmentId: APPT_ID,
      noShow: true,
      changed: true,
      clientAutoBlocked: true,
    });
    expect(h.state.transactions).toBe(1);
    const [block] = clientUpdates();
    expect(block).toMatchObject({ blockedBy: "auto", blockNote: null });
    expect(block!.blockedAt).toEqual(NOW);
    expect(h.lockModes).toEqual(["update", "no key update"]);
    expect(h.logger.info).toHaveBeenCalledWith("[AppointmentNoShow API] Online booking auto-blocked", {
      salonId: SALON_A,
      appointmentId: APPT_ID,
      clientId: CLIENT_ID,
      threshold,
      noShowCount,
    });
  });

  it("UPDATE karty tylko bez istniejącej blokady, z jawnym eq(salonId)", async () => {
    m.asOwnerOf(SALON_A);
    givenMarkable({ threshold: 1, noShowCount: 1 });

    expect((await call(POST)).status).toBe(200);

    const clientWrite = m.writes.filter((w) => w.op === "update")[1]!;
    const where = dialect.sqlToQuery(clientWrite.where as SQL);
    expect(where.sql).toBe(
      '("clients"."id" = $1 and "clients"."salon_id" = $2 and "clients"."blocked_at" is null)'
    );
    expect(where.params).toEqual([CLIENT_ID, SALON_A]);
  });

  it("licznik: no_show tej karty i wizyt online tego samego klienta, w salonie z sesji", async () => {
    m.asOwnerOf(SALON_A);
    givenMarkable({ threshold: 2, noShowCount: 2 });

    expect((await call(POST)).status).toBe(200);

    // [wizyta], [próg], [karta], [licznik]
    const salonWhere = dialect.sqlToQuery(h.selectWheres[1] as SQL);
    expect(salonWhere.sql).toBe('"salons"."id" = $1');
    expect(salonWhere.params).toEqual([SALON_A]);
    const cardWhere = dialect.sqlToQuery(h.selectWheres[2] as SQL);
    expect(cardWhere.sql).toBe('("clients"."id" = $1 and "clients"."salon_id" = $2)');
    expect(cardWhere.params).toEqual([CLIENT_ID, SALON_A]);
    const countWhere = dialect.sqlToQuery(h.selectWheres[3] as SQL);
    expect(countWhere.sql).toBe(COUNT_WHERE_SQL);
    expect(countWhere.params).toEqual(COUNT_WHERE_PARAMS(CLIENT_ID));
  });

  it("karta już zablokowana (UPDATE bez wiersza) → 200, bez logu blokady", async () => {
    m.asOwnerOf(SALON_A);
    givenMarkable({ threshold: 1, noShowCount: 3, blockedNow: false });

    const res = await call(POST);
    expect(res.status).toBe(200);
    // Blokada już była — to oznaczenie jej nie założyło.
    expect((await res.json()).data).toEqual({ appointmentId: APPT_ID, noShow: true, changed: true });
    expect(clientUpdates()).toHaveLength(1);
    expect(h.logger.info).toHaveBeenCalledTimes(1);
  });
});

describe("bez blokady", () => {
  it.each([
    [2, 1],
    [3, 2],
  ])("próg %i, licznik %i → bez blokady", async (threshold, noShowCount) => {
    m.asOwnerOf(SALON_A);
    givenMarkable({ threshold, noShowCount });

    const res = await call(POST);
    expect(res.status).toBe(200);
    expect((await res.json()).data).not.toHaveProperty("clientAutoBlocked");
    expect(clientUpdates()).toEqual([]);
    expect(h.logger.info).toHaveBeenCalledTimes(1);
  });

  it.each([null, 0, 4, "2", true, { n: 1 }])("próg wyłączony albo niepoprawny (%j) → bez blokady i bez blokady wiersza karty", async (threshold) => {
    m.asOwnerOf(SALON_A);
    givenMarkable({ threshold });

    expect((await call(POST)).status).toBe(200);
    expect(clientUpdates()).toEqual([]);
    expect(h.lockModes).toEqual(["update"]);
  });

  it("brak ustawień salonu (SQL NULL) → bez blokady", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: APPT_ID, status: "scheduled", startTime: YESTERDAY, clientId: CLIENT_ID }], [], []);

    expect((await call(POST)).status).toBe(200);
    expect(clientUpdates()).toEqual([]);
  });

  it("karta usunięta w międzyczasie → 200, bez blokady", async () => {
    m.asOwnerOf(SALON_A);
    givenMarkable({ threshold: 1, clientMissing: true });

    expect((await call(POST)).status).toBe(200);
    expect(clientUpdates()).toEqual([]);
  });

  it("powtórne oznaczenie (już no_show) → bez progu i bez blokady", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: APPT_ID, status: "no_show", startTime: YESTERDAY, clientId: CLIENT_ID }]);

    expect((await call(POST)).status).toBe(200);
    expect(h.selectWheres).toHaveLength(1);
    expect(h.setArgs).toEqual([]);
  });
});

describe("wizyta online bez karty → karty salonu tego samego klienta", () => {
  const CARD_1 = "33333333-3333-4333-8333-333333333331";
  const CARD_2 = "33333333-3333-4333-8333-333333333332";

  it("zalogowany ze zweryfikowanym e-mailem dochodzi do progu → pasująca karta zablokowana", async () => {
    m.asOwnerOf(SALON_A);
    givenOnline({ threshold: 2, cards: [{ id: CARD_1, noShowCount: 2 }] });

    const res = await call(POST);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      appointmentId: APPT_ID,
      noShow: true,
      changed: true,
      clientAutoBlocked: true,
    });
    expect(clientUpdates()).toEqual([
      { blockedAt: NOW, blockedBy: "auto", blockNote: null, updatedAt: NOW },
    ]);
    // Wizyta nie dostaje karty: jedyny zapis wizyty to status.
    expect(h.setArgs[0]).toEqual({ status: "no_show", updatedAt: NOW });
    expect(h.lockModes).toEqual(["update", "no key update"]);
    expect(h.logger.info).toHaveBeenCalledWith("[AppointmentNoShow API] Online booking auto-blocked", {
      salonId: SALON_A,
      appointmentId: APPT_ID,
      clientId: CARD_1,
      threshold: 2,
      noShowCount: 2,
    });
  });

  it("karty do blokady szuka baza: tylko zweryfikowany e-mail konta, ten salon, kolejność id", async () => {
    m.asOwnerOf(SALON_A);
    givenOnline({ threshold: 1, cards: [{ id: CARD_1, noShowCount: 1 }] });

    expect((await call(POST)).status).toBe(200);

    // [wizyta], [próg], [karty], [licznik]
    const cardsWhere = dialect.sqlToQuery(h.selectWheres[2] as SQL);
    expect(cardsWhere.sql).toBe(ONLINE_CARDS_WHERE_SQL);
    expect(cardsWhere.params).toEqual([APPT_ID, SALON_A, true, SALON_A]);
    expect(h.orderBys).toHaveLength(1);
    expect(dialect.sqlToQuery(h.orderBys[0]![0] as SQL).sql).toBe('"clients"."id" asc');
    const countWhere = dialect.sqlToQuery(h.selectWheres[3] as SQL);
    expect(countWhere.sql).toBe(COUNT_WHERE_SQL);
    expect(countWhere.params).toEqual(COUNT_WHERE_PARAMS(CARD_1));
    // Próg i wybór kart bez dopasowania po telefonie.
    expect(cardsWhere.sql).not.toMatch(/guest_phone|"phone"/);
    expect(countWhere.sql).not.toMatch(/guest_phone|"phone"/);
    const clientWrite = m.writes.filter((w) => w.op === "update")[1]!;
    const where = dialect.sqlToQuery(clientWrite.where as SQL);
    expect(where.params).toEqual([CARD_1, SALON_A]);
  });

  it("licznik ponad progiem → karta zablokowana, log bez e-maila i telefonu", async () => {
    m.asOwnerOf(SALON_A);
    givenOnline({ threshold: 3, cards: [{ id: CARD_2, noShowCount: 4 }] });

    const res = await call(POST);

    expect(res.status).toBe(200);
    expect((await res.json()).data.clientAutoBlocked).toBe(true);
    expect(clientUpdates()).toHaveLength(1);
    // Trasa nie czyta e-maila ani telefonu: tylko id, status, termin i karta wizyty.
    expect(JSON.stringify(h.logger.info.mock.calls)).not.toMatch(/@|guest|phone|email/i);
  });

  it("brak pasującej karty → bez licznika i bez blokady", async () => {
    m.asOwnerOf(SALON_A);
    givenOnline({ threshold: 1, cards: [] });

    const res = await call(POST);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ appointmentId: APPT_ID, noShow: true, changed: true });
    // [wizyta], [próg], [karty] — licznika już nie ma.
    expect(h.selectWheres).toHaveLength(3);
    expect(clientUpdates()).toEqual([]);
    expect(h.logger.info).toHaveBeenCalledTimes(1);
  });

  it("gość z numerem karty (sam telefon) → zapytanie o karty bez telefonu → bez blokady", async () => {
    m.asOwnerOf(SALON_A);
    givenOnline({ threshold: 1, cards: [] });

    expect((await call(POST)).status).toBe(200);

    // Numer z formularza nikt nie sprawdził: ani wybór kart, ani próg nie
    // porównują telefonu wizyty z numerem karty. Karty innego salonu odcina
    // jawny salon_id (i RLS). Na danych: test pg.
    const cardsWhere = dialect.sqlToQuery(h.selectWheres[2] as SQL);
    expect(cardsWhere.params).not.toContain("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(cardsWhere.sql).not.toMatch(/guest_phone|"phone"/);
    expect(clientUpdates()).toEqual([]);
  });

  it("dwie pasujące karty → nieobecność liczy się do obu i obie dostają blokadę", async () => {
    m.asOwnerOf(SALON_A);
    givenOnline({
      threshold: 2,
      cards: [
        { id: CARD_1, noShowCount: 2 },
        { id: CARD_2, noShowCount: 3 },
      ],
    });

    const res = await call(POST);

    expect(res.status).toBe(200);
    expect((await res.json()).data.clientAutoBlocked).toBe(true);
    expect(clientUpdates()).toHaveLength(2);
    const cardWrites = m.writes.filter((w) => w.op === "update").slice(1);
    expect(cardWrites.map((w) => dialect.sqlToQuery(w.where as SQL).params[0])).toEqual([CARD_1, CARD_2]);
    // Jeden FOR NO KEY UPDATE na wszystkie karty (w kolejności id).
    expect(h.lockModes).toEqual(["update", "no key update"]);
    const blockedLogs = h.logger.info.mock.calls.filter((c) => c[0] === "[AppointmentNoShow API] Online booking auto-blocked");
    expect(blockedLogs.map((c) => (c[1] as { clientId: string }).clientId)).toEqual([CARD_1, CARD_2]);
  });

  it("dwie karty, tylko jedna po progu → blokada tylko tej jednej", async () => {
    m.asOwnerOf(SALON_A);
    givenOnline({
      threshold: 3,
      cards: [
        { id: CARD_1, noShowCount: 2 },
        { id: CARD_2, noShowCount: 3 },
      ],
    });

    expect((await (await call(POST)).json()).data.clientAutoBlocked).toBe(true);
    const cardWrites = m.writes.filter((w) => w.op === "update").slice(1);
    expect(cardWrites.map((w) => dialect.sqlToQuery(w.where as SQL).params[0])).toEqual([CARD_2]);
  });

  it("dwie karty już zablokowane → 200 bez clientAutoBlocked", async () => {
    m.asOwnerOf(SALON_A);
    givenOnline({
      threshold: 1,
      cards: [
        { id: CARD_1, noShowCount: 1, blockedNow: false },
        { id: CARD_2, noShowCount: 1, blockedNow: false },
      ],
    });

    expect((await (await call(POST)).json()).data).not.toHaveProperty("clientAutoBlocked");
    expect(h.logger.info).toHaveBeenCalledTimes(1);
  });

  it.each([null, 0, 4, "1"])("próg wyłączony albo niepoprawny (%j) → bez szukania kart", async (threshold) => {
    m.asOwnerOf(SALON_A);
    givenOnline({ threshold });

    expect((await call(POST)).status).toBe(200);
    // [wizyta], [próg] — bez zapytania o karty i bez blokady wierszy kart.
    expect(h.selectWheres).toHaveLength(2);
    expect(h.lockModes).toEqual(["update"]);
    expect(clientUpdates()).toEqual([]);
  });

  it("błąd bazy przy szukaniu kart → 500, oznaczenie wycofane razem z transakcją", async () => {
    m.asOwnerOf(SALON_A);
    givenOnline({ threshold: 1, cards: [{ id: CARD_1, noShowCount: 1 }] });
    // Trzeci odczyt: karty wizyty online.
    h.state.failSelectNo = 3;

    const res = await call(POST);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Nie udało się zmienić oznaczenia wizyty" });
    expect(clientUpdates()).toEqual([]);
    expect(h.logger.error).toHaveBeenCalledTimes(1);
  });

  it.each(["40P01", "40001"])("zakleszczenie albo konflikt serializacji (%s) przy kartach → 409 RETRY", async (code) => {
    m.asOwnerOf(SALON_A);
    givenOnline({ threshold: 1, cards: [{ id: CARD_1, noShowCount: 1 }] });
    h.state.failSelectNo = 3;
    h.state.failCode = code;

    const res = await call(POST);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("RETRY");
    expect(h.logger.error).not.toHaveBeenCalled();
  });
});

describe("cofnięcie nie zdejmuje blokady", () => {
  it("DELETE → status scheduled, karta klienta nietknięta", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([{ id: APPT_ID, status: "no_show", startTime: YESTERDAY, clientId: CLIENT_ID }]);

    const res = await call(DELETE);

    expect(res.status).toBe(200);
    expect(h.setArgs).toHaveLength(1);
    expect(h.setArgs[0]!.status).toBe("scheduled");
    expect(clientUpdates()).toEqual([]);
    expect(h.selectWheres).toHaveLength(1);
  });
});

describe("500", () => {
  it("błąd przy liczeniu → 500, cała transakcja (z oznaczeniem) się wycofuje", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push(
      [{ id: APPT_ID, status: "scheduled", startTime: YESTERDAY, clientId: CLIENT_ID }],
      [],
      [{ threshold: 1 }],
      [{ id: CLIENT_ID }]
    );
    // Czwarty odczyt (licznik) odrzucony — jak zakleszczenie albo zerwane połączenie.
    h.state.failSelectNo = 4;

    const res = await call(POST);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Nie udało się zmienić oznaczenia wizyty" });
    expect(clientUpdates()).toEqual([]);
    expect(h.logger.error).toHaveBeenCalledTimes(1);
  });
});
