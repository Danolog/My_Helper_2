/**
 * Kontrola wyniku seeda testowego (#193 P5b): `pnpm exec tsx scripts/verify-seed.ts`.
 *
 * Tylko odczyt. Ten sam strażnik bazy docelowej co `scripts/seed-test.ts`
 * (`./seed-host-guard`: URL, hosty klienta, tożsamość serwera), żeby skrypt
 * nie łączył się z żadną bazą poza lokalną i CI. Przebieg i reguły kontroli:
 * `runVerifySeed` w `./verify-seed-checks.ts`; ten plik podpina tylko postgres.js,
 * konsolę i kod wyjścia. Niezgodność → lista problemów i kod wyjścia 1.
 * Wyjście: tylko nazwy kontroli i liczby (bez e-maili, identyfikatorów i adresu bazy).
 */
import postgres from "postgres";
import { runVerifySeed } from "./verify-seed-checks";

runVerifySeed({
  env: { POSTGRES_URL: process.env.POSTGRES_URL, VERCEL_ENV: process.env.VERCEL_ENV },
  connect: (url) => postgres(url),
  log: (line) => console.log(line),
  error: (line) => console.error(line),
}).then(
  (code) => process.exit(code),
  () => process.exit(1),
);
