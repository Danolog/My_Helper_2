// Strażnik startu: sekret produkcyjny ≠ wartość testowa z repozytorium (K-1, #144 W1).
//
// Repozytorium jest publiczne. Każda wartość sekretu wpisana w workflow,
// docker-compose, skrypt infra albo test jest jawna — gdyby trafiła do
// Secret Manager jako wartość produkcyjna (np. BETTER_AUTH_SECRET z CI),
// każdy mógłby podpisać ciasteczko sesji. Konto wdrożeniowe widzi tylko
// metadane sekretów, więc porównanie wartości robi aplikacja przy starcie.
//
// Zasady:
// - działa wyłącznie na Cloud Run w produkcji: K_SERVICE ustawione
//   + NODE_ENV=production; lokalnie, w CI i na Vercelu nic nie robi;
// - lista zakazana trzyma tylko skróty SHA-256, nigdy wartości;
// - przy trafieniu aplikacja ODMAWIA STARTU (kod wyjścia 1) — samo 503
//   z /api/health zostawiłoby proces obsługujący ruch ze znanym sekretem;
// - log zawiera wyłącznie nazwę zmiennej, bez wartości i bez skrótu;
// - para Stripe (K-1b): STRIPE_SECRET_KEY i STRIPE_WEBHOOK_SECRET oba albo
//   żaden — tylko jedna ustawiona = odmowa startu z nazwą brakującej
//   (run-deploy.sh zatrzymuje taki deploy wcześniej).
//
// Kompletność listy pilnuje __tests__/lib/secret-guard.test.ts: każdy
// literał zmiennej klasy `secret` (infra/gcp/env-manifest.json) w plikach
// repozytorium musi mieć tu swój skrót. Nowa wartość testowa bez wpisu
// = czerwony test. Wpisy usuniętych literałów zostają (historia gita jest
// publiczna).

import { createHash } from "node:crypto";

/** Zmienne klasy `secret` z infra/gcp/env-manifest.json (test pilnuje zgodności). */
export const GUARDED_SECRET_ENV = Object.freeze([
  "BETTER_AUTH_SECRET",
  "CRON_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "POSTGRES_URL",
  "RESEND_API_KEY",
  "SMSAPI_TOKEN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
  "VAPID_PRIVATE_KEY",
]);

/** Skróty SHA-256 (hex) wartości testowych jawnych w repozytorium. */
export const FORBIDDEN_SHA256 = Object.freeze(new Set([
  // FORBIDDEN_SHA256:BEGIN (plik i nazwa pierwszego wystąpienia; wartości tylko w tych plikach)
  "12a8e939f41350345ba6e576fdf6df886460d7dcd369ae9fdff502c625efd60f", // __tests__/api/stripe-webhook-no-secret.test.ts STRIPE_WEBHOOK_SECRET
  "1a68a3e992734b1a9481a644b37e36a58c274f323c0a3bd2a0e772932f479171", // __tests__/lib/env.test.ts STRIPE_SECRET_KEY
  "1fa4662f17638df1381c5571cb70e0a93d0183aab4a2a23ab9dcb0ea4c54aa65", // __tests__/lib/db-lazy.test.ts POSTGRES_URL
  "28640b5cd3e787749d274246becbf24df967ecb184cfbdb91550ca3cf009f8ed", // __tests__/lib/email.test.ts RESEND_API_KEY (+1)
  "2bfa8153664cea627553c039f7531872e87981044beaaff3028ecaa3da509218", // __tests__/lib/workflows.test.ts POSTGRES_URL (+1)
  "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881", // __tests__/lib/container-config.test.ts STRIPE_SECRET_KEY
  "33a3a6e6188d1a17582dcc768e05ef1984f7685518308733ddccf13e1bc31cb8", // __tests__/api/stripe-webhook-no-secret.test.ts STRIPE_SECRET_KEY
  "34ebec9dbd3f9608cb676ce1caa8eb6b19b77970e61a28b5e1adeaae6494345d", // .github/workflows/quality-gate.yml BETTER_AUTH_SECRET
  "3ba3f5f43b92602683c19aee62a20342b084dd5971ddd33808d81a328879a547", // __tests__/lib/env.test.ts BETTER_AUTH_SECRET
  "4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e", // __tests__/lib/sms.test.ts SMSAPI_TOKEN
  "515c19fe8e843e709eaf92c970e861d9357b0e737be947ca02ed5782477103ab", // __tests__/lib/container-config.test.ts POSTGRES_URL
  "526b9699350a02f6b734815862a17421762de8aae6c54e2fe944db29bae0e57f", // __tests__/lib/db-lazy.test.ts POSTGRES_URL
  "5ae74c2bacf7e755ff395d760c524ca7616845ce565b9ab96c018322ae9329da", // docker-compose.app.yml POSTGRES_URL
  "69d929a001b50faa50b28ba737f093d72457ec09b1ac2f6c58baf87901227747", // .github/workflows/quality-gate.yml POSTGRES_URL
  "727af12edfd16c4e920b82106069e92c2321c516db2db2af1befabeaa5e5d6ab", // infra/gcp/smoke-container.sh POSTGRES_URL
  "7ba88f380e2bd2b3a94f74a0f3cdb2b502fdf251f829ad44cd009de9f632ed96", // __tests__/lib/stripe.test.ts STRIPE_SECRET_KEY
  "905ea8cd6eadc232b9afe81ae4e93082d460e1f499860526e5d55e0a26fdc6e0", // infra/gcp/smoke-container.sh BETTER_AUTH_SECRET (W1, K-1b)
  "7da7dc2f447370e69994c2606ac6db11185d8162011a9381bad221d83d2d686e", // __tests__/lib/workflows.test.ts STRIPE_SECRET_KEY
  "7eeb83914f8151e1e67db9d483b991dd261daba1952c77c364eaaf31682bef15", // __tests__/lib/csrf.test.ts BETTER_AUTH_SECRET
  "9d56078addde1645f626c60e9b0db31d98c7a8712e1350546640a210281594d7", // __tests__/lib/stripe.test.ts STRIPE_WEBHOOK_SECRET
  "a3976147bf907ccbd1a574643e2c3ffe3a93439f067289f03b156943ed83e65a", // __tests__/lib/workflows.test.ts BETTER_AUTH_SECRET
  "a7066090c547813d7a0bba71415e5ca25bac4ba571311cb1a8ba9ac2be9f6739", // __tests__/lib/stripe.test.ts STRIPE_SECRET_KEY
  "ac6d1d2375d89da7edca41e8c1b55705497f444b41cee14ec6dffa8f1e915916", // __tests__/lib/db-lazy.test.ts POSTGRES_URL
  "b2025000d6e82fa6b70affe01f24b9ed9b16a362db1c658aa07700c5027c3221", // __tests__/lib/csrf.test.ts BETTER_AUTH_SECRET
  "bae281b144b7e4352af148ef52bdf07c8f795ae3143a23b0d49a232cc1bde3e2", // __tests__/lib/web-push.test.ts VAPID_PRIVATE_KEY
  "d16236a92a59fd26b7c43c82b65cea0e6218bb130e472923bf8a8938837c729c", // __tests__/lib/env.test.ts GOOGLE_CLIENT_SECRET
  "d963480721c837c186f39ba6e7ce5e7b2ce3286453336c5efc9dc54b0b081db8", // docker-compose.app.yml BETTER_AUTH_SECRET
  "ed0257e97e8c51006601228c859edc6bf46e186a5ce4adac1dc423e030b5f2e9", // __tests__/lib/db-lazy.test.ts POSTGRES_URL
  "f9b0078b5df596d2ea19010c001bbd009e651de2c57e8fb7e355f31eb9d3f739", // __tests__/lib/env.test.ts BETTER_AUTH_SECRET
  "fdc0a90070072cd2e6545927095bd401952544f019be8c6523e246f4b7c3d470", // __tests__/lib/env.test.ts POSTGRES_URL
  // FORBIDDEN_SHA256:END
]));

export const SECRET_GUARD_MESSAGE =
  "secret-guard: odmowa startu — sekret ma wartość testową jawną w repozytorium";

/**
 * Para Stripe (K-1b): klucz API i sekret webhooka — oba albo żaden. Sam klucz
 * bez sekretu webhooka = płatności przyjmowane, a potwierdzenia odrzucane
 * (webhook fail-closed); sam sekret webhooka = konfiguracja niekompletna.
 */
export const STRIPE_PAIR = Object.freeze(["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]);

export const STRIPE_PAIR_MESSAGE =
  "secret-guard: odmowa startu — STRIPE_SECRET_KEY i STRIPE_WEBHOOK_SECRET muszą być ustawione oba albo żaden; brakuje";

/**
 * Nazwy brakujących zmiennych pary Stripe, jeśli ustawiona jest dokładnie jedna
 * (pusta albo same białe znaki = nieustawiona). Inaczej [].
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function stripePairMissing(env) {
  const set = STRIPE_PAIR.filter((n) => typeof env[n] === "string" && env[n].trim().length > 0);
  return set.length === 1 ? STRIPE_PAIR.filter((n) => !set.includes(n)) : [];
}

/** @param {string} value */
export function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** @param {Record<string, string | undefined>} env */
export function secretGuardActive(env) {
  return Boolean(env.K_SERVICE) && env.NODE_ENV === "production";
}

/**
 * Nazwy zmiennych, których wartość (także po trim) jest na liście zakazanej.
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function forbiddenSecretHits(env) {
  /** @type {string[]} */
  const hits = [];
  for (const name of GUARDED_SECRET_ENV) {
    const value = env[name];
    if (typeof value !== "string" || value.length === 0) continue;
    if (FORBIDDEN_SHA256.has(sha256Hex(value)) || FORBIDDEN_SHA256.has(sha256Hex(value.trim()))) {
      hits.push(name);
    }
  }
  return hits;
}

/**
 * Przy trafieniu (wartość z listy zakazanej albo niepełna para Stripe) loguje
 * nazwy zmiennych i kończy proces kodem 1.
 * @param {Record<string, string | undefined>} [env]
 * @param {(code: number) => never | void} [exit]
 * @param {(message: string, context: { variable: string }) => void} [log]
 * @returns {boolean} true, jeśli start dozwolony
 */
export function enforceSecretGuard(
  env = process.env,
  exit = (code) => process.exit(code),
  log = (message, context) => console.error(`${message} (${context.variable})`),
) {
  if (!secretGuardActive(env)) return true;
  const hits = forbiddenSecretHits(env);
  const stripeMissing = stripePairMissing(env);
  if (hits.length === 0 && stripeMissing.length === 0) return true;
  for (const variable of hits) log(SECRET_GUARD_MESSAGE, { variable });
  for (const variable of stripeMissing) log(STRIPE_PAIR_MESSAGE, { variable });
  exit(1);
  return false;
}
