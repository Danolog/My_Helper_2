import path from "path";
import { defineConfig } from "vitest/config";

/**
 * Testy na PRAWDZIWYM Postgresie (`__tests__/pg/**`), np. blokady subskrypcji
 * (T3). Adres wyłącznie z `INTEGRATION_POSTGRES_URL` + ochrona hosta z seeda
 * (`__tests__/pg/pg-harness.ts`). Bez adresu: pominięte lokalnie, błąd w CI.
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://<user>:<hasło>@localhost:5432/pos_dev pnpm test:pg
 *
 * Wymaga bazy z zastosowanymi migracjami; sam test nie uruchamia `db:*`
 * ani seeda — tworzy własne wiersze z unikalnymi id i je sprząta.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["__tests__/pg/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
