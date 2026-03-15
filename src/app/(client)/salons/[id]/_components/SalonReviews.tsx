"use client";

import Link from "next/link";
import { Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface SalonReviewsProps {
  salonId: string;
}

export function SalonReviews({ salonId }: SalonReviewsProps) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ImageIcon className="w-5 h-5" />
            Galeria
          </CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/salons/${salonId}/gallery`} data-testid="gallery-link">
              Zobacz pelna galerie
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Przegladaj portfolio zdjec salonu - efekty zabiegow, metamorfozy przed i po.
        </p>
      </CardContent>
    </Card>
  );
}
