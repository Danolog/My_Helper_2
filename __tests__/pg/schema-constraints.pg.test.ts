/**
 * #180: baza testów pg (w CI: po `pnpm db:migrate` i `pnpm db:push` w
 * `quality-gate.yml`) MA ograniczenia z migracji 0009. Gdy ktoś zbuduje bazę
 * samym pushem, ten test pada z komunikatem strażnika zamiast przepuścić
 * wyścigi rezerwacji. Ta sama logika co `scripts/db-schema-guard.ts`.
 * Tylko odczyt (`pg_constraint`).
 */
import { afterAll, describe, expect, it } from "vitest";
import { createIntegrationDb } from "./pg-harness";
import { REQUIRED_CONSTRAINTS, runSchemaGuard } from "../../scripts/db-schema-guard";

const h = await createIntegrationDb();
const suite = h ? describe : describe.skip;

suite("strażnik schematu (#180), prawdziwy Postgres", () => {
  afterAll(async () => {
    await h?.end();
  });

  it(`ograniczenia z migracji 0009 istnieją: ${REQUIRED_CONSTRAINTS.join(", ")}`, async () => {
    const result = await runSchemaGuard(h!.observer);
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
  });
});
