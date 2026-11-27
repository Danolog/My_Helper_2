"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { isModuleFrozen } from "@/lib/features";

export function BookingNotFound() {
  return (
    <div className="container mx-auto p-6">
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold mb-2">Salon nie znaleziony</h2>
        {/* Lista salonów zamrożona (`salonCatalog`) — bez linku powrotu do niej. */}
        {!isModuleFrozen("salonCatalog") && (
          <Button asChild>
            <Link href="/salons">Powrot do listy salonow</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
