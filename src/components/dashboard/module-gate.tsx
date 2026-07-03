"use client";

import Link from "next/link";
import { PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MODULES, type ModuleKey } from "@/lib/features";
import { useModuleEnabled } from "./modules-provider";

/**
 * Bramka strony dla modułu opcjonalnego (Faza 2). Gdy moduł jest wyłączony,
 * zamiast treści strony pokazuje kartę „Moduł wyłączony" z linkiem do
 * Ustawienia → Moduły (deep-linki i zakładki nie wywracają się na 404).
 */
export function ModuleGate({
  module,
  children,
}: {
  module: ModuleKey;
  children: React.ReactNode;
}) {
  const enabled = useModuleEnabled(module);

  if (enabled) return <>{children}</>;

  const def = MODULES.find((m) => m.key === module);
  const hardOff = def?.hardOff === true;

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-lg border border-dashed p-8 text-center">
        <PackageX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold">
            Moduł „{def?.label ?? module}" jest wyłączony
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {hardOff
              ? "Ta funkcja będzie dostępna wkrótce."
              : "Włącz go w ustawieniach, aby korzystać z tej sekcji."}
          </p>
        </div>
        {!hardOff && (
          <Button asChild variant="outline">
            <Link href="/dashboard/settings/modules">Przejdź do ustawień modułów</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
