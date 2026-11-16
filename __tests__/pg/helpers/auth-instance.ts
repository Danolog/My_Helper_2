/**
 * Proces potomny testu dwóch instancji (`__tests__/pg/auth-two-process.pg.test.ts`).
 *
 * Minimalna instancja Better Auth ze wspólną fabryką `buildAuthRateLimitOptions`
 * (tryb z własnego env: AUTH_RATE_LIMIT_STORE), `rateLimit.enabled: true`
 * jawnie (poza produkcją biblioteka limit wyłącza), adres z X-Forwarded-For,
 * użytkownicy w adapterze pamięciowym biblioteki. NIE ładuje `src/lib/auth.ts`.
 *
 * Połączenie z bazą: `@/lib/db` z POSTGRES_URL. Zanim cokolwiek się połączy,
 * potomek przepuszcza INTEGRATION_POSTGRES_URL przez ten sam guard harnessu
 * (`createIntegrationDb`: host, opcje klienta, tożsamość serwera) i wymaga,
 * żeby POSTGRES_URL był dokładnie tym adresem.
 *
 * Protokół IPC: rodzic → `{ id, path, ip, email }`, potomek → `{ id, status }`;
 * po starcie potomek wysyła `{ ready: true }`, przy błędzie startu `{ error }`
 * (sama nazwa błędu, bez adresu bazy) i kończy się kodem 2.
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createIntegrationDb } from "../pg-harness";
import { getAuthRateLimitStore } from "@/lib/auth-rate-limit-mode";
import { buildAuthRateLimitOptions } from "@/lib/auth-rate-limit-options";

const BASE = "http://localhost:3000";

type Ask = { id: number; path: string; ip: string; email: string };

async function main() {
  if (!process.send) throw new Error("brak kanału IPC");
  const guarded = await createIntegrationDb();
  if (!guarded) throw new Error("brak INTEGRATION_POSTGRES_URL");
  await guarded.end();
  if (!process.env.POSTGRES_URL || process.env.POSTGRES_URL !== process.env.INTEGRATION_POSTGRES_URL) {
    throw new Error("POSTGRES_URL musi być adresem przepuszczonym przez guard harnessu");
  }

  const rl = buildAuthRateLimitOptions(getAuthRateLimitStore(process.env));
  const auth = betterAuth({
    baseURL: BASE,
    secret: process.env.BETTER_AUTH_SECRET,
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    trustedOrigins: [BASE],
    advanced: { ipAddress: { ipAddressHeaders: ["x-forwarded-for"] } },
    emailAndPassword: { enabled: true },
    ...("hooks" in rl ? { hooks: rl.hooks } : {}),
    rateLimit: { ...("rateLimit" in rl ? rl.rateLimit : {}), enabled: true },
  });

  process.on("message", (msg: Ask) => {
    void (async () => {
      const res = await auth.handler(
        new Request(`${BASE}/api/auth${msg.path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": msg.ip },
          body: JSON.stringify({ email: msg.email, password: "Zle-Haslo-000" }),
        }),
      );
      process.send!({ id: msg.id, status: res.status });
    })().catch((e: unknown) => {
      process.send!({ id: msg.id, status: -1, error: e instanceof Error ? e.name : "UnknownError" });
    });
  });
  process.on("disconnect", () => process.exit(0));
  process.send({ ready: true });
}

main().catch((e: unknown) => {
  process.send?.({ error: e instanceof Error ? `${e.name}: ${e.message}` : "UnknownError" });
  process.exit(2);
});
