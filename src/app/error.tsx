"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service (console only, never shown to user)
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="container mx-auto px-4 py-16">
      <div className="max-w-md mx-auto text-center">
        <div className="flex justify-center mb-6">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertCircle className="h-12 w-12 text-destructive" />
          </div>
        </div>
        <h1 className="text-2xl font-bold mb-3">Wystapil nieoczekiwany blad</h1>
        <p className="text-muted-foreground mb-6">
          Przepraszamy za niedogodnosc. Sprobuj ponownie lub wroc na strone glowna.
          Jesli problem sie powtarza, skontaktuj sie z obsluga.
        </p>
        <div className="flex gap-4 justify-center">
          <Button onClick={reset} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Sprobuj ponownie
          </Button>
          <Button variant="outline" onClick={() => (window.location.href = "/")} className="gap-2">
            <Home className="h-4 w-4" />
            Strona glowna
          </Button>
        </div>
      </div>
    </div>
  );
}
