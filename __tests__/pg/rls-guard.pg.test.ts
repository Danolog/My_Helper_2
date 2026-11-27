/**
 * #190: strażnik RLS (`scripts/db-rls-guard.ts`) na PRAWDZIWYM Postgresie po `db:migrate`.
 *
 * - baza z migracjami: wszystkie tabele z 0005 mają RLS i politykę z pliku → OK;
 * - w transakcji (wycofywanej; DDL w Postgresie jest transakcyjne) wyłączenie RLS na
 *   jednej tabeli albo usunięcie jednej polityki → strażnik pada i nazywa tabelę;
 * - po wycofaniu stan wraca (strażnik znów OK) — test niczego trwale nie zmienia.
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm test:pg -- __tests__/pg/rls-guard.pg.test.ts
 *
 * Wymaga bazy po `pnpm db:migrate` (bez `db:push` — ten zdejmuje RLS, #190).
 * Test nie uruchamia `db:*` ani seeda.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  loadPolicySnapshot,
  loadRlsRequirements,
  runPolicyGuard,
  runRlsGuard,
  type PolicyGuardResult,
  type RlsGuardResult,
} from "../../scripts/db-rls-guard";

const h = await vi.hoisted(async () => (await import("./pg-harness")).createIntegrationDb());
const suite = h ? describe : describe.skip;
const REQUIRED = loadRlsRequirements();

class Rollback extends Error {}

/** Zmiana DDL w transakcji, strażnik w tej samej transakcji, potem wycofanie. */
async function inRolledBackTx(ddl: string): Promise<RlsGuardResult> {
  let result: RlsGuardResult | undefined;
  await h!.observer
    .begin(async (tx) => {
      await tx.unsafe(ddl);
      result = await runRlsGuard(tx, REQUIRED);
      throw new Rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });
  if (!result) throw new Error("strażnik nie zwrócił wyniku");
  return result;
}

// Jedno zamknięcie puli po wszystkich blokach (#193: drugi blok korzysta z tej samej puli).
afterAll(async () => {
  await h?.end();
});

suite("strażnik RLS na bazie po migracjach (#190)", () => {
  it("baza po db:migrate: wszystkie tabele z 0005, 0014, 0015 i 0018 z RLS i polityką → OK (D3: tabel z RLS ≥ 42)", async () => {
    const r = await runRlsGuard(h!.observer, REQUIRED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.checked).toBe(42);
    expect(r.rlsTables).toBeGreaterThanOrEqual(42);
  });

  it("RLS wyłączone na clients (w transakcji) → strażnik pada i nazywa tabelę", async () => {
    const r = await inRolledBackTx("ALTER TABLE clients DISABLE ROW LEVEL SECURITY");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain("clients (RLS wyłączone)");
  });

  it("brak polityki tenant_self na salons (w transakcji) → strażnik pada i nazywa tabelę", async () => {
    const r = await inRolledBackTx("DROP POLICY tenant_self ON salons");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["salons (brak polityki tenant_self)"]);
  });

  it("brak polityki tenant_isolation na time_blocks (tabela pośrednia) → strażnik pada", async () => {
    const r = await inRolledBackTx("DROP POLICY tenant_isolation ON time_blocks");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["time_blocks (brak polityki tenant_isolation)"]);
  });

  it("po wycofaniu zmian strażnik znów OK (test nie zostawia śladu)", async () => {
    expect((await runRlsGuard(h!.observer, REQUIRED)).ok).toBe(true);
  });
});

/** Zmiana w transakcji, strażnik ról i polityk w tej samej transakcji, potem wycofanie. */
async function policyGuardInRolledBackTx(ddl: string, snapshot = SNAPSHOT): Promise<PolicyGuardResult> {
  let result: PolicyGuardResult | undefined;
  await h!.observer
    .begin(async (tx) => {
      // Po jednym poleceniu (protokół rozszerzony nie przyjmuje kilku naraz; wzór z views-privileges).
      for (const stmt of ddl.split(";").map((s) => s.trim()).filter(Boolean)) await tx.unsafe(stmt);
      result = await runPolicyGuard(tx, snapshot);
      throw new Rollback();
    })
    .catch((e: unknown) => {
      if (!(e instanceof Rollback)) throw e;
    });
  if (!result) throw new Error("strażnik nie zwrócił wyniku");
  return result;
}

const SNAPSHOT = loadPolicySnapshot();
// Postać polityk po migracji 0010 (nullif), żeby sondy zmieniały tylko badany element.
const CTX = "nullif(current_setting('app.current_salon_id', true), '')::uuid";
const problems = (r: PolicyGuardResult) => (r.ok ? [] : r.problems);

suite("strażnik ról i treści polityk na bazie po migracjach (#193)", () => {
  it("baza po db:migrate: role bez atrybutów, polityki == migawka, semantyka OK (sonda kontrolna)", async () => {
    const r = await runPolicyGuard(h!.observer, SNAPSHOT);
    expect(problems(r)).toEqual([]);
    expect(r.ok && r.policies).toBe(SNAPSHOT.length);
  });

  it.each([
    ["ALTER ROLE myhelper_app BYPASSRLS", "ALTER ROLE myhelper_app BYPASSRLS", ["rola myhelper_app ma BYPASSRLS"]],
    ["ALTER ROLE myhelper_app SUPERUSER", "ALTER ROLE myhelper_app SUPERUSER", ["rola myhelper_app ma SUPERUSER"]],
  ])("%s (w transakcji) → odmowa", async (_n, ddl, expected) => {
    expect(problems(await policyGuardInRolledBackTx(ddl))).toEqual(expected);
  });

  it("USING (true) pod tą samą nazwą na clients → migawka i semantyka czerwone", async () => {
    const r = await policyGuardInRolledBackTx(
      `DROP POLICY tenant_isolation ON clients; CREATE POLICY tenant_isolation ON clients USING (true) WITH CHECK (salon_id = ${CTX})`,
    );
    expect(problems(r)).toEqual([
      "clients.tenant_isolation: treść polityki różni się od migawki",
      "clients.tenant_isolation: USING jest stałą true",
    ]);
  });

  it("WITH CHECK (true) pod tą samą nazwą na clients → migawka i semantyka czerwone", async () => {
    const r = await policyGuardInRolledBackTx(
      `DROP POLICY tenant_isolation ON clients; CREATE POLICY tenant_isolation ON clients USING (salon_id = ${CTX}) WITH CHECK (true)`,
    );
    expect(problems(r)).toEqual([
      "clients.tenant_isolation: treść polityki różni się od migawki",
      "clients.tenant_isolation: WITH CHECK jest stałą true",
    ]);
  });

  it("odwołanie do innej zmiennej pod nazwą tenant_isolation → migawka i semantyka czerwone", async () => {
    const other = "current_setting('app.current_user_id', true)::uuid";
    const r = await policyGuardInRolledBackTx(
      `DROP POLICY tenant_isolation ON clients; CREATE POLICY tenant_isolation ON clients USING (salon_id = ${other}) WITH CHECK (salon_id = ${other})`,
    );
    expect(problems(r)).toEqual([
      "clients.tenant_isolation: treść polityki różni się od migawki",
      "clients.tenant_isolation: USING bez odwołania do app.current_salon_id",
      "clients.tenant_isolation: WITH CHECK bez odwołania do app.current_salon_id",
    ]);
  });

  it("polityka bez nullif pod tą samą nazwą na clients (postać sprzed 0010) → migawka i semantyka czerwone", async () => {
    const bare = "current_setting('app.current_salon_id', true)::uuid";
    const r = await policyGuardInRolledBackTx(
      `DROP POLICY tenant_isolation ON clients; CREATE POLICY tenant_isolation ON clients USING (salon_id = ${bare}) WITH CHECK (salon_id = ${bare})`,
    );
    expect(problems(r)).toEqual([
      "clients.tenant_isolation: treść polityki różni się od migawki",
      "clients.tenant_isolation: USING czyta app.current_salon_id bez nullif",
      "clients.tenant_isolation: WITH CHECK czyta app.current_salon_id bez nullif",
    ]);
  });

  it("migawka niezaktualizowana po zmianie polityki (pozycja clients z innym skrótem) → czerwony", async () => {
    const stale = SNAPSHOT.map((e) => (e.table === "clients" ? { ...e, sha256: "0".repeat(64) } : e));
    expect(problems(await policyGuardInRolledBackTx("", stale))).toEqual(["clients.tenant_isolation: treść polityki różni się od migawki"]);
  });

  it("po wycofaniu zmian strażnik ról i polityk znów OK", async () => {
    expect(problems(await runPolicyGuard(h!.observer, SNAPSHOT))).toEqual([]);
  });
});
