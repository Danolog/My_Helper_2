"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { GalleryPhoto } from "../_types";

interface GalleryPhotosCardProps {
  galleryPhotos: GalleryPhoto[];
}

export function GalleryPhotosCard({ galleryPhotos }: GalleryPhotosCardProps) {
  return (
    <Card className="mt-6" data-testid="service-gallery-section">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Galeria zdjec</CardTitle>
          <Badge variant="outline" data-testid="gallery-photos-count">
            {galleryPhotos.length}
          </Badge>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link href={`/dashboard/gallery`}>
            <ImageIcon className="h-4 w-4 mr-2" />
            Otworz galerie
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {galleryPhotos.length === 0 ? (
          <div className="text-center py-8">
            <ImageIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p
              className="text-muted-foreground mb-2"
              data-testid="no-gallery-photos-message"
            >
              Brak zdjec powiazanych z ta usluga.
            </p>
            <p className="text-xs text-muted-foreground">
              Dodaj zdjecia w galerii i oznacz je ta usluga, aby sie tutaj
              pojawily.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {galleryPhotos.map((photo) => (
              <div
                key={photo.id}
                className="relative group border rounded-lg overflow-hidden"
                data-testid={`service-gallery-photo-${photo.id}`}
              >
                <div className="aspect-square relative">
                  {photo.afterPhotoUrl ? (
                    <Image
                      src={photo.afterPhotoUrl}
                      alt={photo.description || "Zdjecie uslugi"}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    />
                  ) : photo.beforePhotoUrl ? (
                    <Image
                      src={photo.beforePhotoUrl}
                      alt={photo.description || "Zdjecie uslugi"}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-muted">
                      <ImageIcon className="w-8 h-8 text-muted-foreground" />
                    </div>
                  )}
                  {/* Before/After badge */}
                  {photo.beforePhotoUrl && photo.afterPhotoUrl && (
                    <div className="absolute top-1 left-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                      Przed / Po
                    </div>
                  )}
                </div>
                <div className="p-2">
                  {photo.employeeFirstName && (
                    <p className="text-xs font-medium truncate">
                      {photo.employeeFirstName} {photo.employeeLastName}
                    </p>
                  )}
                  {photo.description && (
                    <p className="text-xs text-muted-foreground truncate">
                      {photo.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
