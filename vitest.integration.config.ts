import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Osobna konfiguracja dla testów integracyjnych uderzających w REALNĄ, lokalną
 * bazę (Docker, localhost:5440). NIE mockują db/auth/headers (poza shim-em
 * środowiska Next na `next/headers`).
 *
 * Uruchomienie:
 *   docker compose -f docker-compose.yml -f docker-compose.test.yml up -d
 *   npx drizzle-kit migrate   (z DSN localhost)
 *   npx vitest run --config vitest.integration.config.ts
 *
 * Setup `setup-real-db.ts` ładuje env z pliku poza repo i GWARANTUJE
 * host=localhost zanim cokolwiek dotknie bazy.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Setup musi załadować env i przejść guard PRZED importem modułów dotykających DB.
    setupFiles: ["./__tests__/integration/setup-real-db.ts"],
    include: ["__tests__/integration/**/*.test.ts"],
    // Realna baza + sekwencyjny seed/cleanup — bez równoległości plików.
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
