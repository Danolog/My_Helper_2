import { NextResponse } from "next/server";
import {
  MODULE_DISABLED_CODE,
  MODULE_DISABLED_MESSAGE,
  isModuleFrozen,
  isPromotionTypeFrozen,
  type ModuleKey,
} from "@/lib/features";

/**
 * Druga linia obrony zamrożenia (uwaga z audytu bezpieczeństwa z przeglądu B1): trasa modułu
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
  return moduleDisabledResponse();
}

/**
 * 404 `MODULE_DISABLED` — ta sama odpowiedź dla modułu zamrożonego
 * w rejestrze i dla modułu wyłączonego przełącznikiem w ustawieniach salonu.
 */
export function moduleDisabledResponse(): NextResponse {
  return NextResponse.json(
    { success: false, code: MODULE_DISABLED_CODE, error: MODULE_DISABLED_MESSAGE },
    { status: 404 }
  );
}

/** Kod błędu dla próby utworzenia albo zmiany promocji na typ zamrożony. */
export const PROMOTION_TYPE_DISABLED_CODE = "PROMOTION_TYPE_DISABLED";

/**
 * 400 dla typu promocji zamrożonego (`FROZEN_PROMOTION_TYPES` w rejestrze).
 * `POST`/`PUT /api/promotions` wołają to po walidacji schematu, przed zapisem.
 */
export function frozenPromotionTypeResponse(type: unknown): NextResponse | null {
  if (!isPromotionTypeFrozen(type)) return null;
  return NextResponse.json(
    {
      success: false,
      code: PROMOTION_TYPE_DISABLED_CODE,
      error: "Ten typ promocji jest obecnie niedostępny. Dostępne: rabat procentowy i kwotowy.",
    },
    { status: 400 }
  );
}
