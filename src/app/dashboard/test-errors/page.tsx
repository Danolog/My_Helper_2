"use client";

import { useState, useCallback } from "react";
import {
  AlertTriangle,
  ServerCrash,
  RefreshCw,
  FileWarning,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { NetworkErrorHandler } from "@/components/network-error-handler";
import { getNetworkErrorMessage } from "@/lib/fetch-with-retry";
import { isTimeoutError } from "@/hooks/use-network-status";

type ErrorResult = {
  type: "success" | "error";
  message: string;
  technical?: string;
  retryable: boolean;
};

export default function TestErrorsPage() {
  const [lastResult, setLastResult] = useState<ErrorResult | null>(null);
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<{
    message: string;
    isNetwork: boolean;
    isTimeout: boolean;
  } | null>(null);

  const triggerError = useCallback(
    async (errorType: string, label: string) => {
      setIsLoading(errorType);
      setLastResult(null);
      setFetchError(null);

      try {
        const res = await fetch(`/api/test/error?type=${errorType}`, {
          signal: AbortSignal.timeout(5000), // 5s timeout for testing
        });
        const data = await res.json();

        if (!res.ok || !data.success) {
          // Server returned an error response - show user-friendly message
          const userMessage =
            data.error || "Wystapil blad serwera. Sprobuj ponownie pozniej.";

          // Show toast with retry action
          toast.error(userMessage, {
            action: {
              label: "Sprobuj ponownie",
              onClick: () => triggerError(errorType, label),
            },
          });

          setLastResult({
            type: "error",
            message: userMessage,
            retryable: true,
          });
        } else {
          toast.success("Zapytanie zakonczone pomyslnie");
          setLastResult({
            type: "success",
            message: "Operacja zakonczona pomyslnie",
            retryable: false,
          });
        }
      } catch (error) {
        // Network/timeout error - use centralized getNetworkErrorMessage
        console.error(`Failed API call (${label}):`, error);
        const errInfo = getNetworkErrorMessage(error);
        const timeout = isTimeoutError(error);

        // Show toast with retry
        toast.error(errInfo.message, {
          action: {
            label: "Sprobuj ponownie",
            onClick: () => triggerError(errorType, label),
          },
        });

        // Also set inline error state for NetworkErrorHandler demo
        setFetchError({
          message: errInfo.message,
          isNetwork: errInfo.isNetwork,
          isTimeout: timeout,
        });

        setLastResult({
          type: "error",
          message: errInfo.message,
          retryable: true,
        });
      } finally {
        setIsLoading(null);
      }
    },
    []
  );

  const triggerPostError = useCallback(async () => {
    setIsLoading("post");
    setLastResult(null);
    setFetchError(null);

    try {
      const res = await fetch("/api/test/error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: "data" }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        const userMessage =
          data.error || "Nie udalo sie zapisac danych. Sprobuj ponownie.";
        toast.error(userMessage, {
          action: {
            label: "Sprobuj ponownie",
            onClick: triggerPostError,
          },
        });
        setLastResult({
          type: "error",
          message: userMessage,
          retryable: true,
        });
      }
    } catch (error) {
      console.error("Failed POST request:", error);
      const errInfo = getNetworkErrorMessage(error);
      toast.error(
        errInfo.isNetwork
          ? errInfo.message
          : "Blad podczas zapisywania danych",
        {
          action: {
            label: "Sprobuj ponownie",
            onClick: triggerPostError,
          },
        }
      );
      setLastResult({
        type: "error",
        message: errInfo.message,
        retryable: true,
      });
    } finally {
      setIsLoading(null);
    }
  }, []);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Test obslugi bledow API</h1>
        <p className="text-muted-foreground mt-1">
          Strona do testowania wyswietlania bledow serwera. Kliknij przyciski
          ponizej, aby zasymulowac rozne typy bledow.
        </p>
      </div>

      {/* Error trigger cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {/* 500 Server Error */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ServerCrash className="h-5 w-5 text-destructive" />
              <CardTitle className="text-base">Blad serwera (500)</CardTitle>
            </div>
            <CardDescription>
              Symuluje wewnetrzny blad serwera. Powinien wyswietlic przyjazny
              komunikat bez szczegolow technicznych.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              onClick={() => triggerError("500", "Server Error")}
              disabled={isLoading !== null}
              variant="destructive"
              size="sm"
              className="gap-2"
            >
              {isLoading === "500" ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <ServerCrash className="h-4 w-4" />
              )}
              Wywolaj blad 500
            </Button>
          </CardFooter>
        </Card>

        {/* 400 Validation Error */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <FileWarning className="h-5 w-5 text-yellow-600" />
              <CardTitle className="text-base">
                Blad walidacji (400)
              </CardTitle>
            </div>
            <CardDescription>
              Symuluje blad walidacji z komunikatami dla poszczegolnych pol.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              onClick={() => triggerError("400", "Validation Error")}
              disabled={isLoading !== null}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              {isLoading === "400" ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <FileWarning className="h-4 w-4" />
              )}
              Wywolaj blad walidacji
            </Button>
          </CardFooter>
        </Card>

        {/* Timeout Error */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-500" />
              <CardTitle className="text-base">
                Timeout (przekroczony czas)
              </CardTitle>
            </div>
            <CardDescription>
              Symuluje wolna odpowiedz serwera, ktora powoduje timeout po 5
              sekundach.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              onClick={() => triggerError("timeout", "Timeout")}
              disabled={isLoading !== null}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              {isLoading === "timeout" ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Clock className="h-4 w-4" />
              )}
              Wywolaj timeout
            </Button>
          </CardFooter>
        </Card>

        {/* POST Error */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <CardTitle className="text-base">Blad zapisu (POST)</CardTitle>
            </div>
            <CardDescription>
              Symuluje nieudany zapis danych (POST). Powinien pokazac komunikat
              z opcja ponowienia.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              onClick={triggerPostError}
              disabled={isLoading !== null}
              variant="destructive"
              size="sm"
              className="gap-2"
            >
              {isLoading === "post" ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
              Wywolaj blad zapisu
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Inline NetworkErrorHandler demo (shows when fetch error occurs) */}
      {fetchError && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3">
            Komponent obslugi bledu (inline)
          </h2>
          <NetworkErrorHandler
            message={fetchError.message}
            isNetworkError={fetchError.isNetwork}
            isTimeout={fetchError.isTimeout}
            onRetry={() => {
              setFetchError(null);
              setLastResult(null);
            }}
          />
        </div>
      )}

      {/* Last result display */}
      {lastResult && (
        <Card
          className={
            lastResult.type === "error"
              ? "border-destructive/50 bg-destructive/5"
              : "border-green-500/50 bg-green-500/5"
          }
        >
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">
                Ostatni wynik
              </CardTitle>
              <Badge
                variant={
                  lastResult.type === "error" ? "destructive" : "default"
                }
              >
                {lastResult.type === "error" ? "Blad" : "Sukces"}
              </Badge>
              {lastResult.retryable && (
                <Badge variant="outline">Mozna ponowic</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{lastResult.message}</p>
            {lastResult.technical && (
              <p className="text-xs text-muted-foreground mt-2">
                Szczegoly techniczne: {lastResult.technical}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Information about error handling */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-base">
            Jak dziala obsluga bledow
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong>Komunikaty toast:</strong> Bledy API sa wyswietlane jako
            powiadomienia toast z przyjaznym komunikatem w jezyku polskim.
          </p>
          <p>
            <strong>Ukryte szczegoly techniczne:</strong> Stack trace, kody
            bledow i inne informacje techniczne sa logowane tylko w konsoli
            przegladarki, nigdy nie sa widoczne dla uzytkownika.
          </p>
          <p>
            <strong>Opcja ponowienia:</strong> Kazdy toast z bledem zawiera
            przycisk &ldquo;Sprobuj ponownie&rdquo; do powtorzenia operacji.
          </p>
          <p>
            <strong>Komponent inline:</strong> Dla bledow ladowania danych
            wyswietlany jest komponent NetworkErrorHandler z przyciskiem retry.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
