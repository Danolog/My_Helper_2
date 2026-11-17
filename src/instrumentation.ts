// Next.js wywołuje register() raz przy inicjalizacji serwera, zanim obsłuży
// pierwsze żądanie (także sondę startową /api/health na Cloud Run).
// Strażnik sekretów: infra/runtime/secret-guard.mjs (K-1, #144 W1).
// Konfiguracja limitu prób logowania: src/lib/auth-rate-limit-mode.ts.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { enforceSecretGuard } = await import("../infra/runtime/secret-guard.mjs");
  const { logger } = await import("./lib/logger");
  enforceSecretGuard(
    process.env,
    (code) => process.exit(code),
    (message, context) => logger.error(message, context),
  );
  const { enforceAuthRateLimitStore } = await import("./lib/auth-rate-limit-mode");
  enforceAuthRateLimitStore(
    process.env,
    (code) => process.exit(code),
    (message, context) => logger.error(message, context),
    (message, context) => logger.info(message, context),
  );
}
