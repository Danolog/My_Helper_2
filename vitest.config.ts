import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

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
    exclude: ['node_modules/**', 'dist/**', '.next/**', '__tests__/integration/**'],
    coverage: {
      provider: 'v8',
      // Bramka pokrycia mierzy RDZEN testowany jednostkowo (src/lib/**: utils,
      // walidacje, auth, warstwa repo RLS). Trasy API (src/app/api/**/route.ts)
      // i UI sa pokryte E2E/integracyjnie (Playwright, vitest.integration) —
      // ich instrumentacja w mianowniku unit-coverage falszywie zaniza wynik
      // (route.ts: 10-69% branchy), bo logika warunkowa zyje w sciezce HTTP,
      // nie w wywolaniu funkcji. Stad scope = src/lib/**.
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
        'src/lib/ai/**',                 // wrappery OpenRouter/ElevenLabs/Imagen/Veo (zew. API)
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
