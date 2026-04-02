import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";
import { ReloadButton } from "@/components/reload-button";

export const metadata: Metadata = {
  title: "Offline",
  description: "Brak polaczenia z internetem",
};

/**
 * Offline fallback page served by the service worker when the user
 * has no network connection and the requested page is not in cache.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="flex flex-col items-center gap-6 text-center max-w-md">
        <WifiOff className="h-16 w-16 text-muted-foreground" />

        <div className="space-y-2">
          <h1 className="text-2xl font-bold">
            Brak polaczenia z internetem
          </h1>
          <p className="text-muted-foreground">
            Nie mozesz teraz uzyc tej strony, poniewaz nie masz polaczenia z
            internetem. Sprawdz polaczenie i sprobuj ponownie.
          </p>
        </div>

        <ReloadButton />

        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
        >
          Wroc do panelu
        </Link>
      </div>
    </div>
  );
}
