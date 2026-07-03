"use client";

import { ShieldX } from "lucide-react";
import { useSalonRole } from "./role-provider";
import type { SalonRole } from "@/lib/salon-context";

/**
 * Bramka strony wg roli salonu (Faza 3 — wzorzec ModuleGate). Gdy rola
 * zalogowanego użytkownika nie jest na liście `allow`, zamiast treści
 * strony pokazuje kartę „Brak uprawnien" (deep-linki i zakładki nie
 * wywracają się na 404, bez linku do ustawień — pracownik i tak nie ma
 * tam dostępu).
 */
export function RoleGate({
  allow,
  children,
}: {
  allow: ReadonlyArray<SalonRole>;
  children: React.ReactNode;
}) {
  const role = useSalonRole();

  if (allow.includes(role)) return <>{children}</>;

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-lg border border-dashed p-8 text-center">
        <ShieldX className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold">Brak uprawnien do tej sekcji</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ta sekcja nie jest dostepna dla Twojej roli. Skontaktuj sie z
            wlascicielem salonu, jesli potrzebujesz dostepu.
          </p>
        </div>
      </div>
    </div>
  );
}
