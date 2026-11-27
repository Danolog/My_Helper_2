/**
 * Blokada rezerwacji online (migracja 0019) na PRAWDZIWYM Postgresie.
 *
 * Dowody:
 * a) CHECK `appointments_status_valid`: 5 dozwolonych statusów wchodzi (INSERT),
 *    nieznany status → 23514 przy INSERT i przy UPDATE.
 * b) CHECK na `clients`:
 *    - `clients_block_pair`: czas blokady bez autora i autor bez czasu → 23514;
 *    - `clients_block_note_requires_block`: notatka bez blokady (INSERT) i zdjęcie
 *      blokady z pozostawioną notatką (UPDATE) → 23514;
 *    - `clients_block_note_length`: 501 znaków → 23514, 500 znaków wchodzi.
 * c) `findOnlineBookingBlock` (src/lib/online-booking-block.ts) przez prawdziwe
 *    `forSalon` (rola aplikacji bez BYPASSRLS + kontekst salonu), czyli zapytanie
 *    z `regexp_replace` na numerze z karty:
 *    - ten sam numer w innym zapisie (spacje, myślniki, `+48`, bez prefiksu,
 *      po stronie karty i formularza) → dopasowanie;
 *    - zablokowana karta innego salonu z tym samym numerem → brak dopasowania;
 *    - niezablokowana karta z tym samym numerem → brak dopasowania;
 *    - RLS: w kontekście salonu A karta salonu B jest niewidoczna nawet bez
 *      warunku `salon_id` w zapytaniu.
 * c2) Zapisy numeru na karcie z nawiasami, kropkami, `0048` i `48` pasują;
 *    karta z prefiksem innego kraju (`+49`) i tymi samymi 9 cyframi nie pasuje.
 * d) To samo sprawdzenie po zweryfikowanym e-mailu konta (dołączenie do listy
 *    oczekujących): zablokowana karta z tym e-mailem w innym salonie nie blokuje;
 *    wielkość liter w e-mailu nie ma znaczenia.
 * e) Karta wpisu (`clientId`) i kolumna `sameCustomerOnlineBookingBlocked`:
 *    blokuje sama karta albo inna zablokowana karta salonu z tym samym e-mailem
 *    (inna wielkość liter) lub numerem (inny zapis); karta innego salonu nie.
 *
 * Mocki: tylko logger. `@/lib/db` → pula testu, `forSalon` prawdziwe.
 * Dane: użytkownicy `it-t3-oblock-…` (prefiks z notatki sprzątania w pg-harness.ts);
 * reszta kaskadą z salonów w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=<lokalna baza testowa> pnpm test:pg -- __tests__/pg/online-booking-block.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate` (RLS, rola aplikacji, migracja 0019).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findOnlineBookingBlock, sameCustomerOnlineBookingBlocked } from "@/lib/online-booking-block";
import { appointments, clients, employees, salons, user } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-oblock-a-${RUN}`;
const OWNER_B = `it-t3-oblock-b-${RUN}`;
const USERS = [OWNER_A, OWNER_B];

const STATUS_CHECK = "appointments_status_valid";
const PAIR_CHECK = "clients_block_pair";
const NOTE_REQUIRES_BLOCK_CHECK = "clients_block_note_requires_block";
const NOTE_LENGTH_CHECK = "clients_block_note_length";
const ALLOWED_STATUSES = ["scheduled", "confirmed", "completed", "cancelled", "no_show"] as const;

const SALON_A_PHONE = "+48 91 000 00 00";

/**
 * Numery testu: każdy scenariusz dopasowania ma własny numer, żeby karta
 * jednego scenariusza nie dawała wyniku w innym. Tylko 9 cyfr bez prefiksu;
 * prefiks i formatowanie dokładają scenariusze.
 */
const PHONE_SPACES = "600100200";
const PHONE_PLUS = "600100201";
const PHONE_BARE = "600100202";
const PHONE_OTHER_SALON = "600100203";
const PHONE_UNBLOCKED = "600100204";
const PHONE_NO_CARD = "600100205";

/**
 * Zapisy numeru, które karta przyjmuje (`phoneField`: cyfry, spacje, `+ - ( ) .`)
 * i zapisuje bez zmian. Każdy zapis ma własny numer, żeby dopasowanie dowodziło
 * rozpoznania właśnie tego zapisu.
 */
const CARD_FORMATS = [
  ["(+48) 600 100 210", "600100210"],
  ["600.100.211", "600100211"],
  ["0048600100212", "600100212"],
  ["48 600 100 213", "600100213"],
  ["+48-600-100-214", "600100214"],
] as const;
/** Zablokowana karta z prefiksem innego kraju i tymi samymi 9 cyframi. */
const PHONE_OTHER_COUNTRY = "600100215";

/** Karty do dopasowania „ten sam klient” przez kartę wpisu (clientId). */
const PHONE_LINKED = "600100220";
const PHONE_LINKED_OTHER_COUNTRY = "600100221";

const ids = { salonA: "", salonB: "", employeeA: "", clientB: "" };

let slot = 0;
/** Każda wizyta w osobnym, dalekim slocie — bez kolizji z EXCLUDE pracownika. */
function nextSlot() {
  const startTime = new Date(Date.UTC(2099, 0, 5, 8) + slot++ * 3_600_000);
  return { startTime, endTime: new Date(startTime.getTime() + 1_800_000) };
}

/** Błąd z bazy po odwinięciu opakowania Drizzle. */
async function dbError(p: PromiseLike<unknown>): Promise<{ code?: string; constraint_name?: string }> {
  try {
    await p;
  } catch (e) {
    let cur = e as { code?: string; cause?: unknown };
    while (!cur.code && cur.cause) cur = cur.cause as typeof cur;
    return cur as { code?: string; constraint_name?: string };
  }
  throw new Error("oczekiwano odrzucenia przez bazę");
}

async function insertClient(salonId: string, values: Partial<typeof clients.$inferInsert> = {}): Promise<string> {
  const [row] = await h!.db
    .insert(clients)
    .values({ salonId, firstName: "Ala", lastName: `OB-${RUN}`, ...values })
    .returning({ id: clients.id });
  return row!.id;
}

/** Karta z blokadą ręczną właściciela salonu (para czas + autor, jak trasa blokady). */
function blocked(owner: string): Partial<typeof clients.$inferInsert> {
  return { blockedAt: new Date(), blockedBy: owner };
}

/** Sprawdzenie jak w trasie rezerwacji gościa: bez sesji, sam telefon z formularza. */
function checkGuest(salonId: string, phone: string) {
  return findOnlineBookingBlock({ salonId, sessionUser: null, phone });
}

const suite = h ? describe : describe.skip;

suite("blokada rezerwacji online (migracja 0019), prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values(
      USERS.map((id) => ({ id, name: `IT T3 oblock ${id}`, email: `${id}@example.invalid`, emailVerified: true }))
    );
    const [a] = await db
      .insert(salons)
      .values({ name: `IT T3 oblock A ${RUN}`, ownerId: OWNER_A, phone: SALON_A_PHONE })
      .returning({ id: salons.id });
    const [b] = await db
      .insert(salons)
      .values({ name: `IT T3 oblock B ${RUN}`, ownerId: OWNER_B })
      .returning({ id: salons.id });
    ids.salonA = a!.id;
    ids.salonB = b!.id;
    const [e] = await db
      .insert(employees)
      .values({ salonId: ids.salonA, firstName: "IT", lastName: "OB" })
      .returning({ id: employees.id });
    ids.employeeA = e!.id;

    // Karty do dopasowania po telefonie (c). Zapisy na karcie celowo różne od
    // zapisu w formularzu.
    await insertClient(ids.salonA, { phone: "600 100 200", ...blocked(OWNER_A) });
    await insertClient(ids.salonA, { phone: "+48 600-100-201", ...blocked(OWNER_A) });
    await insertClient(ids.salonA, { phone: "+48600100202", ...blocked(OWNER_A) });
    // Ten sam numer zablokowany tylko w salonie B; w salonie A karta bez blokady.
    ids.clientB = await insertClient(ids.salonB, { phone: `+48${PHONE_OTHER_SALON}`, ...blocked(OWNER_B) });
    await insertClient(ids.salonA, { phone: `+48${PHONE_OTHER_SALON}` });
    // Karta bez blokady z numerem scenariusza „niezablokowana”.
    await insertClient(ids.salonA, { phone: PHONE_UNBLOCKED });
    // Zapisy numeru z nawiasami, kropkami, prefiksem 0048 i 48 (c2).
    for (const [stored] of CARD_FORMATS) await insertClient(ids.salonA, { phone: stored, ...blocked(OWNER_A) });
    await insertClient(ids.salonA, { phone: "+49 600 100 215", ...blocked(OWNER_A) });
  });

  afterAll(async () => {
    if (!h) return;
    try {
      for (const id of [ids.salonA, ids.salonB]) if (id) await h.db.delete(salons).where(eq(salons.id, id));
      await h.db.delete(user).where(inArray(user.id, USERS));
    } finally {
      await h.end();
    }
  });

  describe("a) CHECK appointments_status_valid", () => {
    it.each(ALLOWED_STATUSES)("status %s wchodzi", async (status) => {
      const [row] = await h!.db
        .insert(appointments)
        .values({ salonId: ids.salonA, employeeId: ids.employeeA, status, ...nextSlot() })
        .returning({ status: appointments.status });
      expect(row!.status).toBe(status);
    });

    it.each(["pending", "No_Show", ""])("INSERT z nieznanym statusem %j → 23514", async (status) => {
      const err = await dbError(
        h!.db.insert(appointments).values({ salonId: ids.salonA, employeeId: ids.employeeA, status, ...nextSlot() })
      );
      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe(STATUS_CHECK);
    });

    it("UPDATE na nieznany status → 23514, wiersz bez zmian", async () => {
      const [row] = await h!.db
        .insert(appointments)
        .values({ salonId: ids.salonA, employeeId: ids.employeeA, ...nextSlot() })
        .returning({ id: appointments.id });
      const err = await dbError(
        h!.db.update(appointments).set({ status: "missed" }).where(eq(appointments.id, row!.id))
      );
      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe(STATUS_CHECK);
      const [after] = await h!.db
        .select({ status: appointments.status })
        .from(appointments)
        .where(eq(appointments.id, row!.id));
      expect(after!.status).toBe("scheduled");
    });
  });

  describe("b) CHECK na clients", () => {
    it("clients_block_pair: czas blokady bez autora → 23514", async () => {
      const err = await dbError(insertClient(ids.salonA, { blockedAt: new Date() }));
      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe(PAIR_CHECK);
    });

    it("clients_block_pair: autor bez czasu blokady → 23514", async () => {
      const err = await dbError(insertClient(ids.salonA, { blockedBy: "auto" }));
      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe(PAIR_CHECK);
    });

    it("clients_block_pair: zdjęcie samego czasu (autor zostaje) → 23514", async () => {
      const clientId = await insertClient(ids.salonA, blocked(OWNER_A));
      const err = await dbError(h!.db.update(clients).set({ blockedAt: null }).where(eq(clients.id, clientId)));
      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe(PAIR_CHECK);
    });

    it("clients_block_note_requires_block: notatka bez blokady → 23514", async () => {
      const err = await dbError(insertClient(ids.salonA, { blockNote: "Trzy razy bez odwołania" }));
      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe(NOTE_REQUIRES_BLOCK_CHECK);
    });

    it("clients_block_note_requires_block: odblokowanie z pozostawioną notatką → 23514", async () => {
      const clientId = await insertClient(ids.salonA, { ...blocked(OWNER_A), blockNote: "notatka" });
      const err = await dbError(
        h!.db.update(clients).set({ blockedAt: null, blockedBy: null }).where(eq(clients.id, clientId))
      );
      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe(NOTE_REQUIRES_BLOCK_CHECK);
    });

    it("clients_block_note_length: 501 znaków → 23514", async () => {
      const err = await dbError(insertClient(ids.salonA, { ...blocked(OWNER_A), blockNote: "x".repeat(501) }));
      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe(NOTE_LENGTH_CHECK);
    });

    it("kontrola: blokada automatyczna bez notatki i ręczna z notatką 500 znaków wchodzą", async () => {
      await expect(insertClient(ids.salonA, { blockedAt: new Date(), blockedBy: "auto" })).resolves.toEqual(
        expect.any(String)
      );
      await expect(
        insertClient(ids.salonA, { ...blocked(OWNER_A), blockNote: "x".repeat(500) })
      ).resolves.toEqual(expect.any(String));
    });
  });

  describe("c) dopasowanie gościa po telefonie (findOnlineBookingBlock przez forSalon)", () => {
    it.each([
      ["karta „600 100 200”, formularz z +48 i spacjami", "+48 600 100 200"],
      ["karta „600 100 200”, formularz bez prefiksu i spacji", PHONE_SPACES],
      ["karta „+48 600-100-201”, formularz z myślnikami bez prefiksu", "600-100-201"],
      ["karta „+48 600-100-201”, formularz w E.164", `+48${PHONE_PLUS}`],
      ["karta „+48600100202”, formularz ze spacjami bez prefiksu", "600 100 202"],
      ["karta „+48600100202”, formularz w E.164", `+48${PHONE_BARE}`],
    ])("%s → dopasowanie", async (_label, phone) => {
      const result = await checkGuest(ids.salonA, phone);
      expect(result).toEqual({ blocked: true, salonPhone: SALON_A_PHONE, matchedBy: "phone" });
    });

    it("zablokowana karta innego salonu z tym samym numerem → brak dopasowania", async () => {
      expect(await checkGuest(ids.salonA, `+48${PHONE_OTHER_SALON}`)).toEqual({ blocked: false });
      // Kontrola fałszywej zieleni: w salonie B ten sam numer jest dopasowany.
      expect(await checkGuest(ids.salonB, PHONE_OTHER_SALON)).toEqual({
        blocked: true,
        salonPhone: null,
        matchedBy: "phone",
      });
    });

    it("niezablokowana karta z tym samym numerem → brak dopasowania", async () => {
      expect(await checkGuest(ids.salonA, `+48 ${PHONE_UNBLOCKED}`)).toEqual({ blocked: false });
    });

    it("numer bez karty i numer nienormalizowalny → brak dopasowania", async () => {
      expect(await checkGuest(ids.salonA, PHONE_NO_CARD)).toEqual({ blocked: false });
      expect(await checkGuest(ids.salonA, "60010020")).toEqual({ blocked: false });
    });

    it("RLS: w kontekście salonu A karta salonu B niewidoczna także bez warunku salon_id", async () => {
      const visibleInA = await forSalon(ids.salonA).raw((tx) =>
        tx.select({ id: clients.id }).from(clients).where(eq(clients.id, ids.clientB))
      );
      expect(visibleInA).toEqual([]);
      const visibleInB = await forSalon(ids.salonB).raw((tx) =>
        tx.select({ id: clients.id }).from(clients).where(eq(clients.id, ids.clientB))
      );
      expect(visibleInB).toEqual([{ id: ids.clientB }]);
    });
  });

  describe("c2) zapis numeru na karcie: nawiasy, kropki, 0048, 48", () => {
    it.each(CARD_FORMATS)("zablokowana karta „%s”, gość z 9 cyframi ze spacjami → dopasowanie", async (_stored, nine) => {
      const spaced = `${nine.slice(0, 3)} ${nine.slice(3, 6)} ${nine.slice(6)}`;
      expect(await checkGuest(ids.salonA, spaced)).toEqual({
        blocked: true,
        salonPhone: SALON_A_PHONE,
        matchedBy: "phone",
      });
    });

    it.each(CARD_FORMATS)("zablokowana karta „%s”, gość w E.164 → dopasowanie", async (_stored, nine) => {
      expect(await checkGuest(ids.salonA, `+48${nine}`)).toEqual({
        blocked: true,
        salonPhone: SALON_A_PHONE,
        matchedBy: "phone",
      });
    });

    it("zablokowana karta „+49 600 100 215” nie pasuje do gościa „+48 600 100 215”", async () => {
      expect(await checkGuest(ids.salonA, `+48 ${PHONE_OTHER_COUNTRY}`)).toEqual({ blocked: false });
      expect(await checkGuest(ids.salonA, PHONE_OTHER_COUNTRY)).toEqual({ blocked: false });
    });
  });

  describe("e) karta wpisu (clientId): ta karta albo inna karta salonu z tym samym e-mailem lub numerem", () => {
    const linkedEmail = `it-t3-oblock-linked-${RUN}@example.invalid`;
    const card = { plain: "", sameEmail: "", samePhone: "", otherCountry: "", self: "", salonB: "" };

    /** Kolumna „ten sam klient ma blokadę” dla jednej karty, przez forSalon. */
    async function sameCustomerBlocked(salonId: string, clientId: string) {
      const rows = await forSalon(salonId).raw((tx) =>
        tx
          .select({ blocked: sameCustomerOnlineBookingBlocked(salonId) })
          .from(clients)
          .where(and(eq(clients.id, clientId), eq(clients.salonId, salonId)))
      );
      return rows.map((r) => r.blocked);
    }

    beforeAll(async () => {
      // Karty bez blokady, wskazywane jako karta wpisu.
      card.plain = await insertClient(ids.salonA, { phone: "600 100 222" });
      card.sameEmail = await insertClient(ids.salonA, { email: linkedEmail });
      card.samePhone = await insertClient(ids.salonA, { phone: `(+48) ${PHONE_LINKED}` });
      card.otherCountry = await insertClient(ids.salonA, { phone: `+49 ${PHONE_LINKED_OTHER_COUNTRY}` });
      // Zablokowane karty tego samego klienta: e-mail innej wielkości liter
      // z odstępem na brzegu oraz numer w innym zapisie.
      await insertClient(ids.salonA, { email: ` ${linkedEmail.toUpperCase()}`, ...blocked(OWNER_A) });
      await insertClient(ids.salonA, { phone: `0048 ${PHONE_LINKED}`, ...blocked(OWNER_A) });
      await insertClient(ids.salonA, { phone: `+48 ${PHONE_LINKED_OTHER_COUNTRY}`, ...blocked(OWNER_A) });
      // Sama karta wpisu zablokowana.
      card.self = await insertClient(ids.salonA, { phone: "600 100 223", ...blocked(OWNER_A) });
      // Zablokowana karta salonu B wskazana w salonie A.
      card.salonB = await insertClient(ids.salonB, { email: linkedEmail, ...blocked(OWNER_B) });
    });

    it("inna zablokowana karta z tym samym e-mailem (inna wielkość liter) → blokada", async () => {
      expect(await findOnlineBookingBlock({ salonId: ids.salonA, sessionUser: null, clientId: card.sameEmail })).toEqual({
        blocked: true,
        salonPhone: SALON_A_PHONE,
        matchedBy: "card",
      });
      expect(await sameCustomerBlocked(ids.salonA, card.sameEmail)).toEqual([true]);
    });

    it("inna zablokowana karta z tym samym numerem w innym zapisie → blokada", async () => {
      expect(await findOnlineBookingBlock({ salonId: ids.salonA, sessionUser: null, clientId: card.samePhone })).toEqual({
        blocked: true,
        salonPhone: SALON_A_PHONE,
        matchedBy: "card",
      });
      expect(await sameCustomerBlocked(ids.salonA, card.samePhone)).toEqual([true]);
    });

    it("sama karta wpisu zablokowana → blokada", async () => {
      expect(await findOnlineBookingBlock({ salonId: ids.salonA, sessionUser: null, clientId: card.self })).toEqual({
        blocked: true,
        salonPhone: SALON_A_PHONE,
        matchedBy: "card",
      });
      expect(await sameCustomerBlocked(ids.salonA, card.self)).toEqual([true]);
    });

    it("karta bez zablokowanego odpowiednika → brak blokady", async () => {
      expect(await findOnlineBookingBlock({ salonId: ids.salonA, sessionUser: null, clientId: card.plain })).toEqual({
        blocked: false,
      });
      expect(await sameCustomerBlocked(ids.salonA, card.plain)).toEqual([false]);
    });

    it("karta z numerem +49 i zablokowana karta z tymi samymi cyframi po +48 → brak blokady", async () => {
      expect(
        await findOnlineBookingBlock({ salonId: ids.salonA, sessionUser: null, clientId: card.otherCountry })
      ).toEqual({ blocked: false });
      expect(await sameCustomerBlocked(ids.salonA, card.otherCountry)).toEqual([false]);
    });

    it("karta innego salonu wskazana w salonie A → brak blokady (karta niewidoczna)", async () => {
      expect(await findOnlineBookingBlock({ salonId: ids.salonA, sessionUser: null, clientId: card.salonB })).toEqual({
        blocked: false,
      });
      // Kontrola fałszywej zieleni: w salonie B ta karta blokuje.
      expect(await findOnlineBookingBlock({ salonId: ids.salonB, sessionUser: null, clientId: card.salonB })).toEqual({
        blocked: true,
        salonPhone: null,
        matchedBy: "card",
      });
    });
  });

  describe("d) zalogowany klient po e-mailu (dołączenie do listy oczekujących)", () => {
    const email = `it-t3-oblock-klient-${RUN}@example.invalid`;
    const account = { email, emailVerified: true };

    beforeAll(async () => {
      // Ten sam e-mail: karta zablokowana w salonie B, karta bez blokady w salonie A.
      await insertClient(ids.salonB, { email, ...blocked(OWNER_B) });
      await insertClient(ids.salonA, { email });
    });

    it("zablokowana karta z tym e-mailem tylko w innym salonie → brak blokady w salonie A", async () => {
      expect(await findOnlineBookingBlock({ salonId: ids.salonA, sessionUser: account })).toEqual({ blocked: false });
    });

    it("w salonie B ta sama karta blokuje (dopasowanie po e-mailu)", async () => {
      expect(await findOnlineBookingBlock({ salonId: ids.salonB, sessionUser: account })).toEqual({
        blocked: true,
        salonPhone: null,
        matchedBy: "email",
      });
    });

    it("e-mail konta innej wielkości liter niż na karcie → ta sama karta blokuje", async () => {
      expect(
        await findOnlineBookingBlock({
          salonId: ids.salonB,
          sessionUser: { email: email.toUpperCase(), emailVerified: true },
        })
      ).toEqual({ blocked: true, salonPhone: null, matchedBy: "email" });
    });

    it("niezweryfikowany e-mail nie dopasowuje karty", async () => {
      expect(
        await findOnlineBookingBlock({ salonId: ids.salonB, sessionUser: { email, emailVerified: false } })
      ).toEqual({ blocked: false });
    });
  });
});
