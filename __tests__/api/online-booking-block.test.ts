/**
 * Wspólne sprawdzenie blokady rezerwacji online (src/lib/online-booking-block.ts).
 *
 * Prawdziwy forSalon na atrapie db z salon-staff-harness: test sprawdza
 * wyrenderowany WHERE zapytania o kartę (salon, blokada, e-mail, telefon albo
 * karta wpisu), parametry (numer w trzech postaciach: 9 cyfr, 48 i 0048
 * z przodu) i to, że bez danych do dopasowania baza
 * nie jest pytana. Miejsca wywołania w trasach: testy tras appointments,
 * deposits-create-session i deposits-blik-booking.
 */
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findOnlineBookingBlock,
  onlineBookingBlockResponse,
  sameCustomerOnlineBookingBlocked,
} from "@/lib/online-booking-block";
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
/** Trzy postaci numeru, z którymi baza porównuje cyfry z karty. */
const PHONE_FORMS = [PHONE_NINE, `48${PHONE_NINE}`, `0048${PHONE_NINE}`];
const SALON_PHONE = "+48 000 600 704";
const CARD_ID = "7b0f9f52-3a5e-4c1d-9a63-0f4f1c2d3e4f";
/** Wyrenderowane porównanie cyfr z karty z trzema postaciami numeru. */
const PHONE_SQL = "regexp_replace(coalesce(\"clients\".\"phone\", ''), '[^0-9]', '', 'g') in (";
/** Wyrenderowane porównanie e-maila bez wielkości liter i spacji na brzegach. */
const EMAIL_SQL = "lower(nullif(btrim(\"clients\".\"email\"), '')) = lower(btrim($2))";

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
    expect(where.sql).toContain(EMAIL_SQL);
    expect(where.sql).not.toContain("regexp_replace");
    expect(where.sql).not.toContain("linked_card");
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
    expect(where.params).toEqual([SALON_A, ...PHONE_FORMS]);
  });

  it("zalogowana z telefonem z formularza → e-mail lub telefon w jednym zapytaniu", async () => {
    m.txRows.push([{ byEmail: false }], [{ phone: null }]);

    const result = await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: VERIFIED, phone: PHONE_E164 });

    expect(result).toEqual({ blocked: true, salonPhone: null, matchedBy: "phone" });
    const where = clientWhere();
    expect(where.sql).toContain(" or ");
    expect(where.params).toEqual([SALON_A, VERIFIED.email, ...PHONE_FORMS]);
  });

  it("e-mail konta wielkimi literami → porównanie bez rozróżniania wielkości liter", async () => {
    m.txRows.push([{ byEmail: true }], [{ phone: SALON_PHONE }]);
    const shouting = { ...VERIFIED, email: "KLIENTKA@Example.Invalid" };

    const result = await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: shouting });

    expect(result).toEqual({ blocked: true, salonPhone: SALON_PHONE, matchedBy: "email" });
    const where = clientWhere();
    expect(where.sql).toContain(EMAIL_SQL);
    // Wartość z sesji idzie bez zmian; lower() po obu stronach robi baza.
    expect(where.params).toEqual([SALON_A, shouting.email]);
  });
});

describe("dopasowanie po karcie (clientId)", () => {
  it("sama karta bez sesji i telefonu → zapytanie z podzapytaniem o tę kartę w tym salonie", async () => {
    m.txRows.push([{ byEmail: false, byCard: true }], [{ phone: SALON_PHONE }]);

    const result = await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: null, clientId: CARD_ID });

    expect(result).toEqual({ blocked: true, salonPhone: SALON_PHONE, matchedBy: "card" });
    const where = clientWhere();
    expect(where.sql).toContain('"clients"."salon_id" = $1');
    expect(where.sql).toContain('"clients"."blocked_at" is not null');
    expect(where.sql).toContain('exists (select 1 from "clients" "linked_card" where ');
    expect(where.sql).toContain('"linked_card"."id" = $2');
    expect(where.sql).toContain('"linked_card"."salon_id" = $3');
    // Ten sam klient: ta karta, e-mail bez wielkości liter albo numer PL z karty.
    expect(where.sql).toContain('"linked_card"."id" = "clients"."id"');
    expect(where.sql).toContain(
      "lower(nullif(btrim(\"linked_card\".\"email\"), '')) = lower(nullif(btrim(\"clients\".\"email\"), ''))"
    );
    expect(where.sql).toContain("regexp_replace(coalesce(\"linked_card\".\"phone\", ''), '[^0-9]', '', 'g')");
    expect(where.params).toEqual([SALON_A, CARD_ID, SALON_A]);
    expect(m.rlsSalonIds()).toEqual([SALON_A]);
  });

  it("karta razem z e-mailem konta → oba warunki w jednym zapytaniu, e-mail ma pierwszeństwo w wyniku", async () => {
    m.txRows.push([{ byEmail: true, byCard: true }], [{ phone: null }]);

    const result = await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: VERIFIED, clientId: CARD_ID });

    expect(result).toEqual({ blocked: true, salonPhone: null, matchedBy: "email" });
    expect(clientWhere().params).toEqual([SALON_A, VERIFIED.email, CARD_ID, SALON_A]);
  });

  it("karta bez zablokowanego odpowiednika → brak blokady", async () => {
    m.txRows.push([]);

    const result = await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: UNVERIFIED, clientId: CARD_ID });

    expect(result).toEqual({ blocked: false });
    expect(h.state.transactions).toBe(1);
  });

  it("sameCustomerOnlineBookingBlocked: zablokowana karta tego salonu, ta sama karta, e-mail albo numer", () => {
    const { sql: rendered, params } = dialect.sqlToQuery(sameCustomerOnlineBookingBlocked(SALON_A));

    expect(rendered).toMatch(/^exists \(select 1 from "clients" "blocked_card" where /);
    expect(rendered).toContain('"blocked_card"."salon_id" = $1');
    expect(rendered).toContain('"blocked_card"."blocked_at" is not null');
    expect(rendered).toContain('"blocked_card"."id" = "clients"."id"');
    expect(rendered).toContain(
      "lower(nullif(btrim(\"blocked_card\".\"email\"), '')) = lower(nullif(btrim(\"clients\".\"email\"), ''))"
    );
    // Numer PL z obu kart sprowadzony do 9 cyfr (inny prefiks kraju = NULL).
    expect(rendered).toContain("~ '^0048[0-9]{9}$' then substr(");
    expect(params).toEqual([SALON_A]);
  });

  it("pusty clientId bez innych danych → bez zapytania", async () => {
    const result = await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: null, clientId: "" });

    expect(result).toEqual({ blocked: false });
    expect(h.state.transactions).toBe(0);
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
    // Z zapisu na karcie baza zostawia same cyfry i porównuje je z trzema postaciami numeru.
    expect(where.sql).toContain(`${PHONE_SQL}$2, $3, $4)`);
    expect(where.params).toEqual([SALON_A, ...PHONE_FORMS]);
  });

  /**
   * Zapis na karcie (karta przyjmuje cyfry, spacje i `+ - ( ) .`) po tej samej
   * operacji co w bazie (`regexp_replace(..., '[^0-9]', '', 'g')`) porównany
   * z parametrami zapytania dla gościa z „000 600 700”. Sam SQL na prawdziwej
   * bazie: __tests__/pg/online-booking-block.pg.test.ts (c2).
   */
  const cardDigits = (stored: string) => stored.replace(/[^0-9]/g, "");

  it.each([
    "(+48) 000 600 700",
    "000.600.700",
    "0048000600700",
    "48 000 600 700",
    "+48-000-600-700",
    "+48 (000) 600-700",
  ])("karta z zapisem „%s” → cyfry karty wśród parametrów zapytania", async (stored) => {
    m.txRows.push([]);

    await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: null, phone: "000 600 700" });

    const { params } = clientWhere();
    expect(params.slice(1)).toContain(cardDigits(stored));
  });

  it.each(["+49 000 600 700", "+44 000 600 700", "1 000 600 700", "00 600 700"])(
    "karta z zapisem „%s” (inny prefiks albo długość) → cyfry karty poza parametrami",
    async (stored) => {
      m.txRows.push([]);

      await findOnlineBookingBlock({ salonId: SALON_A, sessionUser: null, phone: "+48 000 600 700" });

      const { params } = clientWhere();
      expect(params.slice(1)).not.toContain(cardDigits(stored));
    }
  );

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
