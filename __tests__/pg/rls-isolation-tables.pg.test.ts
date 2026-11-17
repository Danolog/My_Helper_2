/**
 * #193: izolacja salonów na KAŻDEJ tabeli z RLS, pod rolą aplikacji (`myhelper_app`), na danych
 * zbudowanych przez sam test.
 *
 * Dane: jedna transakcja na jednym połączeniu, rolą migracji, wycofywana na
 * końcu pliku. Wiersze salonów A i B wraz z rodzicami tworzą jawne fabryki
 * `tabela → minimalny poprawny wiersz` (FACTORIES). Test nie kopiuje istniejących wierszy i nie
 * czyta danych bazy, więc wynik nie zależy od seeda. Dane spoza salonu (konto w `user`, plan
 * w `subscription_plans`) też powstają w tej transakcji, rolą migracji.
 *
 * Kompletność: klucze FACTORIES == tabele z RLS z parsera migracji (`loadRlsRequirements`)
 * == tabele z `relrowsecurity` w bazie (katalog). Nowa tabela z RLS bez fabryki albo fabryka
 * bez tabeli → czerwony. Kolumna przypisania do salonu zadeklarowana w fabryce musi zgadzać się
 * z treścią polityki w `pg_policies` (USING), a WITH CHECK każdej polityki jest równy USING.
 * Katalog czyta połączenie transakcji testu.
 *
 * Na każdą tabelę, pod `SET LOCAL ROLE myhelper_app` (każdy krok w SAVEPOINT / ROLLBACK TO):
 * - (a) kontekst A widzi swój wiersz i żaden wiersz spoza salonu A;
 * - (b) kontekst B widzi wiersz B (kontrola fałszywej zieleni);
 * - (c) INSERT wiersza salonu B w kontekście A → 42501 z polityki RLS;
 * - (d) UPDATE wiersza A przepinający go do B (salon albo rodzic) → 42501 z polityki RLS;
 *   UPDATE z WHERE po kolumnie podlega także USING dla nowego wiersza, więc krok sprawdza
 *   łącznie USING i WITH CHECK;
 * - (e) UPDATE i DELETE wiersza B w kontekście A → 0 wierszy; wiersz B, sprawdzony rolą
 *   migracji w tym samym kroku, bez zmian;
 * - (f) bez kontekstu (zmienna = '', jak po transakcji forSalon): odczyt → 0 wierszy,
 *   INSERT → 42501 z polityki RLS.
 * 42501 liczy się tylko z komunikatem o polityce RLS (brak uprawnienia do tabeli to inny powód).
 * INSERT w (c) i (f) jest bez RETURNING, żeby odmowa pochodziła z WITH CHECK (przy RETURNING
 * nowy wiersz sprawdza też USING).
 * Zachowanie na świeżym połączeniu (zmienna nieustawiona) sprawdza `salon-context-nullif.pg.test.ts`.
 *
 * Nic nie jest zatwierdzane; ostatni test wycofuje transakcję i sprawdza, że wierszy testu nie ma.
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm exec vitest run --config vitest.pg.config.ts __tests__/pg/rls-isolation-tables.pg.test.ts
 *
 * Wymaga bazy po `pnpm db:migrate`; seed niepotrzebny.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { APP_ROLE, loadRlsRequirements, SALON_CONTEXT_VAR } from "../../scripts/db-rls-guard";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const suite = h ? describe : describe.skip;

type Conn = { unsafe: (query: string, params?: unknown[]) => PromiseLike<readonly unknown[]> };
type Reserved = Conn & { release: () => void };

/** Kolumny wiersza (nazwa kolumny w bazie → wartość); typy nadaje `jsonb_populate_record`. */
type Row = Record<string, string | number>;

/** Kolumna, po której polityka przypisuje wiersz do salonu. */
type Via =
  | { kind: "self"; col: "id" }
  | { kind: "direct"; col: "salon_id" }
  | { kind: "parent"; col: string; parent: string };

/** Budowanie rodziców i danych spoza salonu, rolą migracji, w transakcji testu. */
interface Builder {
  /** Nowy wiersz tabeli `table` w salonie `salon` (z fabryki); zwraca id. */
  make(table: string, salon: string): Promise<string>;
  /** Nowe konto w `user` (dane spoza salonu); zwraca id. */
  user(): Promise<string>;
  /** Nowy plan w `subscription_plans` (dane globalne); zwraca id. */
  plan(): Promise<string>;
}

interface Factory {
  via: Via;
  /** Minimalny poprawny wiersz salonu `salon` (NOT NULL, CHECK, FK); rodziców tworzy przez `b`. */
  row: (b: Builder, salon: string) => Promise<Row>;
}

const SELF: Via = { kind: "self", col: "id" };
const DIRECT: Via = { kind: "direct", col: "salon_id" };
const viaParent = (parent: string, col: string): Via => ({ kind: "parent", parent, col });

/** Tabela z polityką po `salon_id`; `extra` dokłada pozostałe kolumny wymagane. */
const direct = (extra: (b: Builder, s: string) => Promise<Row> | Row = () => ({})): Factory => ({
  via: DIRECT,
  row: async (b, s) => ({ salon_id: s, ...(await extra(b, s)) }),
});
/** Tabela z polityką przez rodzica (EXISTS po kluczu obcym `col` do `parent`). */
const child = (parent: string, col: string, extra: (b: Builder, s: string) => Promise<Row> | Row = () => ({})): Factory => ({
  via: viaParent(parent, col),
  row: async (b, s) => ({ [col]: await b.make(parent, s), ...(await extra(b, s)) }),
});

/** Przedział czasu dla wierszy z CHECK koniec > początek (każda wizyta ma własnego pracownika, więc EXCLUDE nie koliduje). */
const START = "2030-01-07T10:00:00";
const END = "2030-01-07T11:00:00";
const PREFIX = "it-t3-c8";

/** Fabryki: jawna mapa `tabela z RLS → minimalny poprawny wiersz`. */
const FACTORIES: Record<string, Factory> = {
  salons: { via: SELF, row: async (b, s) => ({ id: s, name: "IT T3 C8", owner_id: await b.user() }) },

  clients: direct(() => ({ first_name: "IT", last_name: "C8" })),
  employees: direct(() => ({ first_name: "IT", last_name: "C8" })),
  service_categories: direct(() => ({ name: "IT C8" })),
  services: direct(() => ({ name: "IT C8", base_price: "10.00", base_duration: 30 })),
  appointments: direct(async (b, s) => ({ employee_id: await b.make("employees", s), start_time: START, end_time: END })),
  gallery_photos: direct(),
  albums: direct(() => ({ name: "IT C8" })),
  reviews: direct(),
  notifications: direct(() => ({ type: "email", message: "IT C8" })),
  waiting_list: direct(async (b, s) => ({ client_id: await b.make("clients", s) })),
  product_categories: direct(() => ({ name: "IT C8" })),
  products: direct(() => ({ name: "IT C8" })),
  promotions: direct(() => ({ name: "IT C8", type: "percentage", value: "10.00" })),
  promo_codes: direct(() => ({ code: "ITC8" })),
  loyalty_points: direct(async (b, s) => ({ client_id: await b.make("clients", s) })),
  invoices: direct(() => ({ invoice_number: "IT-C8", type: "paragon", amount: "10.00" })),
  newsletters: direct(() => ({ subject: "IT C8", content: "IT C8" })),
  marketing_consents: direct(async (b, s) => ({ client_id: await b.make("clients", s), consent_type: "email" })),
  favorite_salons: direct(async (b) => ({ client_user_id: await b.user() })),
  // Historyczny status: unikalność „jeden bieżący na salon” dotyczy tylko trialing/active.
  salon_subscriptions: direct(async (b) => ({ plan_id: await b.plan(), status: "canceled" })),
  subscription_payments: direct(async (b, s) => ({ subscription_id: await b.make("salon_subscriptions", s), amount: "10.00", status: "pending" })),
  deposit_payments: direct(async (b, s) => ({ appointment_id: await b.make("appointments", s), amount: "10.00", payment_method: "stripe" })),
  fiscal_receipts: direct(async (b, s) => ({
    appointment_id: await b.make("appointments", s),
    receipt_number: "IT-C8",
    service_price: "10.00",
    total_amount: "10.00",
  })),
  scheduled_posts: direct(() => ({ platform: "instagram", post_type: "promotion", content: "IT C8", scheduled_at: START })),
  ai_conversations: direct(() => ({ channel: "chat" })),
  ai_generated_media: direct(() => ({ type: "image", provider: "sharp" })),

  time_blocks: child("employees", "employee_id", () => ({ start_time: START, end_time: END, block_type: "break" })),
  work_schedules: child("employees", "employee_id", () => ({ day_of_week: 1, start_time: "09:00", end_time: "17:00" })),
  employee_services: child("employees", "employee_id", async (b, s) => ({ service_id: await b.make("services", s) })),
  employee_service_prices: child("employees", "employee_id", async (b, s) => ({ service_id: await b.make("services", s), custom_price: "10.00" })),
  employee_commissions: child("employees", "employee_id", async (b, s) => ({ appointment_id: await b.make("appointments", s), amount: "10.00" })),
  service_variants: child("services", "service_id", () => ({ name: "IT C8" })),
  service_products: child("services", "service_id", async (b, s) => ({ product_id: await b.make("products", s) })),
  appointment_materials: child("appointments", "appointment_id", async (b, s) => ({ product_id: await b.make("products", s), quantity_used: "1.00" })),
  treatment_history: child("appointments", "appointment_id"),
  product_usage: child("products", "product_id", async (b, s) => ({ appointment_id: await b.make("appointments", s), quantity: "1.00" })),
  photo_albums: child("gallery_photos", "photo_id", async (b, s) => ({ album_id: await b.make("albums", s) })),
  loyalty_transactions: child("loyalty_points", "loyalty_id", () => ({ points_change: 1 })),
};

/** Tabele z RLS z parsera migracji (to samo źródło co strażnik RLS). */
const TABLES: string[] = loadRlsRequirements()
  .map((r) => r.table)
  .sort();

const q = (ident: string) => `"${ident}"`;

/**
 * INSERT wybranych kolumn z rekordu JSON (typy kolumn z tabeli, pozostałe kolumny z wartości domyślnych).
 * Parametr to tekst JSON rzutowany `$1::text::jsonb`: przy `$1::jsonb` sterownik serializuje napis
 * drugi raz i do bazy trafia skalar jsonb zamiast obiektu.
 * `returning: false` w próbach zapisu (c) i (f): odmowa ma pochodzić z WITH CHECK, a RETURNING
 * dokłada sprawdzenie nowego wiersza względem USING.
 */
function insertSql(t: string, row: Row, returning = true): string {
  const cols = Object.keys(row).map(q).join(", ");
  const tail = returning ? " RETURNING id::text AS id" : "";
  return `INSERT INTO ${q(t)} (${cols}) SELECT ${cols} FROM jsonb_populate_record(null::${q(t)}, $1::text::jsonb)${tail}`;
}

type Attempt = { rows: readonly unknown[] } | { code: unknown; rls: boolean };
async function attempt(c: Conn, query: string, params?: unknown[]): Promise<Attempt> {
  try {
    return { rows: await c.unsafe(query, params) };
  } catch (e) {
    const err = e as { code?: unknown; message?: unknown } | null;
    return { code: err?.code, rls: /row-level security/.test(String(err?.message ?? "")) };
  }
}
/** Wynik zapisu: "42501 RLS" tylko dla odmowy z polityki; inny błąd = jego kod; brak błędu = "zapis przeszedł". */
const writeOutcome = (r: Attempt): unknown => ("rows" in r ? "zapis przeszedł" : r.code === "42501" && r.rls ? "42501 RLS" : r.code);
const affected = (r: Attempt): unknown => ("rows" in r ? r.rows.length : r.code);

/** Krok pod rolą aplikacji z kontekstem `salon` ('' = bez kontekstu); efekty kroku zawsze wycofane. */
async function asApp<T>(c: Conn, salon: string, fn: () => Promise<T>): Promise<T> {
  await c.unsafe("SAVEPOINT app_step");
  try {
    await c.unsafe(`SET LOCAL ROLE ${APP_ROLE}`);
    await c.unsafe(`SELECT set_config('${SALON_CONTEXT_VAR}', $1, true)`, [salon]);
    return await fn();
  } finally {
    await c.unsafe("ROLLBACK TO SAVEPOINT app_step");
  }
}

/** Wiersz zbudowany przez fabrykę: id i wartość kolumny przypisania do salonu. */
type Built = { id: string; ref: string };

function createBuilder(c: Conn) {
  const owned = new Map<string, string[]>();
  const insert = async (t: string, row: Row): Promise<string> =>
    ((await c.unsafe(insertSql(t, row), [JSON.stringify(row)])) as Array<{ id: string }>)[0]!.id;
  const build = async (t: string, salon: string): Promise<Built> => {
    const f = FACTORIES[t];
    if (!f) throw new Error(`brak fabryki dla tabeli ${t}`);
    const row = await f.row(b, salon);
    const id = await insert(t, row);
    const key = `${t}|${salon}`;
    owned.set(key, [...(owned.get(key) ?? []), id]);
    return { id, ref: String(row[f.via.col]) };
  };
  const b: Builder = {
    make: async (t, salon) => (await build(t, salon)).id,
    user: async () => {
      const id = `${PREFIX}-${randomUUID()}`;
      return insert("user", { id, name: "IT T3 C8", email: `${id}@example.invalid` });
    },
    plan: () => insert("subscription_plans", { name: "IT T3 C8", slug: `${PREFIX}-${randomUUID()}`, price_monthly: "0.00" }),
  };
  /** Id wierszy tabeli `t` zbudowanych w salonie `salon` (także jako rodzice innych tabel). */
  const ownedBy = (t: string, salon: string): string[] => owned.get(`${t}|${salon}`) ?? [];
  return { b, build, ownedBy };
}

/** Inwariant oczekiwany dla każdej tabeli. */
const EXPECTED = {
  aLeak: [] as string[],
  aSeesOwn: true,
  bSeesB: 1 as unknown,
  cInsert: "42501 RLS" as unknown,
  dUpdate: "42501 RLS" as unknown,
  eUpdate: 0 as unknown,
  eUpdateKept: true,
  eDelete: 0 as unknown,
  eDeleteKept: true,
  fRead: 0 as unknown,
  fInsert: "42501 RLS" as unknown,
};
type Result = typeof EXPECTED;

describe("parametry testu izolacji (#193)", () => {
  it("lista tabel z parsera migracji niepusta i bez duplikatów", () => {
    expect(TABLES.length).toBeGreaterThan(0);
    expect(new Set(TABLES).size).toBe(TABLES.length);
  });

  it("kompletność: klucze FACTORIES == tabele z RLS z parsera (brak fabryki albo fabryka nadmiarowa → czerwony)", () => {
    expect(Object.keys(FACTORIES).sort()).toEqual(TABLES);
  });

  it("rodzic każdej fabryki „przez rodzica” ma własną fabrykę", () => {
    const missing = Object.entries(FACTORIES)
      .filter(([, f]) => f.via.kind === "parent" && !FACTORIES[f.via.parent])
      .map(([t]) => t);
    expect(missing).toEqual([]);
  });

  it("42501 bez komunikatu o polityce RLS (brak uprawnienia) nie liczy się jako odmowa RLS", () => {
    expect(writeOutcome({ code: "42501", rls: false })).toBe("42501");
    expect(writeOutcome({ code: "42501", rls: true })).toBe("42501 RLS");
    expect(writeOutcome({ rows: [] })).toBe("zapis przeszedł");
  });
});

suite("izolacja salonów na każdej tabeli z RLS pod rolą aplikacji (#193)", () => {
  const A = randomUUID();
  const B = randomUUID();
  let c: Reserved | null = null;
  let builder: ReturnType<typeof createBuilder>;

  beforeAll(async () => {
    c = (await h!.observer.reserve()) as unknown as Reserved;
    await c.unsafe("BEGIN");
    builder = createBuilder(c);
    await builder.build("salons", A);
    await builder.build("salons", B);
  });

  afterAll(async () => {
    if (c) {
      await c.unsafe("ROLLBACK");
      c.release();
      c = null;
    }
    await h?.end();
  });

  it("kompletność w bazie: tabele z relrowsecurity (katalog) == tabele z parsera", async () => {
    // Połączenie transakcji testu: DDL wykonany w tej transakcji jest widoczny bez czekania na blokadę.
    const rows = (await c!.unsafe(
      `SELECT c.relname::text AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity ORDER BY 1`,
    )) as Array<{ t: string }>;
    expect(rows.map((r) => r.t)).toEqual(TABLES);
  });

  it("polityka w pg_policies: USING po kolumnie przypisania z fabryki, WITH CHECK równy USING", async () => {
    // Połączenie transakcji testu, jak wyżej.
    const rows = (await c!.unsafe(
      `SELECT tablename::text AS t, qual, with_check AS "withCheck" FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, policyname`,
    )) as Array<{ t: string; qual: string | null; withCheck: string | null }>;
    const ws = (e: string | null): string => (e ?? "").replace(/\s+/g, " ").trim();
    const byTable = new Map<string, Array<{ qual: string; withCheck: string }>>();
    for (const r of rows) byTable.set(r.t, [...(byTable.get(r.t) ?? []), { qual: ws(r.qual), withCheck: ws(r.withCheck) }]);
    const problems = TABLES.flatMap((t): string[] => {
      const v = FACTORIES[t]?.via;
      const ps = byTable.get(t) ?? [];
      if (!v) return [`${t}: brak fabryki`];
      if (ps.length !== 1) return [`${t}: ${ps.length} polityk zamiast 1`];
      const { qual, withCheck } = ps[0]!;
      const out: string[] = [];
      const usingOk =
        v.kind === "self"
          ? qual.startsWith("(id = ")
          : v.kind === "direct"
            ? qual.startsWith("(salon_id = ")
            : qual.includes(`FROM ${v.parent} p WHERE ((p.id = ${t}.${v.col})`);
      if (!usingOk) out.push(`${t}: USING nie po kolumnie ${v.col} z fabryki`);
      if (withCheck !== qual) out.push(`${t}: WITH CHECK różny od USING`);
      return out;
    });
    expect(problems).toEqual([]);
  });

  it.each(TABLES)("%s: (a)–(f)", async (t) => {
    const conn = c!;
    const f = FACTORIES[t];
    if (!f) throw new Error(`${t}: brak fabryki`);
    const { b, build, ownedBy } = builder;
    const col = q(f.via.col);
    // Start każdej tabeli: rola migracji (SET LOCAL ROLE z poprzednich kroków cofnięte przez
    // ROLLBACK TO) i bez kontekstu salonu. Inny stan = czerwony wynik tej tabeli.
    const start = await conn.unsafe(
      `SELECT current_user = session_user AS "migrationRole", coalesce(current_setting('${SALON_CONTEXT_VAR}', true), '') AS "salonContext"`,
    );
    expect([...start]).toEqual([{ migrationRole: true, salonContext: "" }]);
    // Błąd fabryki albo kroku leci dalej (try/finally bez catch): ROLLBACK TO tylko sprząta dane
    // tabeli, nie połyka błędu, więc wynik tej tabeli jest czerwony.
    await conn.unsafe("SAVEPOINT table_case");
    try {
      // Dane rolą migracji: wiersz A, wiersz B, wiersz salonu B (z rodzicami w B) do prób zapisu.
      const rA: Built = f.via.kind === "self" ? { id: A, ref: A } : await build(t, A);
      const rB: Built = f.via.kind === "self" ? { id: B, ref: B } : await build(t, B);
      // salons: nowy salon (inny niż A) zamiast drugiego wiersza o id B.
      const foreign = await f.row(b, f.via.kind === "self" ? randomUUID() : B);
      const foreignJson = JSON.stringify(foreign);

      const migrationRoleValue = async (id: string): Promise<string | undefined> =>
        ((await conn.unsafe(`SELECT ${col}::text AS v FROM ${q(t)} WHERE id = $1::uuid`, [id])) as Array<{ v: string }>)[0]?.v;

      const visibleA = await asApp(conn, A, async () =>
        ((await conn.unsafe(`SELECT id::text AS id FROM ${q(t)}`)) as Array<{ id: string }>).map((r) => r.id),
      );
      const ownA = new Set(ownedBy(t, A));

      const result: Result = {
        aLeak: visibleA.filter((id) => !ownA.has(id)),
        aSeesOwn: visibleA.includes(rA.id),
        bSeesB: await asApp(conn, B, async () => {
          const r = await attempt(conn, `SELECT count(*)::int AS n FROM ${q(t)} WHERE id = $1::uuid`, [rB.id]);
          return "rows" in r ? (r.rows[0] as { n: number }).n : r.code;
        }),
        cInsert: await asApp(conn, A, async () => writeOutcome(await attempt(conn, insertSql(t, foreign, false), [foreignJson]))),
        dUpdate: await asApp(conn, A, async () =>
          writeOutcome(await attempt(conn, `UPDATE ${q(t)} SET ${col} = $1::uuid WHERE id = $2::uuid`, [rB.ref, rA.id])),
        ),
        eUpdate: 0,
        eUpdateKept: false,
        eDelete: 0,
        eDeleteKept: false,
        fRead: await asApp(conn, "", async () => {
          const r = await attempt(conn, `SELECT count(*)::int AS n FROM ${q(t)}`);
          return "rows" in r ? (r.rows[0] as { n: number }).n : r.code;
        }),
        fInsert: await asApp(conn, "", async () => writeOutcome(await attempt(conn, insertSql(t, foreign, false), [foreignJson]))),
      };

      // (e) zapis w kontekście A do wiersza B; w tym samym kroku rola migracji sprawdza wiersz B.
      [result.eUpdate, result.eUpdateKept] = await asApp(conn, A, async () => {
        const r = await attempt(conn, `UPDATE ${q(t)} SET ${col} = $1::uuid WHERE id = $2::uuid RETURNING 1`, [rA.ref, rB.id]);
        if (!("rows" in r)) return [r.code, false] as const;
        await conn.unsafe("SET LOCAL ROLE NONE");
        return [r.rows.length, (await migrationRoleValue(rB.id)) === rB.ref] as const;
      });
      [result.eDelete, result.eDeleteKept] = await asApp(conn, A, async () => {
        const r = await attempt(conn, `DELETE FROM ${q(t)} WHERE id = $1::uuid RETURNING 1`, [rB.id]);
        if (!("rows" in r)) return [affected(r), false] as const;
        await conn.unsafe("SET LOCAL ROLE NONE");
        return [r.rows.length, (await migrationRoleValue(rB.id)) === rB.ref] as const;
      });

      expect(result).toEqual(EXPECTED);
    } finally {
      await conn.unsafe("ROLLBACK TO SAVEPOINT table_case");
    }
  });

  it("po wycofaniu transakcji: wierszy testu nie ma, kontekst salonu nie został ustawiony trwale", async () => {
    await c!.unsafe("ROLLBACK");
    c!.release();
    c = null;
    const [left] = (await h!.observer.unsafe(
      `SELECT (SELECT count(*)::int FROM salons WHERE id IN ('${A}'::uuid, '${B}'::uuid))
            + (SELECT count(*)::int FROM "user" WHERE id LIKE '${PREFIX}-%')
            + (SELECT count(*)::int FROM subscription_plans WHERE slug LIKE '${PREFIX}-%') AS n`,
    )) as Array<{ n: number }>;
    expect(left!.n).toBe(0);
    const [v] = (await h!.observer.unsafe(`SELECT current_setting('${SALON_CONTEXT_VAR}', true) AS v`)) as Array<{ v: string | null }>;
    expect(v!.v === null || v!.v === "").toBe(true);
  });
});
