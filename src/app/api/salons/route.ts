import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { toErrorIdentity } from "@/lib/safe-error";
import { frozenModuleResponse } from "@/lib/server/frozen-guard";
// GET to publiczny katalog (bez sesji) obejmujący z natury wiele salonów, więc
// nie ma jednego salonu dla forSalon: odczyt idzie przez nazwaną funkcję puli
// systemowej z jawną listą kolumn (bez settingsJson i ownerId).
import { listPublicSalonCatalog } from "@/lib/server/system";

// Revalidate salon list every 60 seconds (ISR)
export const revalidate = 60;

// GET /api/salons - List all salons (filtered to exclude test/incomplete salons)
export async function GET() {
  // Katalog salonów zamrożony (`salonCatalog` w src/lib/features.ts): 404
  // zanim sięgniemy do bazy. Strona salonu czyta `/api/salons/[id]`.
  const frozen = frozenModuleResponse("salonCatalog");
  if (frozen) return frozen;
  try {
    // Salony z adresem, telefonem i branżą (odsiewa salony testowe), z liczbą
    // aktywnych usług i statystyką zatwierdzonych opinii; z usługami najpierw.
    const enrichedSalons = await listPublicSalonCatalog();

    return NextResponse.json({
      success: true,
      data: enrichedSalons,
      count: enrichedSalons.length,
    });
  } catch (error) {
    // Sama tożsamość błędu (nazwa, kod), bez treści i parametrów zapytania.
    logger.error("[Salons API] Database error", { ...toErrorIdentity(error) });
    return NextResponse.json(
      { success: false, error: "Failed to fetch salons" },
      { status: 500 }
    );
  }
}

// POST /api/salons — świadomie brak: trasa bez
// wołającego w src/ i tests/ tworzyła salon BEZ wiersza subskrypcji, co łamie
// niezmiennik „każdy salon ma subskrypcję”. Salon powstaje wyłącznie
// przez POST /api/register-subscription (salon + subskrypcja razem); tutaj
// Next.js odpowiada 405.

// DELETE /api/salons — świadomie brak: trasa bez wołającego w UI
// kasowała dowolny salon po id dla każdego zalogowanego konta, a 26 FK do
// salons.id ma ON DELETE CASCADE (klienci, wizyty, subskrypcje). Usunięcie
// salonu wymaga osobnego przepływu (potwierdzenie, Stripe, RODO, audyt) —
// do tego czasu Next.js odpowiada 405.
