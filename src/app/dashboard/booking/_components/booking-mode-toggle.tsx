"use client";

import { Scissors, Package } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BookingModeToggleProps {
  bookingMode: "service" | "package";
  packagesCount: number;
  onSelectService: () => void;
  onSelectPackage: () => void;
}

export function BookingModeToggle({
  bookingMode,
  packagesCount,
  onSelectService,
  onSelectPackage,
}: BookingModeToggleProps) {
  if (packagesCount === 0) return null;

  return (
    <div className="flex gap-2 mb-6" data-testid="booking-mode-toggle">
      <Button
        variant={bookingMode === "service" ? "default" : "outline"}
        onClick={onSelectService}
        className="flex-1"
      >
        <Scissors className="w-4 h-4 mr-2" />
        Pojedyncza usluga
      </Button>
      <Button
        variant={bookingMode === "package" ? "default" : "outline"}
        onClick={onSelectPackage}
        className="flex-1"
      >
        <Package className="w-4 h-4 mr-2" />
        Pakiet uslug ({packagesCount})
      </Button>
    </div>
  );
}
