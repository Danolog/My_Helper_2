"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

/**
 * Reads the ?activated, ?upgraded, ?downgraded query params
 * and shows a toast if present. Must be wrapped in Suspense
 * since it uses useSearchParams.
 */
export function ActivationToast() {
  const searchParams = useSearchParams();
  const activated = searchParams.get("activated");
  const upgraded = searchParams.get("upgraded");
  const downgraded = searchParams.get("downgraded");

  useEffect(() => {
    if (upgraded === "true") {
      toast.success("Plan zmieniony na Pro!", {
        description:
          "Twoj plan zostal pomyslnie zmieniony. Funkcje Pro sa juz dostepne.",
      });
      window.history.replaceState(null, "", "/dashboard/subscription");
    } else if (activated === "true") {
      toast.success("Subskrypcja aktywowana!", {
        description: "Twoj plan zostal pomyslnie aktywowany.",
      });
      window.history.replaceState(null, "", "/dashboard/subscription");
    } else if (downgraded === "true") {
      toast.success("Obnizenie planu zaplanowane!", {
        description:
          "Plan zostanie zmieniony na Basic po zakonczeniu biezacego okresu rozliczeniowego.",
      });
      window.history.replaceState(null, "", "/dashboard/subscription");
    }
  }, [activated, upgraded, downgraded]);

  return null;
}
