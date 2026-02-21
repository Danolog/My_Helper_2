"use client";

import { WifiOff, RefreshCw, AlertTriangle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface NetworkErrorProps {
  /** Error message to display */
  message?: string;
  /** Callback to retry the failed action */
  onRetry: () => void;
  /** Whether a retry is currently in progress */
  isRetrying?: boolean;
  /** Whether the error is specifically a network error */
  isNetworkError?: boolean;
  /** Whether the error is specifically a timeout error */
  isTimeout?: boolean;
}

/**
 * Inline error component shown when a network request fails.
 * Displays the error message with a retry button.
 * Distinguishes between timeout, network, and general errors.
 * Can be used in place of content that failed to load.
 */
export function NetworkErrorHandler({
  message,
  onRetry,
  isRetrying = false,
  isNetworkError = true,
  isTimeout = false,
}: NetworkErrorProps) {
  const defaultMessage = isTimeout
    ? "Serwer nie odpowiedzial w wymaganym czasie. Sprobuj ponownie pozniej."
    : isNetworkError
      ? "Brak polaczenia z serwerem. Sprawdz polaczenie internetowe i sprobuj ponownie."
      : "Wystapil blad podczas ladowania danych. Sprobuj ponownie.";

  const title = isTimeout
    ? "Przekroczony czas oczekiwania"
    : isNetworkError
      ? "Brak polaczenia"
      : "Blad ladowania";

  return (
    <Card className="border-destructive/50 bg-destructive/5 max-w-lg mx-auto my-8">
      <CardHeader className="text-center pb-2">
        <div className="flex justify-center mb-3">
          {isTimeout ? (
            <div className="rounded-full bg-orange-500/10 p-3">
              <Clock className="h-8 w-8 text-orange-500" />
            </div>
          ) : isNetworkError ? (
            <div className="rounded-full bg-destructive/10 p-3">
              <WifiOff className="h-8 w-8 text-destructive" />
            </div>
          ) : (
            <div className="rounded-full bg-yellow-500/10 p-3">
              <AlertTriangle className="h-8 w-8 text-yellow-600" />
            </div>
          )}
        </div>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-center">
        <p className="text-sm text-muted-foreground">
          {message || defaultMessage}
        </p>
      </CardContent>
      <CardFooter className="flex justify-center pt-0">
        <Button
          onClick={onRetry}
          disabled={isRetrying}
          variant="outline"
          className="gap-2"
        >
          <RefreshCw
            className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`}
          />
          {isRetrying ? "Ponawiam..." : "Sprobuj ponownie"}
        </Button>
      </CardFooter>
    </Card>
  );
}
