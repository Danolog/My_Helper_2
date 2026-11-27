/**
 * Wspólne sprawdzenie blokady rezerwacji online (src/lib/online-booking-block.ts).
 *
 * Prawdziwy forSalon na atrapie db z salon-staff-harness: test sprawdza
 * wyrenderowany WHERE zapytania o kartę (salon, blokada, e-mail albo telefon),
 * parametry (numer w obu zapisach) i to, że bez danych do dopasowania baza
 * nie jest pytana. Miejsca wywołania w trasach: testy tras appointments,
 * deposits-create-session i deposits-blik-booking.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { findOnlineBookingBlock, onlineBookingBlockResponse } from "@/lib/online-booking-block";
import { SALON_A, SALON_B } from "./salon-staff-harness";
import type { SQL } from "drizzle-orm";

const h = await vi.hoisted(async () => {
  const m = (await import("./salon-staff-harness")).createSalonStaffMocks();
  const selectWheres: unknown[] = [];
  const state = { failDb: false, transactions: 0 };

  type Tx = Parameters<Parameters<typeof m.db.transaction>[0]>[0];
  type Chain = Record<string, (...args: unknown[]) => unknown>;
  const db = {
    transaction: (fn: (tx: Tx) => unknown) => {
      state.transactions += 1;
      if (state.failDb) return Promise.reject(new Error("connection refused"));
      return Promise.resolve(
        m.db.transaction((tx) =>
          fn({
            ...tx,
            select: () => {
              const chain = tx.select() as Chain;
              chain.where = (w: unknown) => {
                selectWheres.push(w);
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
  return { m, selectWheres, state, db, logger };
});

vi.mock("@/lib/db", () => ({ db: h.db }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: h.m.dbSystem }));
vi.mock("@/lib/logger", () => ({ logger: h.logger }));

const { m } = h;
const dialect = new PgDialect();

const VERIFIED = { id: "u-1", email: "klientka@example.invalid", emailVerified: true };
const UNVERIFIED = { id: "u-2", email: "nowa@example.invalid", emailVerified: false };
const PHONE_E164 = "+48000600700";
const PHONE_NINE = "000600700";
const SALON_PHONE = "+48 000 600 704";

/** WHERE zapytania o kartę (pierwszy select w transakcji). */
function clientWhere() {
  return dialect.sqlToQuery(h.selectWheres[0] as SQL);
}

beforeEach(() => {
  m.reset();
  h.selectWheres.length = 0;
  h.state.failDb = false;
  h.state.transactions = 0;
  vi.clearAllMocks();
});

describe("dopasowanie po e-mailu konta", () => {
  it("zweryfikowany e-mail z zablokowaną kartą → blokada, telefon salonu w wyniku", async () => {
    m.txRows.push([{ byEmail: true }], [{ phone: SALON_PHONE }]);

    const result = await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: VERIFIED });

    expect(result).toEqual({ blocked: true, salonPhone: SALON_PHONE, matchedBy: "email" });
    const where = clientWhere();
    expect(where.sql).toContain('"clients"."salon_id" = $1');
    expect(where.sql).toContain('"clients"."blocked_at" is not null');
    expect(where.sql).toContain('"clients"."email" = $2');
    expect(where.sql).not.toContain("regexp_replace");
    expect(where.params).toEqual([SALON_A, VERIFIED.email]);
    expect(m.rlsSalonIds()).toEqual([SALON_A]);
  });

  it("niezweryfikowany e-mail bez telefonu → bez zapytania, brak blokady", async () => {
    const result = await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: UNVERIFIED });

    expect(result).toEqual({ blocked: false });
    expect(h.state.transactions).toBe(0);
  });

  it("niezweryfikowany e-mail z telefonem → dopasowanie tylko po telefonie", async () => {
    m.txRows.push([]);

    await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: UNVERIFIED, phone: PHONE_E164 });

    const where = clientWhere();
    expect(where.sql).not.toContain('"clients"."email"');
    expect(where.params).toEqual([SALON_A, PHONE_E164, PHONE_NINE]);
  });

  it("zalogowana z telefonem z formularza → e-mail lub telefon w jednym zapytaniu", async () => {
    m.txRows.push([{ byEmail: false }], [{ phone: null }]);

    const result = await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: VERIFIED, phone: PHONE_E164 });

    expect(result).toEqual({ blocked: true, salonPhone: null, matchedBy: "phone" });
    const where = clientWhere();
    expect(where.sql).toContain(" or ");
    expect(where.params).toEqual([SALON_A, VERIFIED.email, PHONE_E164, PHONE_NINE]);
  });
});

describe("dopasowanie po telefonie gościa", () => {
  it.each([
    ["E.164", "+48000600700"],
    ["9 cyfr", "000600700"],
    ["ze spacjami", "000 600 700"],
    ["z myślnikami", "000-600-700"],
    ["+48 ze spacjami", "+48 000 600 700"],
  ])("zapis %s → ten sam numer w obu postaciach w zapytaniu", async (_label, raw) => {
    m.txRows.push([{ byEmail: false }], [{ phone: SALON_PHONE }]);

    const result = await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: null, phone: raw });

    expect(result).toEqual({ blocked: true, salonPhone: SALON_PHONE, matchedBy: "phone" });
    const where = clientWhere();
    // Zapis z karty normalizowany w bazie (spacje i myślniki usunięte).
    expect(where.sql).toContain(
      "regexp_replace(coalesce(\"clients\".\"phone\", ''), '[[:space:]-]', '', 'g') in ($2, $3)"
    );
    expect(where.params).toEqual([SALON_A, PHONE_E164, PHONE_NINE]);
  });

  it.each([
    ["za krótki", "12345"],
    ["zagraniczny", "+44 7700 900123"],
    ["litery", "abc def ghi"],
    ["pusty", ""],
  ])("numer nie do znormalizowania (%s) → bez zapytania, brak blokady", async (_label, raw) => {
    const result = await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: null, phone: raw });

    expect(result).toEqual({ blocked: false });
    expect(h.state.transactions).toBe(0);
  });

  it("brak zablokowanej karty z tym numerem → brak blokady, bez odczytu salonu", async () => {
    m.txRows.push([]);

    const result = await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: null, phone: PHONE_E164 });

    expect(result).toEqual({ blocked: false });
    expect(h.selectWheres).toHaveLength(1);
  });
});

describe("izolacja salonów", () => {
  it("rezerwacja w salonie B pyta tylko o karty salonu B (karta z blokadą w A nie pasuje)", async () => {
    // Karta z tym numerem jest zablokowana w salonie A; zapytanie salonu B
    // filtruje po salon_id = B, więc baza nie zwraca wiersza.
    m.txRows.push([]);

    const result = await findOnlineBookingBlock({ salonId: SALON_B, sessionUser: null, phone: PHONE_E164 });

    expect(result).toEqual({ blocked: false });
    const where = clientWhere();
    expect(where.sql).toContain('"clients"."salon_id" = $1');
    expect(where.params[0]).toBe(SALON_B);
    expect(where.params).not.toContain(SALON_A);
    expect(m.rlsSalonIds()).toEqual([SALON_B]);
  });

  it("telefon salonu czytany z wiersza tego salonu", async () => {
    m.txRows.push([{ byEmail: false }], [{ phone: SALON_PHONE }]);

    await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: null, phone: PHONE_E164 });

    const salonWhere = dialect.sqlToQuery(h.selectWheres[1] as SQL);
    expect(salonWhere.sql).toBe('"salons"."id" = $1');
    expect(salonWhere.params).toEqual([SALON_A]);
  });
});

describe("onlineBookingBlockResponse", () => {
  it("blokada → 403 ONLINE_BOOKING_UNAVAILABLE z telefonem salonu, log bez danych osobowych", async () => {
    m.txRows.push([{ byEmail: false }], [{ phone: SALON_PHONE }]);

    const res = await onlineBookingBlockResponse({ salonId: SALON_A, sessionUser: null, phone: PHONE_E164 });

    expect(res?.status).toBe(403);
    const body = await res!.json();
    expect(body).toEqual({
      success: false,
      code: "ONLINE_BOOKING_UNAVAILABLE",
      error: `Rezerwacja online jest niedostępna. Zadzwoń do salonu: ${SALON_PHONE}`,
    });
    // Komunikat nie zdradza powodu.
    expect(body.error.toLowerCase()).not.toMatch(/zablokowan|nieobecno/);
    expect(h.logger.info).toHaveBeenCalledWith(expect.any(String), { salonId: SALON_A, matchedBy: "phone" });
    const logged = JSON.stringify(h.logger.info.mock.calls);
    expect(logged).not.toContain(PHONE_NINE);
  });

  it("salon bez telefonu → komunikat „Skontaktuj się z salonem.”", async () => {
    m.txRows.push([{ byEmail: true }], [{ phone: "  " }]);

    const res = await onlineBookingBlockResponse({ salonId: SALON_A, sessionUser: VERIFIED });
    const body = await res!.json();

    expect(body.error).toBe("Rezerwacja online jest niedostępna. Skontaktuj się z salonem.");
    expect(JSON.stringify(h.logger.info.mock.calls)).not.toContain(VERIFIED.email);
  });

  it("brak blokady → null", async () => {
    m.txRows.push([]);
    expect(await onlineBookingBlockResponse({ salonId: SALON_A, sessionUser: VERIFIED })).toBeNull();
    expect(await onlineBookingBlockResponse({ salonId: SALON_A, sessionUser: null })).toBeNull();
  });

  it("błąd bazy → wyjątek do trasy (rezerwacja nie przechodzi bez sprawdzenia)", async () => {
    h.state.failDb = true;

    await expect(
      onlineBookingBlockResponse({ salonId: SALON_A, sessionUser: null, phone: PHONE_E164 })
    ).rejects.toThrow("connection refused");
  });
});
