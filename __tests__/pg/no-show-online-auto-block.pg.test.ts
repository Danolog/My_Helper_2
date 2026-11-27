/**
 * Nieobecności wizyt online (bez karty) w automatycznej blokadzie i liczniku
 * „Nie przyszedł”, na PRAWDZIWYM Postgresie.
 *
 * Trasy: `POST /api/appointments/[id]/no-show` i `GET /api/clients/[id]/no-shows`
 * przez prawdziwe `forSalon` (rola aplikacji bez BYPASSRLS + kontekst salonu).
 * Dwie reguły (src/lib/online-booking-block.ts, `OnlineNoShowMatch`):
 * - licznik „Nie przyszedł”: telefon wizyty w kluczu 9 cyfr równy numerowi
 *   karty ALBO zweryfikowany e-mail konta `booked_by_user_id` równy e-mailowi
 *   karty (bez wielkości liter i spacji na brzegach);
 * - próg i automatyczna blokada: TYLKO zweryfikowany e-mail konta. Sam
 *   telefon nie wystarcza, także u zalogowanego, który go wpisał.
 *
 * Dowody (próg salonu A = 2):
 * 1. gość z numerem karty nie przyszedł dwa razy → licznik 2, karta BEZ
 *    blokady; wizyty nadal bez karty, żadna karta nie powstała; phoneOnlyCount 2;
 * 1b. phoneOnlyCount: wizyta z kartą, wizyta konta po e-mailu z numerem karty
 *    i wizyta gościa po numerze → „tylko po telefonie” liczy wyłącznie gościa;
 * 2. zalogowany ze zweryfikowanym e-mailem (e-mail karty innej wielkości
 *    liter, ze spacją) → karta zablokowana ('auto'), licznik 2;
 * 2b. konto z niezweryfikowanym e-mailem → licznik 0, bez blokady;
 * 2c. zalogowany wpisał telefon karty, ale ma inny e-mail → licznik 2, bez blokady;
 * 3. brak karty → 200 bez blokady, kart w salonie tyle samo;
 * 4. karta tylko w salonie B (ten numer i ten e-mail) → nieobecności w A nie
 *    liczą się nigdzie; w B ten sam klient się liczy;
 * 5. dwie karty z e-mailem tego samego konta → obie zablokowane;
 * 5b. dwie karty z tym samym numerem w dwóch zapisach → licznik obu, bez blokady;
 * 6. numer nieczytelny (8 cyfr) na karcie i wizycie → brak dopasowania;
 * 7. próg wyłączony (salon C) → bez blokady, licznik i tak liczy;
 * 8. dwa równoległe oznaczenia wizyt online tej samej karty (po e-mailu) na
 *    dwóch połączeniach (bariera: obserwator trzyma wiersz karty): próg nie
 *    przeskakuje — jedna blokada albo 409 RETRY, nigdy dwa 200 bez blokady
 *    ani 500; 8b: para „wizyta z kartą + wizyta online po e-mailu”.
 *
 * Mocki: sesja (`requireAuth`), kontekst salonu (`getSalonContext`), logger.
 * Baza, RLS i obie trasy — prawdziwe.
 * Dane: użytkownicy `it-t3-nsonline-…` (prefiks z notatki sprzątania w pg-harness.ts);
 * reszta kaskadą z salonów w `afterAll`. Wymaga bazy po `pnpm db:migrate`.
 */
import { randomUUID } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as noShowRoute from "@/app/api/appointments/[id]/no-show/route";
import * as noShowsRoute from "@/app/api/clients/[id]/no-shows/route";
import { appointments, clients, employees, salons, user } from "@/lib/schema";
import { createRouteParams, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());

/** Salon i rola z „sesji” — trasy biorą je z getSalonContext. */
const ctl = vi.hoisted(() => ({ salonId: "", userId: "" }));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/server/system/db-system", () => ({
  get dbSystem() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: async () => ({ user: { id: ctl.userId } }),
  isAuthError: () => false,
}));
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: async () => ({ salonId: ctl.salonId, userId: ctl.userId, role: "owner" }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const OWNER_A = `it-t3-nsonline-a-${RUN}`;
const OWNER_B = `it-t3-nsonline-b-${RUN}`;
const OWNER_C = `it-t3-nsonline-c-${RUN}`;
/** Każdy scenariusz z kontem ma własne konto, żeby nie liczył wizyt innego. */
const CUSTOMER = `it-t3-nsonline-u-${RUN}`;
const UNVERIFIED = `it-t3-nsonline-v-${RUN}`;
const PHONE_TYPER = `it-t3-nsonline-p-${RUN}`;
const OTHER_SALON_CUSTOMER = `it-t3-nsonline-s-${RUN}`;
const TWO_CARDS_CUSTOMER = `it-t3-nsonline-d-${RUN}`;
const RACE_CUSTOMER = `it-t3-nsonline-r-${RUN}`;
const RACE_MIXED_CUSTOMER = `it-t3-nsonline-m-${RUN}`;
const PHONE_AND_EMAIL_CUSTOMER = `it-t3-nsonline-e-${RUN}`;
const USERS = [
  PHONE_AND_EMAIL_CUSTOMER,
  OWNER_A,
  OWNER_B,
  OWNER_C,
  CUSTOMER,
  UNVERIFIED,
  PHONE_TYPER,
  OTHER_SALON_CUSTOMER,
  TWO_CARDS_CUSTOMER,
  RACE_CUSTOMER,
  RACE_MIXED_CUSTOMER,
];
const emailOf = (userId: string) => `${userId}@example.invalid`;
const CUSTOMER_EMAIL = emailOf(CUSTOMER);
const UNVERIFIED_EMAIL = emailOf(UNVERIFIED);

const THRESHOLD = 2;

/** Każdy scenariusz ma własny numer (9 cyfr), żeby nie liczył wizyt innego. */
const PHONE_GUEST = "600300100";
const PHONE_NO_CARD = "600300101";
const PHONE_OTHER_SALON = "600300102";
const PHONE_TWO_CARDS = "600300103";
const PHONE_THRESHOLD_OFF = "600300104";
const PHONE_TYPED_BY_USER = "600300107";
const PHONE_AND_EMAIL = "600300108";
/** 8 cyfr: ani karta, ani wizyta nie mają klucza 9 cyfr. */
const PHONE_UNREADABLE = "60030010";

const ids = { salonA: "", salonB: "", salonC: "", empA: "", empB: "", empC: "" };

let slot = 0;
/** Każda wizyta w osobnym slocie w przeszłości — dzień wizyty już minął. */
function nextSlot() {
  const startTime = new Date(Date.UTC(2025, 0, 6, 8) + slot++ * 3_600_000);
  return { startTime, endTime: new Date(startTime.getTime() + 1_800_000) };
}

function employeeOf(salonId: string): string {
  if (salonId === ids.salonA) return ids.empA;
  if (salonId === ids.salonB) return ids.empB;
  return ids.empC;
}

async function insertClient(salonId: string, values: Partial<typeof clients.$inferInsert>): Promise<string> {
  const [row] = await h!.db
    .insert(clients)
    .values({ salonId, firstName: "Ala", lastName: `NSO-${RUN}`, ...values })
    .returning({ id: clients.id });
  return row!.id;
}

/** Wizyta online: bez karty, z telefonem gościa albo kontem rezerwującego. */
async function insertOnline(
  salonId: string,
  who: { guestPhone?: string; bookedByUserId?: string; clientId?: string }
): Promise<string> {
  const [row] = await h!.db
    .insert(appointments)
    .values({
      salonId,
      employeeId: employeeOf(salonId),
      status: "scheduled",
      clientId: who.clientId ?? null,
      guestPhone: who.guestPhone ?? null,
      bookedByUserId: who.bookedByUserId ?? null,
      ...nextSlot(),
    })
    .returning({ id: appointments.id });
  return row!.id;
}

async function markNoShow(salonId: string, appointmentId: string) {
  ctl.salonId = salonId;
  ctl.userId = salonId === ids.salonA ? OWNER_A : salonId === ids.salonB ? OWNER_B : OWNER_C;
  return parseResponse<{ success: boolean; code?: string; data?: Record<string, unknown> }>(
    await noShowRoute.POST(
      new Request(`http://localhost/api/appointments/${appointmentId}/no-show`, { method: "POST" }),
      createRouteParams(appointmentId)
    )
  );
}

async function noShowCounter(salonId: string, clientId: string): Promise<{ noShowCount: number; phoneOnlyCount: number }> {
  ctl.salonId = salonId;
  const res = await parseResponse<{ data: { noShowCount: number; phoneOnlyCount: number } }>(
    await noShowsRoute.GET(new Request(`http://localhost/api/clients/${clientId}/no-shows`), createRouteParams(clientId))
  );
  expect(res.status).toBe(200);
  // Odpowiedz trasy zawiera tez clientId; testy porownuja tylko liczniki.
  const { noShowCount, phoneOnlyCount } = res.body.data;
  return { noShowCount, phoneOnlyCount };
}

async function noShowCount(salonId: string, clientId: string): Promise<number> {
  return (await noShowCounter(salonId, clientId)).noShowCount;
}

async function blockOf(clientId: string) {
  const [row] = await h!.db
    .select({ blockedAt: clients.blockedAt, blockedBy: clients.blockedBy })
    .from(clients)
    .where(eq(clients.id, clientId));
  return row!;
}

async function clientCount(salonId: string): Promise<number> {
  const [row] = await h!.db.select({ n: count() }).from(clients).where(eq(clients.salonId, salonId));
  return Number(row!.n);
}

async function appointmentCards(appointmentIds: string[]): Promise<(string | null)[]> {
  const rows = await h!.db
    .select({ clientId: appointments.clientId })
    .from(appointments)
    .where(inArray(appointments.id, appointmentIds));
  return rows.map((r) => r.clientId);
}

/**
 * Czeka, aż `n` transakcji stoi za transakcją `holderPid` — wprost albo
 * w kolejce za inną czekającą (`pg_blocking_pids`, łańcuch). Obserwator trzyma
 * tylko wiersz karty, więc każda taka transakcja czeka na kartę.
 *
 * Nie po tekście zapytania: `pg_stat_activity.query` jest obcięte do
 * `track_activity_query_size` (domyślnie 1024 bajty), a zapytanie o karty
 * wizyty online jest dłuższe — końcówka `for no key update` w nim nie
 * występuje i bariera nie widziała czekających. Druga czekająca stoi zaś
 * zwykle za blokadą krotki pierwszej, nie za obserwatorem, stąd łańcuch.
 */
async function waitForWaitersBehind(holderPid: number, n: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await h!.observer<{ n: number }[]>`
      with recursive chain(pid) as (
        select a.pid from pg_stat_activity a where ${holderPid} = any(pg_blocking_pids(a.pid))
        union
        select a.pid from pg_stat_activity a join chain c on c.pid = any(pg_blocking_pids(a.pid))
      )
      select count(*)::int as n from chain
    `;
    if ((row?.n ?? 0) >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`bariera: mniej niż ${n} transakcji w oczekiwaniu na kartę po ${timeoutMs} ms`);
}

/**
 * Dwa oznaczenia naraz, gdy obserwator trzyma wiersz karty: obie transakcje
 * zapisują status wizyty i stają na karcie; po zwolnieniu liczą po kolei.
 */
async function raceNoShows(salonId: string, cardId: string, appointmentIds: [string, string]) {
  let calls: Promise<Awaited<ReturnType<typeof markNoShow>>[]> | null = null;
  await h!.observer.begin(async (tx) => {
    const [holder] = await tx.unsafe<{ pid: number }[]>("select pg_backend_pid() as pid");
    await tx.unsafe("select id from clients where id = $1 for update", [cardId]);
    calls = Promise.all(appointmentIds.map((id) => markNoShow(salonId, id)));
    await waitForWaitersBehind(holder!.pid, 2);
  });
  return calls!;
}

/** Wynik wyścigu: jedna blokada, albo 409 RETRY bez blokady i ponowienie ją zakłada. */
async function expectSingleBlockOrRetry(
  salonId: string,
  cardId: string,
  appointmentIds: [string, string],
  results: Awaited<ReturnType<typeof markNoShow>>[]
) {
  const statuses = results.map((r) => r.status);
  const detail = JSON.stringify(results.map((r) => r.body));
  const blockedFlags = results.filter((r) => r.body.data?.clientAutoBlocked === true);
  if (statuses.every((s) => s === 200)) {
    expect(blockedFlags, detail).toHaveLength(1);
  } else {
    expect([...statuses].sort(), detail).toEqual([200, 409]);
    const retry = results.findIndex((r) => r.status === 409);
    expect(results[retry]!.body.code).toBe("RETRY");
    expect(blockedFlags, detail).toHaveLength(0);
    expect((await blockOf(cardId)).blockedAt).toBeNull();
    // Transakcja z 409 wycofana w całości — ponowienie dochodzi do progu.
    const again = await markNoShow(salonId, appointmentIds[retry]!);
    expect(again.status).toBe(200);
    expect(again.body.data?.clientAutoBlocked).toBe(true);
  }
  expect((await blockOf(cardId)).blockedBy).toBe("auto");
  expect(await noShowCount(salonId, cardId)).toBe(2);
}

const suite = h ? describe : describe.skip;

suite("nieobecności wizyt online w automatycznej blokadzie, prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values(
      USERS.map((id) => ({
        id,
        name: `IT T3 nsonline ${id}`,
        email: `${id}@example.invalid`,
        emailVerified: id !== UNVERIFIED,
      }))
    );
    const insertSalon = async (name: string, ownerId: string, threshold: number | null) => {
      const [row] = await db
        .insert(salons)
        .values({ name: `${name} ${RUN}`, ownerId, settingsJson: { noShowAutoBlockThreshold: threshold } })
        .returning({ id: salons.id });
      return row!.id;
    };
    ids.salonA = await insertSalon("IT T3 nsonline A", OWNER_A, THRESHOLD);
    ids.salonB = await insertSalon("IT T3 nsonline B", OWNER_B, THRESHOLD);
    ids.salonC = await insertSalon("IT T3 nsonline C", OWNER_C, null);
    const insertEmployee = async (salonId: string) => {
      const [row] = await db
        .insert(employees)
        .values({ salonId, firstName: "IT", lastName: "NSO" })
        .returning({ id: employees.id });
      return row!.id;
    };
    ids.empA = await insertEmployee(ids.salonA);
    ids.empB = await insertEmployee(ids.salonB);
    ids.empC = await insertEmployee(ids.salonC);
  });

  afterAll(async () => {
    if (!h) return;
    try {
      for (const id of [ids.salonA, ids.salonB, ids.salonC]) if (id) await h.db.delete(salons).where(eq(salons.id, id));
      await h.db.delete(user).where(inArray(user.id, USERS));
    } finally {
      await h.end();
    }
  });

  it("1: gość z numerem karty nie przyszedł do progu → licznik 2, karta BEZ blokady", async () => {
    const card = await insertClient(ids.salonA, { phone: "600 300 100" });
    const visits = [
      await insertOnline(ids.salonA, { guestPhone: `+48${PHONE_GUEST}` }),
      await insertOnline(ids.salonA, { guestPhone: `+48${PHONE_GUEST}` }),
    ];
    const cardsBefore = await clientCount(ids.salonA);

    for (const visit of visits) {
      const res = await markNoShow(ids.salonA, visit);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).not.toHaveProperty("clientAutoBlocked");
    }

    // Licznik pokazuje nieobecności gościa, ale numer nie zakłada blokady.
    expect(await noShowCount(ids.salonA, card)).toBe(THRESHOLD);
    expect((await blockOf(card)).blockedAt).toBeNull();
    expect(await appointmentCards(visits)).toEqual([null, null]);
    expect(await clientCount(ids.salonA)).toBe(cardsBefore);
    // Obie nieobecności tylko po telefonie — tyle pokazuje linia pod licznikiem.
    expect((await noShowCounter(ids.salonA, card)).phoneOnlyCount).toBe(THRESHOLD);
  });

  it("1b: phoneOnlyCount — wizyta po telefonie i e-mailu naraz nie jest „tylko po telefonie”", async () => {
    const card = await insertClient(ids.salonA, {
      phone: PHONE_AND_EMAIL,
      email: emailOf(PHONE_AND_EMAIL_CUSTOMER),
    });
    // Wizyta z kartą, wizyta konta (zweryfikowany e-mail karty) z numerem karty
    // i wizyta gościa z numerem karty: tylko ostatnia jest „tylko po telefonie”.
    const visits = [
      await insertOnline(ids.salonA, { clientId: card }),
      await insertOnline(ids.salonA, {
        bookedByUserId: PHONE_AND_EMAIL_CUSTOMER,
        guestPhone: `+48${PHONE_AND_EMAIL}`,
      }),
      await insertOnline(ids.salonA, { guestPhone: `+48${PHONE_AND_EMAIL}` }),
    ];
    expect(await noShowCounter(ids.salonA, card)).toEqual({ noShowCount: 0, phoneOnlyCount: 0 });

    // Kolejność: najpierw gość, żeby karta nie przekroczyła progu przed końcem.
    await markNoShow(ids.salonA, visits[2]!);
    expect(await noShowCounter(ids.salonA, card)).toEqual({ noShowCount: 1, phoneOnlyCount: 1 });
    await markNoShow(ids.salonA, visits[1]!);
    expect(await noShowCounter(ids.salonA, card)).toEqual({ noShowCount: 2, phoneOnlyCount: 1 });
    expect((await blockOf(card)).blockedAt).toBeNull();
    // Wizyta z kartą dochodzi do progu (2 bez telefonu) → blokada, linia bez zmian.
    const third = await markNoShow(ids.salonA, visits[0]!);
    expect(third.body.data?.clientAutoBlocked).toBe(true);
    expect(await noShowCounter(ids.salonA, card)).toEqual({ noShowCount: 3, phoneOnlyCount: 1 });
  });

  it("2: zalogowany ze zweryfikowanym e-mailem po progu → karta (inna wielkość liter, spacja) zablokowana", async () => {
    const card = await insertClient(ids.salonA, { email: ` ${CUSTOMER_EMAIL.toUpperCase()}` });
    const visits = [
      await insertOnline(ids.salonA, { bookedByUserId: CUSTOMER }),
      await insertOnline(ids.salonA, { bookedByUserId: CUSTOMER }),
    ];

    expect((await markNoShow(ids.salonA, visits[0]!)).body.data).not.toHaveProperty("clientAutoBlocked");
    expect(await noShowCount(ids.salonA, card)).toBe(1);
    expect((await blockOf(card)).blockedAt).toBeNull();

    const second = await markNoShow(ids.salonA, visits[1]!);
    expect(second.status).toBe(200);
    expect(second.body.data?.clientAutoBlocked).toBe(true);
    expect(await blockOf(card)).toMatchObject({ blockedBy: "auto", blockedAt: expect.any(Date) });
    expect(await noShowCount(ids.salonA, card)).toBe(2);
    expect(await appointmentCards(visits)).toEqual([null, null]);
  });

  it("2b: konto z niezweryfikowanym e-mailem nie liczy się do karty z tym e-mailem", async () => {
    const card = await insertClient(ids.salonA, { email: UNVERIFIED_EMAIL });
    for (let i = 0; i < THRESHOLD; i++) {
      const visit = await insertOnline(ids.salonA, { bookedByUserId: UNVERIFIED });
      expect((await markNoShow(ids.salonA, visit)).body.data).not.toHaveProperty("clientAutoBlocked");
    }
    expect((await blockOf(card)).blockedAt).toBeNull();
    expect(await noShowCount(ids.salonA, card)).toBe(0);
  });

  it("2c: zalogowany wpisał telefon karty, ale ma inny e-mail → licznik rośnie, karta bez blokady", async () => {
    const card = await insertClient(ids.salonA, { phone: PHONE_TYPED_BY_USER, email: `inna-${RUN}@example.invalid` });
    for (let i = 0; i < THRESHOLD; i++) {
      const visit = await insertOnline(ids.salonA, {
        bookedByUserId: PHONE_TYPER,
        guestPhone: `+48${PHONE_TYPED_BY_USER}`,
      });
      expect((await markNoShow(ids.salonA, visit)).body.data).not.toHaveProperty("clientAutoBlocked");
    }
    expect(await noShowCount(ids.salonA, card)).toBe(THRESHOLD);
    expect((await blockOf(card)).blockedAt).toBeNull();
  });

  it("3: brak karty → 200 bez blokady, żadna karta nie powstaje", async () => {
    const cardsBefore = await clientCount(ids.salonA);
    for (let i = 0; i < THRESHOLD; i++) {
      const visit = await insertOnline(ids.salonA, { guestPhone: `+48${PHONE_NO_CARD}` });
      const res = await markNoShow(ids.salonA, visit);
      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty("clientAutoBlocked");
    }
    expect(await clientCount(ids.salonA)).toBe(cardsBefore);
  });

  it("4: karta tylko w salonie B → nieobecności w A nie liczą się nigdzie", async () => {
    const cardB = await insertClient(ids.salonB, {
      phone: `+48${PHONE_OTHER_SALON}`,
      email: emailOf(OTHER_SALON_CUSTOMER),
    });
    for (let i = 0; i < THRESHOLD; i++) {
      for (const who of [{ guestPhone: `+48${PHONE_OTHER_SALON}` }, { bookedByUserId: OTHER_SALON_CUSTOMER }]) {
        const visit = await insertOnline(ids.salonA, who);
        expect((await markNoShow(ids.salonA, visit)).body.data).not.toHaveProperty("clientAutoBlocked");
      }
    }
    expect((await blockOf(cardB)).blockedAt).toBeNull();
    expect(await noShowCount(ids.salonB, cardB)).toBe(0);

    // Kontrola fałszywej zieleni: w salonie B ten sam klient się liczy —
    // telefon na liczniku, zweryfikowany e-mail także do progu.
    await markNoShow(ids.salonB, await insertOnline(ids.salonB, { guestPhone: PHONE_OTHER_SALON }));
    expect(await noShowCount(ids.salonB, cardB)).toBe(1);
    expect((await blockOf(cardB)).blockedAt).toBeNull();
    for (let i = 0; i < THRESHOLD; i++) {
      await markNoShow(ids.salonB, await insertOnline(ids.salonB, { bookedByUserId: OTHER_SALON_CUSTOMER }));
    }
    expect((await blockOf(cardB)).blockedBy).toBe("auto");
    expect(await noShowCount(ids.salonB, cardB)).toBe(THRESHOLD + 1);
  });

  it("5: dwie karty z e-mailem tego samego konta → nieobecności liczą się do obu, obie zablokowane", async () => {
    const cardOne = await insertClient(ids.salonA, { email: emailOf(TWO_CARDS_CUSTOMER) });
    const cardTwo = await insertClient(ids.salonA, { email: emailOf(TWO_CARDS_CUSTOMER).toUpperCase() });
    const visits = [
      await insertOnline(ids.salonA, { bookedByUserId: TWO_CARDS_CUSTOMER }),
      await insertOnline(ids.salonA, { bookedByUserId: TWO_CARDS_CUSTOMER }),
    ];

    await markNoShow(ids.salonA, visits[0]!);
    expect(await noShowCount(ids.salonA, cardOne)).toBe(1);
    expect(await noShowCount(ids.salonA, cardTwo)).toBe(1);
    const second = await markNoShow(ids.salonA, visits[1]!);
    expect(second.body.data?.clientAutoBlocked).toBe(true);
    expect((await blockOf(cardOne)).blockedBy).toBe("auto");
    expect((await blockOf(cardTwo)).blockedBy).toBe("auto");
  });

  it("5b: dwie karty z tym samym numerem (różne zapisy) → licznik obu, obie bez blokady", async () => {
    const cardOne = await insertClient(ids.salonA, { phone: `0048 ${PHONE_TWO_CARDS}` });
    const cardTwo = await insertClient(ids.salonA, { phone: `(+48) 600-300-103` });
    for (let i = 0; i < THRESHOLD; i++) {
      const visit = await insertOnline(ids.salonA, { guestPhone: `+48${PHONE_TWO_CARDS}` });
      expect((await markNoShow(ids.salonA, visit)).body.data).not.toHaveProperty("clientAutoBlocked");
    }
    expect(await noShowCount(ids.salonA, cardOne)).toBe(THRESHOLD);
    expect(await noShowCount(ids.salonA, cardTwo)).toBe(THRESHOLD);
    expect((await blockOf(cardOne)).blockedAt).toBeNull();
    expect((await blockOf(cardTwo)).blockedAt).toBeNull();
  });

  it("6: numer nieczytelny na karcie i wizycie → brak dopasowania", async () => {
    const card = await insertClient(ids.salonA, { phone: PHONE_UNREADABLE });
    for (let i = 0; i < THRESHOLD; i++) {
      const visit = await insertOnline(ids.salonA, { guestPhone: PHONE_UNREADABLE });
      expect((await markNoShow(ids.salonA, visit)).body.data).not.toHaveProperty("clientAutoBlocked");
    }
    expect((await blockOf(card)).blockedAt).toBeNull();
    expect(await noShowCount(ids.salonA, card)).toBe(0);
  });

  it("7: próg wyłączony → bez blokady, licznik na karcie i tak liczy", async () => {
    const card = await insertClient(ids.salonC, { phone: PHONE_THRESHOLD_OFF });
    for (let i = 0; i < THRESHOLD + 1; i++) {
      const visit = await insertOnline(ids.salonC, { guestPhone: `+48${PHONE_THRESHOLD_OFF}` });
      expect((await markNoShow(ids.salonC, visit)).body.data).not.toHaveProperty("clientAutoBlocked");
    }
    expect((await blockOf(card)).blockedAt).toBeNull();
    expect(await noShowCount(ids.salonC, card)).toBe(THRESHOLD + 1);
  });

  it("8: dwie wizyty online tej samej karty (po e-mailu) oznaczane równolegle → jedna blokada albo 409 RETRY", async () => {
    const card = await insertClient(ids.salonA, { email: emailOf(RACE_CUSTOMER) });
    const visits: [string, string] = [
      await insertOnline(ids.salonA, { bookedByUserId: RACE_CUSTOMER }),
      await insertOnline(ids.salonA, { bookedByUserId: RACE_CUSTOMER }),
    ];

    const results = await raceNoShows(ids.salonA, card, visits);

    await expectSingleBlockOrRetry(ids.salonA, card, visits, results);
  });

  it("8b: wizyta z kartą i wizyta online po e-mailu tego samego klienta równolegle → jedna blokada albo 409 RETRY", async () => {
    const card = await insertClient(ids.salonA, { email: emailOf(RACE_MIXED_CUSTOMER) });
    const visits: [string, string] = [
      await insertOnline(ids.salonA, { clientId: card }),
      await insertOnline(ids.salonA, { bookedByUserId: RACE_MIXED_CUSTOMER }),
    ];

    const results = await raceNoShows(ids.salonA, card, visits);

    await expectSingleBlockOrRetry(ids.salonA, card, visits, results);
    // Wizyta online dalej bez karty.
    const [online] = await h!.db
      .select({ clientId: appointments.clientId })
      .from(appointments)
      .where(and(eq(appointments.id, visits[1]), eq(appointments.salonId, ids.salonA)));
    expect(online!.clientId).toBeNull();
  });
});
