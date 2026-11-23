/**
 * Zgoda na zapis informacji o zdrowiu (`clients.allergies`) na PRAWDZIWYM
 * Postgresie: CHECK z migracji 0017 i ścieżka zapisu `PUT /api/clients/[id]`
 * (`forSalon(...).raw`, `coalesce`/`CASE` przy zgodzie, warunek zgody zapisanej
 * w samym UPDATE).
 *
 * Dowody:
 * a) CHECK `clients_allergies_require_consent`: INSERT i UPDATE z alergiami bez
 *    zgody → 23514; PUT z alergiami bez zgody → 400, wiersz bez zmian.
 * b) CHECK `clients_health_consent_pair`: czas bez konta i konto bez czasu → 23514.
 * c) Ponowne `healthDataConsent: true` (inne konto) zachowuje pierwotny czas
 *    i konto; cofnięcie zeruje alergie, czas i konto.
 * d) Wyścig: cofnięcie zgody i równoległy zapis alergii (bez zgody w żądaniu),
 *    cofnięcie pierwsze w kolejce do wiersza → zapis dostaje 400, w bazie nie
 *    zostaje ani zgoda, ani alergie. Bariera: obserwator trzyma blokadę wiersza
 *    (`SELECT … FOR UPDATE`) i czeka, aż oba UPDATE staną w kolejce
 *    (`pg_stat_activity` w bieżącej bazie).
 *
 * Mocki: kontekst salonu (`getSalonContext`), logger. `@/lib/db` → pula testu.
 * Dane: użytkownicy `it-t3-hconsent-…`; reszta kaskadą z salonu w `afterAll`.
 * Uruchomienie: `INTEGRATION_POSTGRES_URL=<lokalna baza testowa> pnpm test:pg -- __tests__/pg/client-health-data-consent.pg.test.ts`.
 * Wymaga bazy po `pnpm db:migrate` (RLS, rola aplikacji, migracja 0017).
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as route from "@/app/api/clients/[id]/route";
import { HEALTH_DATA_CONSENT_REQUIRED } from "@/lib/health-data-consent";
import { clients, salons, user } from "@/lib/schema";
import { createMockRequest, createRouteParams, parseResponse } from "../api/helpers";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const ctl = vi.hoisted(() => ({ salonId: "", userId: "" }));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!h) throw new Error("INTEGRATION_POSTGRES_URL not set");
    return h.db;
  },
}));
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: async () => ({ salonId: ctl.salonId, role: "owner", employeeId: null, userId: ctl.userId }),
  hasFeatureAccess: async () => false,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const RUN = randomUUID().slice(0, 8);
const OWNER = `it-t3-hconsent-o-${RUN}`;
const STAFF = `it-t3-hconsent-s-${RUN}`;
const USERS = [OWNER, STAFF];

const ALLERGIES_CHECK = "clients_allergies_require_consent";
const PAIR_CHECK = "clients_health_consent_pair";

const ids = { salon: "" };

const put = async (clientId: string, body: unknown) =>
  parseResponse<Record<string, unknown>>(
    await route.PUT(
      createMockRequest(`http://localhost/api/clients/${clientId}`, { method: "PUT", body }),
      createRouteParams(clientId)
    )
  );

type HealthRow = { allergies: string | null; consentAt: Date | null; consentBy: string | null; notes: string | null };

async function healthRow(clientId: string): Promise<HealthRow> {
  const [row] = await h!.db
    .select({
      allergies: clients.allergies,
      consentAt: clients.healthDataConsentAt,
      consentBy: clients.healthDataConsentBy,
      notes: clients.notes,
    })
    .from(clients)
    .where(eq(clients.id, clientId));
  if (!row) throw new Error("brak klienta testu");
  return row;
}

async function insertClient(values: Partial<typeof clients.$inferInsert> = {}): Promise<string> {
  const [row] = await h!.db
    .insert(clients)
    .values({ salonId: ids.salon, firstName: "Ala", lastName: `Z-${RUN}`, ...values })
    .returning({ id: clients.id });
  return row!.id;
}

/** Błąd z bazy po odwinięciu opakowania Drizzle. */
async function dbError(p: Promise<unknown>): Promise<{ code?: string; constraint_name?: string }> {
  try {
    await p;
  } catch (e) {
    let cur = e as { code?: string; cause?: unknown };
    while (!cur.code && cur.cause) cur = cur.cause as typeof cur;
    return cur as { code?: string; constraint_name?: string };
  }
  throw new Error("oczekiwano odrzucenia przez bazę");
}

/** Czeka, aż `count` UPDATE-ów `clients` w bieżącej bazie czeka na blokadę. */
async function waitForBlockedUpdates(count: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await h!.observer<{ n: number }[]>`
      select count(*)::int as n
      from pg_stat_activity
      where datname = current_database()
        and wait_event_type = 'Lock'
        and query ilike 'update "clients"%'
    `;
    if ((row?.n ?? 0) >= count) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`bariera: mniej niż ${count} UPDATE w oczekiwaniu na blokadę po ${timeoutMs} ms`);
}

const suite = h ? describe : describe.skip;

suite("zgoda na zapis informacji o zdrowiu (clients), prawdziwy Postgres", () => {
  beforeAll(async () => {
    const db = h!.db;
    await db.insert(user).values(
      USERS.map((id) => ({ id, name: `IT T3 hconsent ${id}`, email: `${id}@example.invalid`, emailVerified: true }))
    );
    const [s] = await db.insert(salons).values({ name: `IT T3 hconsent ${RUN}`, ownerId: OWNER }).returning({ id: salons.id });
    ids.salon = s!.id;
  });

  afterAll(async () => {
    if (!h) return;
    try {
      if (ids.salon) await h.db.delete(salons).where(eq(salons.id, ids.salon));
      await h.db.delete(user).where(inArray(user.id, USERS));
    } finally {
      await h.end();
    }
  });

  beforeEach(() => {
    ctl.salonId = ids.salon;
    ctl.userId = OWNER;
  });

  describe("a) CHECK: alergie tylko przy zgodzie", () => {
    it("INSERT z alergiami bez zgody → 23514", async () => {
      const err = await dbError(
        h!.db.insert(clients).values({ salonId: ids.salon, firstName: "Ola", lastName: "X", allergies: "Lateks" })
      );
      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe(ALLERGIES_CHECK);
    });

    it("UPDATE wpisujący alergie u klienta bez zgody → 23514", async () => {
      const clientId = await insertClient();
      const err = await dbError(h!.db.update(clients).set({ allergies: "Lateks" }).where(eq(clients.id, clientId)));
      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe(ALLERGIES_CHECK);
      expect((await healthRow(clientId)).allergies).toBeNull();
    });

    it("UPDATE zerujący zgodę bez zerowania alergii → 23514", async () => {
      const clientId = await insertClient({ allergies: "Lateks", healthDataConsentAt: new Date(), healthDataConsentBy: OWNER });
      const err = await dbError(
        h!.db
          .update(clients)
          .set({ healthDataConsentAt: null, healthDataConsentBy: null })
          .where(eq(clients.id, clientId))
      );
      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe(ALLERGIES_CHECK);
    });

    it("PUT z alergiami bez zgody (ani w żądaniu, ani zapisanej) → 400, wiersz bez zmian", async () => {
      const clientId = await insertClient({ notes: "przed" });
      const res = await put(clientId, { allergies: "Lateks", notes: "po" });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.code).toBe(HEALTH_DATA_CONSENT_REQUIRED);
      expect(await healthRow(clientId)).toEqual({ allergies: null, consentAt: null, consentBy: null, notes: "przed" });
    });
  });

  describe("b) CHECK: czas i konto zgody wyłącznie razem", () => {
    it("czas bez konta → 23514", async () => {
      const err = await dbError(
        h!.db.insert(clients).values({ salonId: ids.salon, firstName: "Ola", lastName: "Y", healthDataConsentAt: new Date() })
      );
      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe(PAIR_CHECK);
    });

    it("konto bez czasu → 23514", async () => {
      const err = await dbError(
        h!.db.insert(clients).values({ salonId: ids.salon, firstName: "Ola", lastName: "Y", healthDataConsentBy: OWNER })
      );
      expect(err.code).toBe("23514");
      expect(err.constraint_name).toBe(PAIR_CHECK);
    });

    it("kontrola: para czas + konto z alergiami wchodzi", async () => {
      const clientId = await insertClient({ allergies: "PPD", healthDataConsentAt: new Date(), healthDataConsentBy: OWNER });
      expect((await healthRow(clientId)).allergies).toBe("PPD");
    });
  });

  describe("c) ścieżka zapisu trasy: pierwsza zgoda zostaje, cofnięcie zeruje", () => {
    it("ponowne true innym kontem zachowuje pierwotny czas i konto; alergie się zmieniają", async () => {
      const clientId = await insertClient();

      const first = await put(clientId, { healthDataConsent: true, allergies: "Lateks" });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const afterFirst = await healthRow(clientId);
      expect(afterFirst.allergies).toBe("Lateks");
      expect(afterFirst.consentAt).toBeInstanceOf(Date);
      expect(afterFirst.consentBy).toBe(OWNER);

      ctl.userId = STAFF;
      const second = await put(clientId, { healthDataConsent: true, allergies: "Lateks, Nikiel" });
      expect(second.status, JSON.stringify(second.body)).toBe(200);
      const afterSecond = await healthRow(clientId);
      expect(afterSecond.allergies).toBe("Lateks, Nikiel");
      expect(afterSecond.consentAt!.getTime()).toBe(afterFirst.consentAt!.getTime());
      expect(afterSecond.consentBy).toBe(OWNER);
    });

    it("alergie bez flagi przy zapisanej zgodzie → 200, zgoda bez zmian", async () => {
      const clientId = await insertClient();
      await put(clientId, { healthDataConsent: true });
      const before = await healthRow(clientId);

      const res = await put(clientId, { allergies: "Henna" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const after = await healthRow(clientId);
      expect(after.allergies).toBe("Henna");
      expect(after.consentAt!.getTime()).toBe(before.consentAt!.getTime());
      expect(after.consentBy).toBe(before.consentBy);
    });

    it("cofnięcie zgody zeruje alergie, czas i konto", async () => {
      const clientId = await insertClient();
      await put(clientId, { healthDataConsent: true, allergies: "Lateks" });

      const res = await put(clientId, { healthDataConsent: false, notes: "cofnięta" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await healthRow(clientId)).toEqual({ allergies: null, consentAt: null, consentBy: null, notes: "cofnięta" });
    });
  });

  it("d) wyścig: cofnięcie zgody przed równoległym zapisem alergii → zapis 400, w bazie ani zgody, ani alergii", async () => {
    const clientId = await insertClient();
    const granted = await put(clientId, { healthDataConsent: true, allergies: "Lateks" });
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);

    let revoke: ReturnType<typeof put> | null = null;
    let write: ReturnType<typeof put> | null = null;
    // Obserwator trzyma blokadę wiersza. Cofnięcie staje w kolejce pierwsze,
    // zapis alergii drugi (kolejka blokady wiersza jest FIFO). Po commicie
    // obserwatora cofnięcie przechodzi, a zapis alergii ponownie sprawdza swój
    // warunek „zgoda zapisana” na nowej wersji wiersza i nie trafia w nic.
    await h!.observer.begin(async (tx) => {
      await tx.unsafe("select id from clients where id = $1 for update", [clientId]);
      revoke = put(clientId, { healthDataConsent: false });
      await waitForBlockedUpdates(1);
      write = put(clientId, { allergies: "Lateks, Nikiel" });
      await waitForBlockedUpdates(2);
    });

    const [revoked, written] = await Promise.all([revoke!, write!]);
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
    expect(written.status, JSON.stringify(written.body)).toBe(400);
    expect(written.body.code).toBe(HEALTH_DATA_CONSENT_REQUIRED);
    const row = await healthRow(clientId);
    expect(row.allergies).toBeNull();
    expect(row.consentAt).toBeNull();
    expect(row.consentBy).toBeNull();
  });
});
