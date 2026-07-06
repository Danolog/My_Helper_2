"use client";

import Link from "next/link";
import { EyeOff, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SalonProfileBannerProps {
  /** Salon z /api/salons/mine; null dopoki sie laduje / brak salonu */
  salon: { address: string | null; phone: string | null } | null;
}

/**
 * Portal klienta (/api/salons) pokazuje tylko salony z adresem i telefonem.
 * Swiezo zarejestrowany salon nie ma zadnego z tych pol, wiec bez tego
 * banera wlasciciel nie wie, czemu klienci go nie widza (UAT B-7).
 */
export function SalonProfileBanner({ salon }: SalonProfileBannerProps) {
  if (!salon || (salon.address && salon.phone)) return null;

  return (
    <div
      className="flex items-center gap-3 p-4 rounded-lg border mb-6 bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800"
      data-testid="salon-profile-banner"
    >
      <EyeOff className="h-5 w-5 text-amber-600 shrink-0" />
      <div className="flex-1">
        <p className="font-medium text-sm">
          Twój salon jest niewidoczny dla klientów
        </p>
        <p className="text-sm text-muted-foreground">
          Uzupełnij adres i telefon, aby salon pojawił się w portalu klienta i
          przyjmował rezerwacje online.
        </p>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link href="/dashboard/settings/salon">
          Uzupełnij dane salonu
          <ArrowRight className="h-4 w-4 ml-1" />
        </Link>
      </Button>
    </div>
  );
}
