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
import { loadRlsRequirements, runRlsGuard, type RlsGuardResult } from "../../scripts/db-rls-guard";

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

suite("strażnik RLS na bazie po migracjach (#190)", () => {
  afterAll(async () => {
    await h?.end();
  });

  it("baza po db:migrate: wszystkie tabele z 0005 z RLS i polityką → OK (D3: tabel z RLS ≥ 39)", async () => {
    const r = await runRlsGuard(h!.observer, REQUIRED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.checked).toBe(39);
    expect(r.rlsTables).toBeGreaterThanOrEqual(39);
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
