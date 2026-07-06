import { NextResponse } from "next/server";
import { getSalonContext } from "@/lib/salon-context";

export type ReportSalonResult =
  | { salonId: string; error?: undefined }
  | { salonId?: undefined; error: NextResponse };

/**
 * Resolwuje salon dla endpointu raportu z sesji i wymusza wlasnosc tenanta
 * (UAT X-1). Parametr `salonId` musi zgadzac sie z salonem sesji — odczyt
 * cross-tenant zwraca 403. Wczesniej raporty ufaly parametrowi bez sprawdzenia,
 * wiec kazdy zalogowany uzytkownik mogl czytac finanse dowolnego salonu.
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

  const requested = new URL(request.url).searchParams.get("salonId");
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

  return { salonId: ctx.salonId };
}
