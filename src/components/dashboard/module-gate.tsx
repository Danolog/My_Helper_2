"use client";

import Link from "next/link";
import { PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MODULES,
  MODULE_DISABLED_MESSAGE,
  isModuleFrozen,
  type ModuleKey,
} from "@/lib/features";
import { useModuleEnabled } from "./modules-provider";

/**
 * Bramka strony dla modułu opcjonalnego (Faza 2). Gdy moduł jest wyłączony,
 * zamiast treści strony pokazuje kartę „Moduł wyłączony" z linkiem do
 * Ustawienia → Moduły (deep-linki i zakładki nie wywracają się na 404).
 *
 * Moduł zamrożony (`hardOff` w rejestrze) nie ma przełącznika, więc karta
 * mówi tylko, że funkcja jest niedostępna, i prowadzi do pulpitu — bez
 * obietnic. Strony takich modułów proxy i tak przekierowuje na /dashboard;
 * bramka jest drugą linią dla nawigacji po stronie przeglądarki.
 */
export function ModuleGate({
  module,
  children,
}: {
  module: ModuleKey;
  children: React.ReactNode;
}) {
  const enabled = useModuleEnabled(module);
  const frozen = isModuleFrozen(module);

  if (enabled && !frozen) return <>{children}</>;

  if (frozen) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center gap-4 rounded-lg border border-dashed p-8 text-center">
          <PackageX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold">{MODULE_DISABLED_MESSAGE}</h2>
          <Button asChild variant="outline">
            <Link href="/dashboard">Wróć do pulpitu</Link>
          </Button>
        </div>
      </div>
    );
  }

  const def = MODULES.find((m) => m.key === module);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-lg border border-dashed p-8 text-center">
        <PackageX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold">
            Moduł „{def?.label ?? module}" jest wyłączony
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Włącz go w ustawieniach, aby korzystać z tej sekcji.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/settings/modules">Przejdź do ustawień modułów</Link>
        </Button>
      </div>
    </div>
  );
}
