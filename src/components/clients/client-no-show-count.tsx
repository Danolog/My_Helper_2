"use client";

import { useEffect, useState } from "react";
import { UserX } from "lucide-react";
import { NO_SHOW_LABEL } from "@/lib/no-show";

interface ClientNoShowCountProps {
  clientId: string;
}

/** Stan licznika: przy błędzie pobierania licznik się nie pokazuje (karta działa dalej). */
type CountState = { status: "loading" } | { status: "ready"; count: number } | { status: "error" };

/**
 * Liczba wizyt klienta oznaczonych „Nie przyszedł” (GET /api/clients/[id]/no-shows).
 * Wartość liczy serwer przy każdym wejściu na kartę, więc cofnięcie oznaczenia
 * przy wizycie od razu ją zmniejsza.
 */
export function ClientNoShowCount({ clientId }: ClientNoShowCountProps) {
  const [state, setState] = useState<CountState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/no-shows`, { signal: controller.signal });
        const data = (await res.json()) as { success?: boolean; data?: { noShowCount?: unknown } };
        const count = data?.data?.noShowCount;
        if (!res.ok || data?.success !== true || typeof count !== "number") {
          setState({ status: "error" });
          return;
        }
        setState({ status: "ready", count });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setState({ status: "error" });
      }
    })();
    return () => controller.abort();
  }, [clientId]);

  if (state.status !== "ready") return null;

  const hasNoShows = state.count > 0;
  return (
    <div
      className={`flex items-center gap-2 mb-6 text-sm ${hasNoShows ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}
      data-testid="client-no-show-count"
    >
      <UserX className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {NO_SHOW_LABEL}: <strong data-testid="client-no-show-count-value">{state.count}</strong>{" "}
        {visitsWord(state.count)}
      </span>
    </div>
  );
}

/** „1 wizyta”, „2–4 wizyty”, „0, 5+ wizyt” (z wyjątkiem 12–14). */
function visitsWord(count: number): string {
  if (count === 1) return "wizyta";
  const lastDigit = count % 10;
  const lastTwo = count % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) return "wizyty";
  return "wizyt";
}
