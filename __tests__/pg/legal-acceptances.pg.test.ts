/**
 * Akceptacja regulaminu i DPA przy zakładaniu salonu (`legal_acceptances`, migracja 0015)
 * na PRAWDZIWYM Postgresie:
 * - POST /api/register-subscription przy opublikowanych dokumentach i obu bieżących
 *   wersjach zapisuje dwa wpisy (dokument, wersja, czas, konto, salon) w TEJ SAMEJ
 *   transakcji co salon i trial (ten sam `xmin`, ten sam `accepted_at`);
 * - bez akceptacji → 400 i brak salonu konta;
 * - uprawnienia roli aplikacji: tylko SELECT i INSERT; UPDATE/DELETE/TRUNCATE pod
 *   `SET LOCAL ROLE myhelper_app` → 42501 z braku uprawnienia, wpis bez zmian;
 * - CHECK-i (23514) także dla roli migracji;
 * - wpisy przeżywają usunięcie salonu (bez FK — dowód akceptacji zostaje).
 *
 * Atrapami są sesja (auth-middleware), logger, lista PLANS_ON_SALE (slug planu testowego)
 * i stan publikacji dokumentów (flaga + wersje); trasa i baza są prawdziwe.
 * Dane: konta `it-t3-la-…`, plan `it-t3-la-…`; salony i wpisy sprzątane w `afterAll`.
 *
 *   pnpm test:pg (adres bazy jak w vitest.pg.config.ts)
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as registerSubscription } from "@/app/api/register-subscription/route";
import { legalAcceptances, salonSubscriptions, salons, subscriptionPlans, user } from "@/lib/schema";
import { APP_ROLE, SALON_CONTEXT_VAR } from "../../scripts/db-rls-guard";

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

const { testPlanSlug } = vi.hoisted(() => ({ testPlanSlug: `it-t3-la-${crypto.randomUUID().slice(0, 8)}` }));
vi.mock("@/lib/plan-catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plan-catalog")>()),
  PLANS_ON_SALE: [testPlanSlug],
}));

const { sessionUser } = vi.hoisted(() => ({
  sessionUser: { current: { id: "", name: "IT", email: "it@example.invalid" } },
}));
vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: async () => ({ user: sessionUser.current }),
  isAuthError: () => false,
}));

// Dokumenty opublikowane z ustalonymi wersjami (w module flaga jest dziś wyłączona).
const { TERMS_V, DPA_V } = vi.hoisted(() => ({ TERMS_V: "2026-12-01", DPA_V: "2026-12-02" }));
vi.mock("@/lib/legal/documents", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/legal/documents")>();
  return {
    ...real,
    LEGAL_DOCS_PUBLISHED: true,
    LEGAL_DOCUMENTS: {
      ...real.LEGAL_DOCUMENTS,
      terms: { ...real.LEGAL_DOCUMENTS.terms, version: TERMS_V },
      dpa: { ...real.LEGAL_DOCUMENTS.dpa, version: DPA_V },
    },
  };
});

const suite = h ? describe : describe.skip;

type Conn = { unsafe: (query: string, params?: unknown[]) => PromiseLike<readonly unknown[]> };
type Reserved = Conn & { release: () => void };
type PgError = { code?: unknown; message?: unknown; constraint_name?: unknown };

const RUN = randomUUID().slice(0, 8);
const PREFIX = `it-t3-la-${RUN}`;
const TABLE = "legal_acceptances";
const createdUsers: string[] = [];
const createdSalons: string[] = [];
let planId = "";

async function newAccount(label: string) {
  const id = `${PREFIX}-${label}`;
  await h!.db.insert(user).values({ id, name: "IT T3 la", email: `${id}@example.invalid` });
  createdUsers.push(id);
  return { id, name: "IT T3 la", email: `${id}@example.invalid` };
}

async function register(account: { id: string; name: string; email: string }, body: Record<string, unknown>) {
  sessionUser.current = account;
  const res = await registerSubscription(
    new Request("http://localhost/api/register-subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planSlug: testPlanSlug, ...body }),
    }) as never
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function salonOf(ownerId: string): Promise<string | null> {
  const [s] = await h!.db.select({ id: salons.id }).from(salons).where(eq(salons.ownerId, ownerId));
  if (s) createdSalons.push(s.id);
  return s?.id ?? null;
}

/** Transakcja na zarezerwowanym połączeniu (rola migracji), zawsze wycofywana. */
async function inRolledBackTx(fn: (c: Conn) => Promise<void>): Promise<void> {
  const c = (await h!.observer.reserve()) as unknown as Reserved;
  try {
    await c.unsafe("BEGIN");
    await fn(c);
  } finally {
    await c.unsafe("ROLLBACK");
    c.release();
  }
}

/** Błąd polecenia w SAVEPOINT (transakcja zostaje używalna) albo null, gdy przeszło. */
async function failure(c: Conn, query: string, params?: unknown[]): Promise<PgError | null> {
  await c.unsafe("SAVEPOINT step");
  try {
    await c.unsafe(query, params);
    return null;
  } catch (e) {
    return e as PgError;
  } finally {
    await c.unsafe("ROLLBACK TO SAVEPOINT step");
  }
}

/** Polecenie pod rolą aplikacji z kontekstem salonu; efekty (także SET LOCAL) cofane. */
async function failureAsApp(c: Conn, salon: string, query: string, params?: unknown[]): Promise<PgError | null> {
  await c.unsafe("SAVEPOINT app");
  try {
    await c.unsafe(`SET LOCAL ROLE ${APP_ROLE}`);
    await c.unsafe(`SELECT set_config('${SALON_CONTEXT_VAR}', $1, true)`, [salon]);
    await c.unsafe(query, params);
    return null;
  } catch (e) {
    return e as PgError;
  } finally {
    await c.unsafe("ROLLBACK TO SAVEPOINT app");
  }
}

const INSERT_ROW =
  `INSERT INTO ${TABLE} (salon_id, user_id, document, version, source) VALUES ($1::uuid, $2, $3, $4, $5)`;

suite("legal_acceptances — prawdziwy Postgres (migracja 0015)", () => {
  beforeAll(async () => {
    const [plan] = await h!.db
      .insert(subscriptionPlans)
      .values({ name: "IT T3 la", slug: testPlanSlug, priceMonthly: "49.00" })
      .returning({ id: subscriptionPlans.id });
    planId = plan!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      // Wpisy bez FK nie znikają z salonem: usuwane wprost rolą migracji (omija REVOKE roli aplikacji).
      if (createdSalons.length > 0) {
        await h.db.delete(legalAcceptances).where(inArray(legalAcceptances.salonId, createdSalons));
        await h.db.delete(salons).where(inArray(salons.id, createdSalons));
      }
      if (createdUsers.length > 0) {
        await h.db.delete(legalAcceptances).where(inArray(legalAcceptances.userId, createdUsers));
      }
      if (planId) await h.db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
      if (createdUsers.length > 0) await h.db.delete(user).where(inArray(user.id, createdUsers));
    } finally {
      await h.end();
    }
  });

  it("(b) bez akceptacji → 400 LEGAL_ACCEPTANCE_REQUIRED, konto bez salonu i bez wpisów", async () => {
    const account = await newAccount("none");

    const { status, body } = await register(account, { acceptanceSource: "registration" });

    expect(status).toBe(400);
    expect(body.code).toBe("LEGAL_ACCEPTANCE_REQUIRED");
    expect(await salonOf(account.id)).toBeNull();
    const rows = await h!.db.select().from(legalAcceptances).where(eq(legalAcceptances.userId, account.id));
    expect(rows).toEqual([]);
  });

  it("(b) tylko regulamin (bez DPA) → 400, konto bez salonu", async () => {
    const account = await newAccount("terms-only");

    const { status } = await register(account, { termsVersion: TERMS_V, acceptanceSource: "registration" });

    expect(status).toBe(400);
    expect(await salonOf(account.id)).toBeNull();
  });

  it("(c) obie bieżące wersje → salon, trial i dwa wpisy w tej samej transakcji", async () => {
    const account = await newAccount("ok");

    const { status } = await register(account, {
      termsVersion: TERMS_V,
      dpaVersion: DPA_V,
      acceptanceSource: "registration",
    });

    expect(status).toBe(200);
    const salonId = await salonOf(account.id);
    expect(salonId).not.toBeNull();

    const rows = await h!.db.select().from(legalAcceptances).where(eq(legalAcceptances.salonId, salonId!));
    expect(rows.map((r) => ({ document: r.document, version: r.version, userId: r.userId, source: r.source })).sort((a, b) =>
      a.document.localeCompare(b.document)
    )).toEqual([
      { document: "dpa", version: DPA_V, userId: account.id, source: "registration" },
      { document: "terms", version: TERMS_V, userId: account.id, source: "registration" },
    ]);
    expect(rows[0]!.acceptedAt).toBeInstanceOf(Date);
    expect(rows[0]!.acceptedAt.getTime()).toBe(rows[1]!.acceptedAt.getTime());

    // Ten sam identyfikator transakcji zapisu (xmin) dla salonu, triala i obu wpisów.
    const xmins = (await h!.observer.unsafe(
      `SELECT 'salon' AS t, xmin::text AS x FROM salons WHERE id = $1::uuid
       UNION ALL SELECT 'sub', xmin::text FROM salon_subscriptions WHERE salon_id = $1::uuid
       UNION ALL SELECT 'acc', xmin::text FROM ${TABLE} WHERE salon_id = $1::uuid`,
      [salonId]
    )) as Array<{ t: string; x: string }>;
    expect(xmins.map((r) => r.t).sort()).toEqual(["acc", "acc", "salon", "sub"]);
    expect(new Set(xmins.map((r) => r.x)).size).toBe(1);

    const [sub] = await h!.db.select().from(salonSubscriptions).where(eq(salonSubscriptions.salonId, salonId!));
    expect(sub!.status).toBe("trialing");
  });

  it("wpisy przeżywają usunięcie salonu (bez FK — dowód akceptacji zostaje)", async () => {
    const account = await newAccount("survive");
    const { status } = await register(account, {
      termsVersion: TERMS_V,
      dpaVersion: DPA_V,
      acceptanceSource: "create_salon",
    });
    expect(status).toBe(200);
    const salonId = (await salonOf(account.id))!;

    await h!.db.delete(salons).where(eq(salons.id, salonId));

    const rows = await h!.db.select().from(legalAcceptances).where(eq(legalAcceptances.salonId, salonId));
    expect(rows).toHaveLength(2);
  });

  it("uprawnienia: myhelper_app ma SELECT i INSERT, nie ma UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER; PUBLIC bez SELECT", async () => {
    const privs = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
    const rows = (await h!.observer.unsafe(
      `SELECT p, has_table_privilege('${APP_ROLE}', 'public.${TABLE}', p) AS app FROM unnest($1::text[]) AS p`,
      [privs]
    )) as Array<{ p: string; app: boolean }>;
    expect(Object.fromEntries(rows.map((r) => [r.p, r.app]))).toEqual({
      SELECT: true,
      INSERT: true,
      UPDATE: false,
      DELETE: false,
      TRUNCATE: false,
      REFERENCES: false,
      TRIGGER: false,
    });
    const [pub] = (await h!.observer.unsafe(
      `SELECT has_table_privilege('public', 'public.${TABLE}', 'SELECT') AS v`
    )) as Array<{ v: boolean }>;
    expect(pub!.v).toBe(false);
  });

  it("tylko do dopisywania: INSERT własnego salonu przechodzi; UPDATE/DELETE/TRUNCATE → 42501 z braku uprawnienia, wpis bez zmian", async () => {
    const salon = randomUUID();
    await inRolledBackTx(async (c) => {
      expect(await failureAsApp(c, salon, INSERT_ROW, [salon, `${PREFIX}-app`, "terms", TERMS_V, "create_salon"])).toBeNull();

      const [row] = (await c.unsafe(`${INSERT_ROW} RETURNING id::text AS id`, [
        salon,
        `${PREFIX}-app`,
        "dpa",
        DPA_V,
        "registration",
      ])) as Array<{ id: string }>;
      const id = row!.id;
      const [before] = (await c.unsafe(`SELECT to_jsonb(a) AS r FROM ${TABLE} a WHERE id = $1::uuid`, [id])) as Array<{ r: unknown }>;
      for (const q of [
        `UPDATE ${TABLE} SET version = '2000-01-01' WHERE id = '${id}'::uuid`,
        `DELETE FROM ${TABLE} WHERE id = '${id}'::uuid`,
        `TRUNCATE ${TABLE}`,
      ]) {
        const err = await failureAsApp(c, salon, q);
        expect(err?.code, q).toBe("42501");
        expect(String(err?.message), q).toMatch(/permission denied/);
        expect(String(err?.message), q).not.toMatch(/row-level security/);
      }
      const [after] = (await c.unsafe(`SELECT to_jsonb(a) AS r FROM ${TABLE} a WHERE id = $1::uuid`, [id])) as Array<{ r: unknown }>;
      expect(after!.r).toEqual(before!.r);
    });
  });

  it.each([
    ["document spoza listy", ["privacy", TERMS_V, "registration"], "legal_acceptances_document_valid"],
    ["source spoza listy", ["terms", TERMS_V, "web"], "legal_acceptances_source_valid"],
    ["pusta wersja", ["terms", "", "registration"], "legal_acceptances_version_nonempty"],
    ["wersja > 64 znaki", ["terms", "x".repeat(65), "registration"], "legal_acceptances_version_nonempty"],
  ])("CHECK: %s → 23514 także dla roli migracji", async (_n, [document, version, source], constraint) => {
    await inRolledBackTx(async (c) => {
      const err = await failure(c, INSERT_ROW, [randomUUID(), `${PREFIX}-chk`, document, version, source]);
      expect(err?.code).toBe("23514");
      expect(err?.constraint_name).toBe(constraint);
    });
  });

  it("CHECK: puste konto → 23514", async () => {
    await inRolledBackTx(async (c) => {
      const err = await failure(c, INSERT_ROW, [randomUUID(), "", "terms", TERMS_V, "registration"]);
      expect(err?.code).toBe("23514");
      expect(err?.constraint_name).toBe("legal_acceptances_user_nonempty");
    });
  });
});
