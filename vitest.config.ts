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
      reporter: ['text', 'html', 'json'],
      exclude: ['node_modules/', 'tests/', '.next/'],
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
