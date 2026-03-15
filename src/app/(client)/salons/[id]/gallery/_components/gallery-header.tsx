"use client";

import Link from "next/link";
import { ArrowLeft, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GalleryHeaderProps {
  salonId: string;
  salonName: string;
}

export function GalleryHeader({ salonId, salonName }: GalleryHeaderProps) {
  return (
    <>
      <div className="mb-6">
        <Button variant="ghost" asChild>
          <Link href={`/salons/${salonId}`}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Powrot do salonu
          </Link>
        </Button>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ImageIcon className="w-6 h-6" />
          Galeria
        </h1>
        {salonName && (
          <p className="text-muted-foreground mt-1">{salonName}</p>
        )}
      </div>
    </>
  );
}
