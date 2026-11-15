import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// Limit findBy*/waitFor bez jawnego { timeout }: w CI domyslny Testing Library
// (1000 ms) — bramka bez zmian; lokalnie 3000 ms, bo pod obciazeniem maszyny
// render + effect potrafia nie zdazyc w 1 s mimo poprawnego kodu.
// Uzasadnienie i pomiar: vitest.config.ts (testTimeout/hookTimeout).
configure({ asyncUtilTimeout: process.env.CI ? 1000 : 3000 });
