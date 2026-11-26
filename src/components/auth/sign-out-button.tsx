"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const SIGN_OUT_ERROR = "Nie udało się wylogować. Spróbuj ponownie.";

/**
 * Przycisk wylogowania dla miejsc, które renderują się tylko z sesją
 * (panel salonu, zakładanie salonu) — dlatego bez sprawdzania sesji.
 * Po wylogowaniu przejście na /login. Przy błędzie zostajemy na stronie
 * z komunikatem: przejście na /login z żywą sesją odesłałoby z powrotem.
 */
export function SignOutButton({
  className,
  variant = "outline",
}: {
  className?: string;
  variant?: "outline" | "ghost";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const handleSignOut = async () => {
    setPending(true);
    setError("");
    // Clear SW caches before sign-out so no user-specific data persists
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_CACHES" });
    try {
      const result = await signOut();
      if (result?.error) throw new Error(result.error.message);
      router.replace("/login");
      router.refresh();
    } catch {
      setError(SIGN_OUT_ERROR);
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        className={cn("min-h-[44px] justify-start gap-3", className)}
        disabled={pending}
        onClick={handleSignOut}
      >
        <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
        Wyloguj się
      </Button>
      {error && (
        <p role="alert" className="px-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
