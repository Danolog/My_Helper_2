"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { clientLoginPath } from "@/lib/features";

/**
 * Sesja na stronach portalu klienta, które wymagają logowania.
 *
 * Na logowanie klienta (`/portal/login?returnTo=…`) kieruje tylko przy pewnym
 * braku sesji: odpowiedź bez sesji albo 401. Przy innym błędzie pobrania sesji
 * (429 po ponowieniach, 5xx, zerwana sieć) Better Auth też daje `data: null`,
 * ale ciasteczko sesji zostaje. `/portal/login` widzi wtedy ciasteczko
 * i odsyła z powrotem na `returnTo`, więc przekierowanie zrobiłoby pętlę.
 * W takim stanie strona pokazuje komunikat z ponowieniem (`checkFailed`).
 */
export function useClientPortalSession(returnTo: string) {
  const { data: session, isPending, error, refetch } = useSession();
  const router = useRouter();

  const hasNoSession = !isPending && !session;
  const signedOut = hasNoSession && (!error || error.status === 401);
  const checkFailed = hasNoSession && !signedOut;

  useEffect(() => {
    if (signedOut) {
      router.push(clientLoginPath(returnTo));
    }
  }, [signedOut, router, returnTo]);

  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  /**
   * Pobiera sesję z serwera z pominięciem pamięci podręcznej w ciasteczku.
   * Gdy sesji już nie ma, `session` staje się `null` i hook sam przekieruje
   * na logowanie. Gdy jest, zostaje bez zmian.
   */
  const confirmSession = useCallback(
    () => refetch({ query: { disableCookieCache: true } }),
    [refetch],
  );

  return { session, isPending, signedOut, checkFailed, retry, confirmSession };
}
