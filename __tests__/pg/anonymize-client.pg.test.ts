/**
 * Anonimizacja danych klienta przed usunięciem kartoteki (`anonymizeClientData`)
 * na PRAWDZIWYM Postgresie — salony A i B z klientem-wartownikiem o tych samych
 * danych (imię, nazwisko, telefon, e-mail).
 *
 * Ścieżka jak w trasie usuwania: `forSalon(A).raw` (rola bez BYPASSRLS
 * i kontekst salonu), w jednej transakcji `anonymizeClientData`, potem
 * `DELETE clients`.
 *
 * Dowody:
 * a) po anonimizacji i usunięciu w żadnej kolumnie `text`/`varchar`/`json`/
 *    `jsonb`/tablicowej (porównanie przez `::text`) tabel appointments,
 *    notifications, treatment_history, appointment_materials,
 *    ai_conversations, reviews, clients (wiersze salonu A) nie ma imienia,
 *    nazwiska, telefonu ani e-maila wartownika; kolumny z `information_schema`,
 *    więc nowa kolumna tych typów trafia do sprawdzenia bez zmiany testu;
 *    Wizyty salonu A nie wskazują już konta portalu klienta
 *    (`booked_by_user_id`), konto zostaje, wizyty salonu B wskazują je dalej;
 * b) biała lista: liczba wizyt, suma zadatków i rabatów, statusy, pracownik,
 *    usługa i oceny bez zmian; liczniki zwrócone przez funkcję;
 * c) rozdzielenie: wiersze wartownika salonu B są identyczne przed i po,
 *    także opinia salonu B przypięta do wizyty salonu A;
 * d) wywołanie z salonem B i klientem A (kontekst salonu B) nic nie zmienia
 *    i zwraca zera;
 * e) to samo wywołanie na połączeniu testu, które omija RLS: zera i dane A
 *    bez zmian — same jawne warunki `salon_id`, bez pomocy RLS;
 * f) każdy klucz obcy do `clients` i `appointments` z `pg_constraint` ma
 *    przypisaną obsługę w przypiętej mapie; nowa tabela z takim kluczem
 *    wywraca test, dopóki ktoś nie zdecyduje, co z jej danymi.
 *
 * Mocki: `@/lib/db` → pula testu, logger. Dane: użytkownicy `it-t3-anon-…`;
 * reszta kaskadą z salonów w `afterAll`. Dane kontaktowe w domenie example.invalid.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=<lokalna baza testowa> pnpm test:pg -- __tests__/pg/anonymize-client.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate` (RLS, rola aplikacji).
 */
import { randomInt, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  aiConversations,
  appointmentMaterials,
  appointments,
  clients,
  employees,
  notifications,
  products,
  reviews,
  salons,
  services,
  treatmentHistory,
  user,
} from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import {
  anonymizeClientData,
  REMOVED_MESSAGE_PLACEHOLDER,
} from "@/lib/server/retention/anonymize-client";

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
const OWNER_A = `it-t3-anon-a-${RUN}`;
const OWNER_B = `it-t3-anon-b-${RUN}`;
/** Konto portalu klienta, z którego zarezerwowano wizyty w obu salonach. */
const PORTAL_USER = `it-t3-anon-p-${RUN}`;
const USERS = [OWNER_A, OWNER_B, PORTAL_USER];

/** Wartownik: wartości, których nie ma nigdzie indziej w bazie. */
const SENTINEL = {
  firstName: `Wartoslawa${RUN}`,
  lastName: `Zetowska${RUN}`,
  phone: `+48 6${String(randomInt(10_000_000, 99_999_999))}`,
  email: `wartownik-${RUN}@example.invalid`,
};
const SENTINEL_VALUES = [SENTINEL.firstName, SENTINEL.lastName, SENTINEL.phone, SENTINEL.email];
const FULL_NAME = `${SENTINEL.firstName} ${SENTINEL.lastName}`;
const CONTACT = `${FULL_NAME}, tel. ${SENTINEL.phone}, ${SENTINEL.email}`;

/** Tabele sprawdzane w (a); `clients` dla pewności, że wiersz zniknął razem z danymi. */
const SCANNED_TABLES = [
  "appointments",
  "notifications",
  "treatment_history",
  "appointment_materials",
  "ai_conversations",
  "reviews",
  "clients",
] as const;

/**
 * Obsługa każdego klucza obcego do `clients` i `appointments` przy usunięciu
 * kartoteki (klucz: `tabela(kolumny)`). Nowy klucz spoza mapy = czerwony (f).
 * - anonymized: `anonymizeClientData` zeruje wolny tekst (tabela w `SCANNED_TABLES`);
 * - cascade: wiersze znikają kaskadą razem z kartoteką albo wizytą;
 * - billing: dokumenty rozliczeniowe przechowywane z przepisów podatkowych;
 * - deposit: płatności i historia zadatku, obsługiwane osobno;
 * - noClientText: tabela bez danych osobowych klienta (kwoty, ilości).
 */
const CLIENT_FK_HANDLING: Record<string, "anonymized" | "cascade" | "billing" | "deposit" | "noClientText"> = {
  "appointments(client_id)": "anonymized",
  "notifications(client_id)": "anonymized",
  "ai_conversations(client_id)": "anonymized",
  "reviews(client_id)": "anonymized",
  "reviews(appointment_id)": "anonymized",
  "treatment_history(appointment_id)": "anonymized",
  "appointment_materials(appointment_id)": "anonymized",
  "waiting_list(client_id)": "cascade",
  "waiting_list(existing_appointment_id)": "cascade",
  "loyalty_points(client_id)": "cascade",
  "loyalty_transactions(appointment_id)": "cascade",
  "marketing_consents(client_id)": "cascade",
  "invoices(client_id)": "billing",
  "invoices(appointment_id)": "billing",
  "fiscal_receipts(appointment_id)": "billing",
  "deposit_payments(appointment_id)": "deposit",
  "deposit_status_events(appointment_id,salon_id)": "deposit",
  "employee_commissions(appointment_id)": "noClientText",
  "product_usage(appointment_id)": "noClientText",
};

type SalonFixture = {
  salonId: string;
  clientId: string;
  appointmentIds: string[];
  reviewIds: string[];
};

const fx: { a: SalonFixture; b: SalonFixture; foreignReviewId: string } = {
  a: { salonId: "", clientId: "", appointmentIds: [], reviewIds: [] },
  b: { salonId: "", clientId: "", appointmentIds: [], reviewIds: [] },
  foreignReviewId: "",
};

const ZERO_COUNTS = {
  appointments: 0,
  treatmentHistory: 0,
  appointmentMaterials: 0,
  notifications: 0,
  aiConversations: 0,
  reviews: 0,
};

/** Salon z klientem-wartownikiem i pełnym zestawem powiązanych wierszy. */
async function seedSalon(ownerId: string): Promise<SalonFixture> {
  const db = h!.db;
  const [salon] = await db
    .insert(salons)
    .values({ name: `IT T3 anon ${ownerId}`, ownerId })
    .returning({ id: salons.id });
  const salonId = salon!.id;
  const [employee] = await db
    .insert(employees)
    .values({ salonId, firstName: "Pracownik", lastName: `P-${RUN}` })
    .returning({ id: employees.id });
  const [service] = await db
    .insert(services)
    .values({ salonId, name: `Usluga ${RUN}`, basePrice: "150.00", baseDuration: 60 })
    .returning({ id: services.id });
  const [product] = await db
    .insert(products)
    .values({ salonId, name: `Farba ${RUN}` })
    .returning({ id: products.id });
  const [client] = await db
    .insert(clients)
    .values({
      salonId,
      firstName: SENTINEL.firstName,
      lastName: SENTINEL.lastName,
      phone: SENTINEL.phone,
      email: SENTINEL.email,
      notes: `Notatka o ${FULL_NAME}`,
    })
    .returning({ id: clients.id });
  const clientId = client!.id;

  const base = Date.UTC(2026, 0, 10, 9, 0, 0);
  const hour = 60 * 60 * 1000;
  const appts = await db
    .insert(appointments)
    .values([
      {
        salonId,
        clientId,
        employeeId: employee!.id,
        serviceId: service!.id,
        startTime: new Date(base),
        endTime: new Date(base + hour),
        status: "completed",
        bookedByUserId: PORTAL_USER,
        notes: `Dzwonic: ${CONTACT}`,
        depositAmount: "45.00",
        depositPaid: true,
        discountAmount: "10.00",
        guestName: FULL_NAME,
        guestPhone: SENTINEL.phone,
        guestEmail: SENTINEL.email,
      },
      {
        salonId,
        clientId,
        employeeId: employee!.id,
        serviceId: service!.id,
        startTime: new Date(base + 24 * hour),
        endTime: new Date(base + 25 * hour),
        status: "cancelled",
        bookedByUserId: PORTAL_USER,
        notes: `Odwolala ${SENTINEL.firstName}`,
        depositAmount: "30.00",
        depositPaid: false,
      },
      // Bez opinii własnego salonu — pod opinię drugiego salonu (c).
      {
        salonId,
        clientId,
        employeeId: employee!.id,
        serviceId: service!.id,
        startTime: new Date(base + 48 * hour),
        endTime: new Date(base + 49 * hour),
        status: "scheduled",
      },
    ])
    .returning({ id: appointments.id });
  const appointmentIds = appts.map((a) => a.id);

  await db.insert(treatmentHistory).values({
    appointmentId: appointmentIds[0]!,
    recipe: `Receptura dla ${FULL_NAME}`,
    techniques: `Technika ${SENTINEL.lastName}`,
    notes: `Uwagi ${SENTINEL.phone}`,
    // Trasa przyjmuje tu dowolny JSON — także dane klienta.
    materialsJson: [{ name: "Farba", note: `Dla ${FULL_NAME}, tel. ${SENTINEL.phone}` }],
  });
  await db.insert(appointmentMaterials).values({
    appointmentId: appointmentIds[0]!,
    productId: product!.id,
    quantityUsed: "1.00",
    notes: `Zuzyte u ${SENTINEL.email}`,
  });
  await db.insert(notifications).values([
    { salonId, clientId, type: "sms", message: `Przypomnienie: ${CONTACT}`, status: "sent" },
    { salonId, clientId, type: "email", message: `Potwierdzenie dla ${SENTINEL.email}`, status: "sent" },
  ]);
  await db.insert(aiConversations).values({
    salonId,
    clientId,
    channel: "chat",
    transcript: `Klientka ${CONTACT} pyta o termin`,
  });
  const revs = await db
    .insert(reviews)
    .values([
      {
        salonId,
        clientId,
        employeeId: employee!.id,
        appointmentId: appointmentIds[0]!,
        rating: 5,
        comment: `Polecam, ${FULL_NAME}`,
        ownerResponse: `Szanowny/a ${FULL_NAME}, dziekujemy za opinie.`,
        ownerResponseAt: new Date(base + 2 * hour),
        status: "approved",
      },
      // Opinia z portalu wystawiona, gdy wizyta nie miała jeszcze kartoteki:
      // `client_id = NULL`, powiązanie tylko przez wizytę klienta.
      {
        salonId,
        clientId: null,
        employeeId: employee!.id,
        appointmentId: appointmentIds[1]!,
        rating: 4,
        comment: `Pisze ${SENTINEL.firstName}, tel. ${SENTINEL.phone}`,
        status: "pending",
      },
    ])
    .returning({ id: reviews.id });

  return { salonId, clientId, appointmentIds, reviewIds: revs.map((r) => r.id) };
}

/**
 * Kolumny tabeli, które mogą nieść tekst klienta: `text`, `varchar`, `char`,
 * `json`, `jsonb` i tablice (`ARRAY`) — z `information_schema`.
 */
async function scannedColumns(table: string): Promise<string[]> {
  const rows = await h!.observer<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = ${table}
      and data_type in ('text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY')
    order by column_name
  `;
  return rows.map((r) => r.column_name);
}

/** Czy tabela ma własną kolumnę `salon_id` (inaczej salon przez wizytę). */
async function hasSalonColumn(table: string): Promise<boolean> {
  const rows = await h!.observer<{ n: number }[]>`
    select count(*)::int as n
    from information_schema.columns
    where table_schema = 'public' and table_name = ${table} and column_name = 'salon_id'
  `;
  return (rows[0]?.n ?? 0) > 0;
}

/**
 * Trafienia wartości wartownika w skanowanych kolumnach wierszy danego salonu:
 * lista `tabela.kolumna: wartość`. Porównanie po `::text`, więc JSON i tablice
 * też. Identyfikatory z `information_schema` cytowane przez `sql()`
 * sterownika; wartości jako parametry.
 */
async function sentinelHits(salonId: string): Promise<string[]> {
  const hits: string[] = [];
  for (const table of SCANNED_TABLES) {
    const columns = await scannedColumns(table);
    expect(columns.length, `${table}: brak skanowanych kolumn w information_schema`).toBeGreaterThan(0);
    const scoped = await hasSalonColumn(table);
    for (const column of columns) {
      for (const value of SENTINEL_VALUES) {
        const pattern = `%${value}%`;
        const rows = scoped
          ? await h!.observer<{ n: number }[]>`
              select count(*)::int as n from ${h!.observer(table)} t
              where t.salon_id = ${salonId} and t.${h!.observer(column)}::text ilike ${pattern}
            `
          : await h!.observer<{ n: number }[]>`
              select count(*)::int as n from ${h!.observer(table)} t
              join appointments a on a.id = t.appointment_id
              where a.salon_id = ${salonId} and t.${h!.observer(column)}::text ilike ${pattern}
            `;
        if ((rows[0]?.n ?? 0) > 0) hits.push(`${table}.${column}: ${value}`);
      }
    }
  }
  return hits;
}

/** Biała lista wizyt salonu: liczba, suma kwot i pola, które mają zostać. */
async function appointmentWhitelist(appointmentIds: string[]) {
  const [agg] = await h!.db
    .select({
      count: sql<number>`count(*)::int`,
      deposits: sql<string>`coalesce(sum(${appointments.depositAmount}), 0)::text`,
      discounts: sql<string>`coalesce(sum(${appointments.discountAmount}), 0)::text`,
    })
    .from(appointments)
    .where(inArray(appointments.id, appointmentIds));
  const rows = await h!.db
    .select({
      id: appointments.id,
      startTime: appointments.startTime,
      endTime: appointments.endTime,
      employeeId: appointments.employeeId,
      serviceId: appointments.serviceId,
      status: appointments.status,
      depositAmount: appointments.depositAmount,
      depositPaid: appointments.depositPaid,
      discountAmount: appointments.discountAmount,
    })
    .from(appointments)
    .where(inArray(appointments.id, appointmentIds))
    .orderBy(appointments.startTime);
  return { agg, rows };
}

/** Pełny obraz wierszy salonu powiązanych z klientem — do porównania przed/po. */
async function salonSnapshot(f: SalonFixture) {
  const db = h!.db;
  return {
    client: await db.select().from(clients).where(eq(clients.id, f.clientId)),
    appointments: await db
      .select()
      .from(appointments)
      .where(inArray(appointments.id, f.appointmentIds))
      .orderBy(appointments.startTime),
    treatment: await db
      .select()
      .from(treatmentHistory)
      .where(inArray(treatmentHistory.appointmentId, f.appointmentIds)),
    materials: await db
      .select()
      .from(appointmentMaterials)
      .where(inArray(appointmentMaterials.appointmentId, f.appointmentIds)),
    notifications: await db
      .select()
      .from(notifications)
      .where(eq(notifications.clientId, f.clientId))
      .orderBy(notifications.type),
    conversations: await db.select().from(aiConversations).where(eq(aiConversations.clientId, f.clientId)),
    reviews: await db.select().from(reviews).where(inArray(reviews.id, f.reviewIds)).orderBy(reviews.rating),
  };
}

const suite = h ? describe : describe.skip;

suite("anonimizacja klienta przed usunięciem kartoteki, prawdziwy Postgres", () => {
  beforeAll(async () => {
    await h!.db.insert(user).values(
      USERS.map((id) => ({ id, name: `IT T3 anon ${id}`, email: `${id}@example.invalid`, emailVerified: true }))
    );
    fx.a = await seedSalon(OWNER_A);
    fx.b = await seedSalon(OWNER_B);
    // Opinia salonu B przypięta do wizyty klienta w salonie A (spójności salonu
    // opinii i wizyty nie pilnuje żaden klucz). Anonimizacja w A ma jej nie ruszyć.
    const [foreign] = await h!.db
      .insert(reviews)
      .values({
        salonId: fx.b.salonId,
        clientId: null,
        appointmentId: fx.a.appointmentIds[2]!,
        rating: 3,
        comment: `Obcy salon, ${FULL_NAME}`,
        status: "pending",
      })
      .returning({ id: reviews.id });
    fx.foreignReviewId = foreign!.id;
    fx.b.reviewIds.push(foreign!.id);
  });

  afterAll(async () => {
    if (!h) return;
    try {
      const salonIds = [fx.a.salonId, fx.b.salonId].filter(Boolean);
      if (salonIds.length > 0) await h.db.delete(salons).where(inArray(salons.id, salonIds));
      await h.db.delete(user).where(inArray(user.id, USERS));
    } finally {
      await h.end();
    }
  });

  it("kontrola fałszywej zieleni: przed anonimizacją skan znajduje wartownika w obu salonach", async () => {
    const hitsA = await sentinelHits(fx.a.salonId);
    const hitsB = await sentinelHits(fx.b.salonId);
    for (const hits of [hitsA, hitsB]) {
      for (const expected of [
        "appointments.guest_name",
        "appointments.guest_phone",
        "appointments.guest_email",
        "appointments.notes",
        "notifications.message",
        "treatment_history.recipe",
        "treatment_history.techniques",
        "treatment_history.notes",
        "treatment_history.materials_json",
        "appointment_materials.notes",
        "ai_conversations.transcript",
        "reviews.comment",
        "reviews.owner_response",
        "clients.first_name",
      ]) {
        expect(hits.some((hit) => hit.startsWith(`${expected}:`)), `brak trafienia ${expected}`).toBe(true);
      }
    }
  });

  it("d) salon B wołający dla klienta A (kontekst B): zera, dane A bez zmian", async () => {
    const before = await salonSnapshot(fx.a);
    const counts = await forSalon(fx.b.salonId).raw((tx) => anonymizeClientData(tx, fx.b.salonId, fx.a.clientId));
    expect(counts).toEqual(ZERO_COUNTS);
    expect(await salonSnapshot(fx.a)).toEqual(before);
  });

  it("e) salon B dla klienta A na połączeniu z obejściem RLS: zera, dane A bez zmian", async () => {
    const before = await salonSnapshot(fx.a);
    const counts = await h!.db.transaction(async (tx) => {
      // Dowód, że RLS niczego tu nie filtruje: bez kontekstu salonu klient A
      // jest widoczny, więc zera dają wyłącznie jawne warunki `salon_id`.
      const visible = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, fx.a.clientId));
      expect(visible).toHaveLength(1);
      return anonymizeClientData(tx, fx.b.salonId, fx.a.clientId);
    });
    expect(counts).toEqual(ZERO_COUNTS);
    expect(await salonSnapshot(fx.a)).toEqual(before);
  });

  it("f) każdy klucz obcy do clients i appointments ma przypisaną obsługę", async () => {
    const rows = await h!.observer<{ fk: string }[]>`
      select c.conrelid::regclass::text || '(' || string_agg(a.attname, ',' order by k.ord) || ')' as fk
      from pg_constraint c
      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.contype = 'f'
        and c.confrelid in ('public.clients'::regclass, 'public.appointments'::regclass)
        and c.connamespace = 'public'::regnamespace
      group by c.oid, c.conrelid
      order by 1
    `;
    const found = rows.map((r) => r.fk).sort();
    expect(found, "klucz obcy bez decyzji w CLIENT_FK_HANDLING (albo wpis mapy bez klucza)").toEqual(
      Object.keys(CLIENT_FK_HANDLING).sort()
    );
    for (const [fk, handling] of Object.entries(CLIENT_FK_HANDLING)) {
      if (handling !== "anonymized") continue;
      const table = fk.slice(0, fk.indexOf("("));
      expect(SCANNED_TABLES as readonly string[], `${fk}: tabela anonimizowana poza skanem`).toContain(table);
    }
  });

  it("a–c) anonimizacja i DELETE w jednej transakcji salonu A: brak danych wartownika, biała lista i salon B bez zmian", async () => {
    const whitelistBefore = await appointmentWhitelist(fx.a.appointmentIds);
    const ratingsBefore = await h!.db
      .select({ id: reviews.id, rating: reviews.rating, status: reviews.status, employeeId: reviews.employeeId })
      .from(reviews)
      .where(inArray(reviews.id, fx.a.reviewIds))
      .orderBy(reviews.rating);
    const snapshotB = await salonSnapshot(fx.b);

    const counts = await forSalon(fx.a.salonId).raw(async (tx) => {
      const result = await anonymizeClientData(tx, fx.a.salonId, fx.a.clientId);
      await tx.delete(clients).where(eq(clients.id, fx.a.clientId));
      return result;
    });

    expect(counts).toEqual({
      appointments: 3,
      treatmentHistory: 1,
      appointmentMaterials: 1,
      notifications: 2,
      aiConversations: 1,
      reviews: 2,
    });

    // a) brak wartownika w kolumnach tekstowych wierszy salonu A
    expect(await sentinelHits(fx.a.salonId)).toEqual([]);
    expect(await h!.db.select().from(clients).where(eq(clients.id, fx.a.clientId))).toEqual([]);
    const messages = await h!.db
      .select({ message: notifications.message })
      .from(notifications)
      .where(eq(notifications.salonId, fx.a.salonId));
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.message === REMOVED_MESSAGE_PLACEHOLDER)).toBe(true);

    // a') żadna wizyta salonu A nie wskazuje już konta portalu klienta; samo
    // konto zostaje, a wizyty salonu B dalej je wskazują.
    const bookedInA = await h!.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.salonId, fx.a.salonId), eq(appointments.bookedByUserId, PORTAL_USER)));
    expect(bookedInA).toEqual([]);
    const bookedInB = await h!.db
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.salonId, fx.b.salonId), eq(appointments.bookedByUserId, PORTAL_USER)));
    expect(bookedInB).toHaveLength(2);
    expect(await h!.db.select({ id: user.id }).from(user).where(eq(user.id, PORTAL_USER))).toHaveLength(1);

    // b) biała lista: wizyty, kwoty, statusy, pracownik, usługa, oceny
    const whitelistAfter = await appointmentWhitelist(fx.a.appointmentIds);
    expect(whitelistAfter).toEqual(whitelistBefore);
    expect(whitelistAfter.agg).toEqual({ count: 3, deposits: "75.00", discounts: "10.00" });
    const ratingsAfter = await h!.db
      .select({ id: reviews.id, rating: reviews.rating, status: reviews.status, employeeId: reviews.employeeId })
      .from(reviews)
      .where(inArray(reviews.id, fx.a.reviewIds))
      .orderBy(reviews.rating);
    expect(ratingsAfter).toEqual(ratingsBefore);

    // c) salon B: te same dane wartownika nietknięte, także opinia B przy wizycie A
    expect(await salonSnapshot(fx.b)).toEqual(snapshotB);
    const [foreign] = await h!.db
      .select({ comment: reviews.comment })
      .from(reviews)
      .where(eq(reviews.id, fx.foreignReviewId));
    expect(foreign?.comment).toContain(SENTINEL.firstName);
    expect((await sentinelHits(fx.b.salonId)).length).toBeGreaterThan(0);
  });
});
