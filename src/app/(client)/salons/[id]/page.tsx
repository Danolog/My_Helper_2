"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSalonData } from "./_hooks/use-salon-data";
import { SalonHeader } from "./_components/SalonHeader";
import { SalonServices } from "./_components/SalonServices";
import { SalonEmployees } from "./_components/SalonEmployees";
import { SalonReviews } from "./_components/SalonReviews";
import { SalonBookingCta } from "./_components/SalonBookingCta";

export default function SalonProfilePage() {
  const {
    salonId,
    salon,
    loading,
    isFavorite,
    favoriteLoading,
    toggleFavorite,
    expandedServices,
    toggleServiceExpanded,
  } = useSalonData();

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12 text-muted-foreground">
          Ladowanie profilu salonu...
        </div>
      </div>
    );
  }

  if (!salon) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold mb-2">Salon nie znaleziony</h2>
          <Button asChild>
            <Link href="/salons">Powrot do listy salonow</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <Button variant="ghost" asChild>
          <Link href="/salons">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Powrot do listy
          </Link>
        </Button>
      </div>

      <SalonHeader
        salon={salon}
        isFavorite={isFavorite}
        favoriteLoading={favoriteLoading}
        onToggleFavorite={toggleFavorite}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Services - takes 2 columns on desktop */}
        <SalonServices
          salon={salon}
          salonId={salonId}
          expandedServices={expandedServices}
          onToggleService={toggleServiceExpanded}
        />

        {/* Employees */}
        <SalonEmployees
          employees={salon.employees}
          salonId={salonId}
        />
      </div>

      <SalonReviews salonId={salonId} />

      <SalonBookingCta salonId={salonId} />
    </div>
  );
}
