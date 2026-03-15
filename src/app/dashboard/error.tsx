"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error for debugging (console only, never shown to user)
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-4">
      <Card className="max-w-md w-full border-destructive/50 bg-destructive/5">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-3">
            <div className="rounded-full bg-yellow-500/10 p-3">
              <AlertTriangle className="h-8 w-8 text-yellow-600" />
            </div>
          </div>
          <CardTitle className="text-lg">Blad ladowania strony</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-sm text-muted-foreground">
            Wystapil problem z zaladowaniem tej strony. Moze to byc chwilowy
            problem z serwerem. Sprobuj odswiezyc strone lub wroc do panelu glownego.
          </p>
        </CardContent>
        <CardFooter className="flex justify-center gap-3 pt-0">
          <Button onClick={reset} variant="default" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Sprobuj ponownie
          </Button>
          <Button
            variant="outline"
            onClick={() => (window.location.href = "/dashboard")}
            className="gap-2"
          >
            <LayoutDashboard className="h-4 w-4" />
            Panel glowny
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
