import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { logger } from "@/lib/logger";
import { NO_SUBSCRIPTIONS_ERROR, sendPushNotification } from "@/lib/push";
import { strictRateLimit, getClientIp } from "@/lib/rate-limit";
import { resolveSalonContext } from "@/lib/salon-context";

/**
 * POST /api/push/test
 *
 * Send a test push notification to the authenticated user.
 * Used for verifying push notification setup.
 *
 * Rekord `notifications` trafia do salonu użytkownika z sesji (właściciel lub
 * aktywny pracownik — resolveSalonContext). Konto bez jednoznacznego salonu:
 * push idzie, rekordu nie ma (salonu nie zgadujemy).
 *
 * Odpowiedź: tylko łączne `sent`/`failed` i ogólny komunikat — bez błędów per
 * endpoint i bez treści wyjątków (żadnej wyroczni o hostach/portach).
 */
export async function POST(request: Request) {
  // Rate limit: push notification testing is a sensitive operation
  const ip = getClientIp(request);
  const rateLimitResult = strictRateLimit.check(ip);
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimitResult.reset / 1000)) } }
    );
  }

  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  try {
    const { ctx } = await resolveSalonContext(user.id);

    const result = await sendPushNotification(user.id, {
      title: "Test powiadomienia push",
      body: "To jest testowe powiadomienie push z MyHelper. Dzialasz! 🎉",
      tag: "test-notification",
      data: { type: "test", url: "/dashboard/notifications" },
      salonId: ctx?.salonId ?? null,
    });

    return NextResponse.json({
      success: result.success,
      data: {
        sent: result.sent,
        failed: result.failed,
        ...(result.success
          ? {}
          : {
              error:
                result.error === NO_SUBSCRIPTIONS_ERROR
                  ? "Brak zarejestrowanych urzadzen dla powiadomien push"
                  : "Nie udalo sie wyslac powiadomienia testowego",
            }),
      },
    });
  } catch (error) {
    logger.error("[Push Test] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to send test push" },
      { status: 500 }
    );
  }
}
