"use client";

import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const DEFAULT_MESSAGE = "Nie udało się sprawdzić logowania. Spróbuj ponownie.";

interface SessionCheckErrorProps {
  onRetry: () => void;
  message?: string;
}

/**
 * Komunikat zamiast przekierowania na logowanie, gdy sesji nie da się
 * potwierdzić (błąd serwera, limit żądań, sieć). Przekierowanie w tym stanie
 * kończyłoby się pętlą między stroną a `/portal/login`.
 */
export function SessionCheckError({ onRetry, message = DEFAULT_MESSAGE }: SessionCheckErrorProps) {
  return (
    <div className="container mx-auto p-6">
      <div className="text-center py-12" role="alert" data-testid="session-check-error">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-lg font-semibold mb-4">{message}</p>
        <Button onClick={onRetry}>
          <RotateCw className="w-4 h-4 mr-2" />
          Spróbuj ponownie
        </Button>
      </div>
    </div>
  );
}
