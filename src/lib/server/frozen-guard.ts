import { NextResponse } from "next/server";
import {
  MODULE_DISABLED_CODE,
  MODULE_DISABLED_MESSAGE,
  isModuleFrozen,
  type ModuleKey,
} from "@/lib/features";

/**
 * Druga linia obrony zamrożenia (uwaga Ryana z przeglądu B1): trasa modułu
 * zamrożonego sama pyta rejestr, zanim zrobi cokolwiek innego — zanim
 * sprawdzi sesję, policzy limit, sięgnie do bazy albo wywoła model.
 * Pierwsza linia to `src/proxy.ts`; ta działa, gdyby proxy zostało
 * ominięte (zmiana matchera, inny zapis ścieżki, wywołanie handlera
 * wprost). Odpowiedź jest ta sama co w proxy: 404 `MODULE_DISABLED`.
 *
 * Reguła (który moduł jest zamrożony) żyje tylko w `src/lib/features.ts`.
 * Odmrożenie modułu w rejestrze odblokowuje trasę bez zmiany tego pliku.
 */
export function frozenModuleResponse(module: ModuleKey): NextResponse | null {
  if (!isModuleFrozen(module)) return null;
  return NextResponse.json(
    { success: false, code: MODULE_DISABLED_CODE, error: MODULE_DISABLED_MESSAGE },
    { status: 404 }
  );
}
