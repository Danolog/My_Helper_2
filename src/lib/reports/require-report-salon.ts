import { NextResponse } from "next/server";
import { getSalonContext, hasFeatureAccess } from "@/lib/salon-context";

/** Grant temporary_access otwierający raporty pracownikowi/recepcji. */
export const REPORTS_FEATURE = "reports";

export type ReportSalonResult =
  | { salonId: string; error?: undefined }
  | { salonId?: undefined; error: NextResponse };

/**
 * Resolwuje salon dla endpointu raportu z sesji i wymusza wlasnosc tenanta
 * (UAT X-1). Parametr `salonId` musi zgadzac sie z salonem sesji — odczyt
 * cross-tenant zwraca 403. Wczesniej raporty ufaly parametrowi bez sprawdzenia,
 * wiec kazdy zalogowany uzytkownik mogl czytac finanse dowolnego salonu.
 *
 * Rola: raporty (przychod, wynagrodzenia i prowizje pracownikow) sa dla
 * wlasciciela. Pracownik/recepcja tylko z aktywnym grantem "reports"
 * (hasFeatureAccess) — inaczej 403. Wczesniej bramka sprawdzala tylko salon.
 */
export async function requireReportSalon(
  request: Request,
): Promise<ReportSalonResult> {
  const ctx = await getSalonContext();
  if (!ctx) {
    return {
      error: NextResponse.json(
        { success: false, error: "Nieautoryzowany" },
        { status: 401 },
      ),
    };
  }

  const params = new URL(request.url).searchParams;
  const requested = params.get("salonId");
  if (!requested) {
    return {
      error: NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 },
      ),
    };
  }
  if (requested !== ctx.salonId) {
    return {
      error: NextResponse.json(
        { success: false, error: "Brak dostepu do tego salonu" },
        { status: 403 },
      ),
    };
  }

  if (!(await hasFeatureAccess(ctx, REPORTS_FEATURE))) {
    return {
      error: NextResponse.json(
        { success: false, error: "Brak uprawnien do raportow" },
        { status: 403 },
      ),
    };
  }

  // UAT F2/X-2: niepoprawny format daty leci jako 500 z DB — waliduj tutaj
  for (const key of ["dateFrom", "dateTo"] as const) {
    const value = params.get(key);
    if (value && isNaN(new Date(value).getTime())) {
      return {
        error: NextResponse.json(
          { success: false, error: `Nieprawidlowy format daty (${key})` },
          { status: 400 },
        ),
      };
    }
  }

  return { salonId: ctx.salonId };
}
