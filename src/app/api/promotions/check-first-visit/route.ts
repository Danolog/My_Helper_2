import { NextResponse } from "next/server";

/**
 * GET /api/promotions/check-first-visit
 *
 * The first-visit promotion is frozen (product decision): nobody is eligible.
 *
 * SECURITY: this route is public (the booking portal calls it for guests,
 * without a session). It used to look up the given e-mail in the salon's
 * client records and answered differently for an existing client
 * (`appointmentCount`, "Klient ma juz wizyty…") than for an unknown address —
 * anyone could check whether a person is a client of a salon. It now reads
 * nothing: no query parameters, no database. Every caller gets the same
 * response, byte for byte, in the shape the booking portal already handles
 * (`eligible: false`).
 *
 * The server-side deposit calculation (src/lib/deposit-calculation.ts) does
 * not apply the first-visit discount either, so the amount charged matches
 * the price shown in the portal.
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      eligible: false,
      reason: "Promocja pierwszej wizyty jest obecnie niedostępna",
    },
  });
}
