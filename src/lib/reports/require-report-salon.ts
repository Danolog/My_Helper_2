import { NextResponse } from "next/server";
import { requireSalonStaff } from "@/lib/salon-context";

/** Grant temporary_access otwierający raporty pracownikowi/recepcji. */
export const REPORTS_FEATURE = "reports";

export type ReportSalonResult =
  | { salonId: string; error?: undefined }
  | { salonId?: undefined; error: NextResponse };

function badRequest(error: string): ReportSalonResult {
  return { error: NextResponse.json({ success: false, error }, { status: 400 }) };
}

/**
 * Bramka endpointów raportów — cienkie opakowanie (#101, decyzja Ethana z
 * recenzji #99). Autoryzacja to jeden strażnik dla wszystkich tras salonu:
 * `requireSalonStaff({ requestedSalonId, feature: REPORTS_FEATURE })`.
 *
 *   - brak sesji 401; konto bez salonu 404 (wcześniej 401 — trasy raportów
 *     wołają requireAuth() przed bramką, więc 401 znaczyło „zalogowany, ale bez
 *     salonu”, a klient odświeżający sesję na 401 mógł się zapętlić);
 *   - konto przypięte do kilku rekordów pracownika 403;
 *   - salonId z query inny niż salon sesji 403 (UAT X-1, odczyt cross-tenant);
 *   - rola: właściciel zawsze; pracownik/recepcja tylko z grantem "reports"
 *     (hasTemporaryAccess w salonie sesji) — ta sama semantyka co dawne
 *     hasFeatureAccess (owner => true, inaczej grant w ctx.salonId).
 *
 * Tu zostaje tylko walidacja kształtu żądania (400): salonId wymagany (raporty
 * zawsze go wysyłają) i daty, które bez walidacji leciałyby jako 500 z DB
 * (UAT F2/X-2). Walidacja PO strażniku — anonim i obcy salon nie dowiadują się
 * niczego o kształcie parametrów.
 */
export async function requireReportSalon(
  request: Request,
): Promise<ReportSalonResult> {
  const params = new URL(request.url).searchParams;
  const requested = params.get("salonId");

  const guard = await requireSalonStaff({
    requestedSalonId: requested,
    feature: REPORTS_FEATURE,
  });
  if (guard.error) return { error: guard.error };

  if (!requested) return badRequest("salonId is required");

  for (const key of ["dateFrom", "dateTo"] as const) {
    const value = params.get(key);
    if (value && isNaN(new Date(value).getTime())) {
      return badRequest(`Nieprawidlowy format daty (${key})`);
    }
  }

  return { salonId: guard.ctx.salonId };
}
