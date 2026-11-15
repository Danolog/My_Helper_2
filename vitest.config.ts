import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./__tests__/setup.ts'],
    include: ['__tests__/**/*.test.{ts,tsx}'],
    // Testy integracyjne maja wlasna konfiguracje (vitest.integration.config.ts)
    // i wymagaja REALNEJ lokalnej bazy + env spoza repo (setup-real-db.ts).
    // Domyslny `pnpm test` (CI, happy-dom, mocki) ich nie laduje.
    // `__tests__/pg/**` — prawdziwy Postgres z INTEGRATION_POSTGRES_URL (vitest.pg.config.ts).
    exclude: ['node_modules/**', 'dist/**', '.next/**', '__tests__/integration/**', '__tests__/pg/**'],
    // Limity czasu: w CI (GitHub Actions ustawia CI=true) dokladnie domyslne
    // Vitest (5000/10000 ms) — bramka bez zmian. Lokalnie dluzsze, bo pod
    // obciazeniem maszyny (load avg 15-70 na 8 rdzeniach) workery sa glodzone
    // CPU i limity zegarowe daja losowe faile (pomiar: PR #52, komentarz
    // 6890658471 — 3/5 czerwonych przebiegow przed, 0/5 po). Wiszacy test
    // lokalnie nadal pada (po 15 s); test, ktory zwolnil do 6-14 s, wylapie CI.
    // Jawne { timeout: N } w tescie ma pierwszenstwo nad tymi wartosciami.
    testTimeout: process.env.CI ? 5000 : 15000,
    hookTimeout: process.env.CI ? 10000 : 20000,
    coverage: {
      provider: 'v8',
      // Bramka pokrycia mierzy RDZEN testowany jednostkowo (src/lib/**: utils,
      // walidacje, auth, warstwa repo RLS, feature flags, salon-context,
      // api-handler). Trasy API (src/app/api/**/route.ts) i UI sa pokryte
      // E2E/integracyjnie (Playwright, vitest.integration) — ich instrumentacja
      // w mianowniku unit-coverage falszywie zaniza wynik, bo logika warunkowa
      // zyje w sciezce HTTP, nie w wywolaniu funkcji. Stad scope = src/lib/**.
      include: ['src/lib/**'],
      reporter: ['text', 'html', 'json'],
      exclude: [
        'node_modules/',
        'tests/',
        '.next/',
        // Cienkie adaptery zewnetrznych SDK / I/O — bez logiki warunkowej do
        // testu jednostkowego; weryfikowane integracyjnie/E2E, nie mockiem.
        'src/lib/db.ts',                 // tylko inicjalizacja polaczenia drizzle/postgres
        'src/lib/schema.ts',             // deklaracje tabel Drizzle (dane, nie logika)
        'src/lib/auth.ts',               // konfiguracja Better Auth (adapter)
        'src/lib/auth-client.ts',        // klient Better Auth (adapter)
        // Wrappery zewnetrznych API (OpenRouter/ElevenLabs/Imagen/Veo) oraz
        // logika analityczna wyniesiona z tras w Fazie 3 (src/lib/ai/business,
        // search) — pokrywana przez testy tras/E2E, ta sama zasada co route.ts.
        // Wyjatek: usage-limits.ts ma pelne testy jednostkowe, ale zostaje
        // w wylaczeniu katalogowym dla prostoty (testy i tak biegna).
        'src/lib/ai/**',
        'src/lib/twilio.ts',             // wrapper Twilio (zew. API)
        'src/lib/pdf-export.ts',         // generator PDF (binarny output, E2E)
        'src/lib/api-client.ts',         // klient fetch po stronie przegladarki
        // Orkiestrator powiadomien listy rezerwowej: DB + fan-out push/sms/email
        // w sciezce HTTP (notifyWaitingList wolane z tras) — pokrywany E2E/
        // integracyjnie, nie mockiem jednostkowym (analogia do route.ts).
        'src/lib/waiting-list.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
