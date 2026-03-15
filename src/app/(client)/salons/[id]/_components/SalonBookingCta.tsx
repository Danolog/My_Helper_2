"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface SalonBookingCtaProps {
  salonId: string;
}

export function SalonBookingCta({ salonId }: SalonBookingCtaProps) {
  return (
    <>
      <Separator className="my-6" />
      <div className="text-center">
        <p className="text-muted-foreground mb-4">
          Chcesz zarezerwowac wizyte w tym salonie?
        </p>
        <Button asChild size="lg">
          <Link href={`/salons/${salonId}/book`}>Zarezerwuj wizyte</Link>
        </Button>
      </div>
    </>
  );
}
