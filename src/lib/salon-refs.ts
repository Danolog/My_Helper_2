import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { clients, employees, serviceCategories, services } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";

/**
 * Przynależność identyfikatorów z body do salonu (P1, przegląd Ryana).
 *
 * Trasy przyjmują `clientId` / `employeeId` / `serviceId` / `categoryId`
 * z żądania. Bez sprawdzenia, że rekord należy do salonu wizyty, można było
 * podpiąć cudzego klienta (wyciek danych w GET wizyty, SMS do obcej osoby),
 * zablokować kalendarz pracownika innego salonu albo podpiąć cudzą usługę.
 *
 * Każde podane id musi istnieć W TYM salonie — zapytanie jest zawężone do
 * `salonId` (jawne eq + kontekst RLS przez forSalon). Rekord innego salonu,
 * nieistniejący i o złym formacie dają TEN SAM błąd 400: odpowiedź nie
 * zdradza, czy identyfikator istnieje gdzie indziej. Który ref odpadł,
 * trafia wyłącznie do logu serwera.
 */

export interface SalonRefs {
  clientId?: string | null | undefined;
  employeeId?: string | null | undefined;
  serviceId?: string | null | undefined;
  categoryId?: string | null | undefined;
}

/** Jedyny komunikat błędu — celowo niezdradzający, który ref i dlaczego. */
export const SALON_REF_ERROR = "Nieprawidlowe dane dla tego salonu";

const TABLES = {
  clientId: clients,
  employeeId: employees,
  serviceId: services,
  categoryId: serviceCategories,
} as const;

type RefKey = keyof typeof TABLES;

/**
 * Zwraca `null`, gdy wszystkie podane id należą do salonu; w przeciwnym razie
 * gotową odpowiedź 400. Puste wartości (`undefined`, `null`, `""`) są
 * pomijane — o tym, czy pole jest wymagane, decyduje schemat trasy.
 */
export async function assertSalonRefs(
  salonId: string,
  refs: SalonRefs
): Promise<NextResponse | null> {
  const provided = (Object.keys(TABLES) as RefKey[])
    .map((key) => [key, refs[key]] as const)
    .filter((entry): entry is readonly [RefKey, string] => typeof entry[1] === "string" && entry[1] !== "");

  if (provided.length === 0) return null;

  const reject = (key: RefKey, reason: "format" | "not_in_salon") => {
    logger.warn("[salon-refs] Rejected reference outside the salon", { salonId, ref: key, reason });
    return NextResponse.json({ success: false, error: SALON_REF_ERROR }, { status: 400 });
  };

  // Zły format odrzucamy przed bazą (inaczej uuid cast = 500 z Postgresa).
  for (const [key, id] of provided) {
    if (!isValidUuid(id)) return reject(key, "format");
  }

  const missing = await forSalon(salonId).raw(async (tx) => {
    for (const [key, id] of provided) {
      const table = TABLES[key];
      const rows = await tx
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.id, id), eq(table.salonId, salonId)))
        .limit(1);
      if (rows.length === 0) return key;
    }
    return null;
  });

  return missing ? reject(missing, "not_in_salon") : null;
}
