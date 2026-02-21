"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A simple client-side button that reloads the current page.
 * Used on the offline fallback page where server-side navigation is unavailable.
 */
export function ReloadButton() {
  return (
    <Button onClick={() => window.location.reload()}>
      <RefreshCw className="h-4 w-4" />
      Sprobuj ponownie
    </Button>
  );
}
