"use client";

import Image from "next/image";
import {
  Image as ImageIcon,
  Loader2,
  SlidersHorizontal,
  Maximize2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GalleryPhoto } from "../_hooks/use-gallery-data";

interface GalleryGridProps {
  photos: GalleryPhoto[];
  loading: boolean;
  hasActiveFilters: boolean;
  onPhotoSelect: (photo: GalleryPhoto) => void;
  onClearFilters: () => void;
}

export function GalleryGrid({
  photos,
  loading,
  hasActiveFilters,
  onPhotoSelect,
  onClearFilters,
}: GalleryGridProps) {
  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <ImageIcon className="w-16 h-16 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold mb-2">
          {hasActiveFilters
            ? "Brak zdjec dla wybranych filtrow"
            : "Galeria jest pusta"}
        </h2>
        <p className="text-muted-foreground">
          {hasActiveFilters
            ? "Sprobuj inne kryteria wyszukiwania"
            : "Ten salon nie dodal jeszcze zdjec do galerii"}
        </p>
        {hasActiveFilters && (
          <Button
            variant="outline"
            className="mt-4"
            onClick={onClearFilters}
          >
            Wyczysc filtry
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
      data-testid="gallery-grid"
    >
      {photos.map((photo) => {
        const isPair = photo.beforePhotoUrl && photo.afterPhotoUrl;

        return (
          <div
            key={photo.id}
            className="group relative border rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all hover:shadow-lg"
            onClick={() => onPhotoSelect(photo)}
            data-testid={`gallery-photo-${photo.id}`}
          >
            <div className="aspect-square relative">
              {isPair ? (
                /* Split preview for before/after pairs -- raw img for w-[200%] crop trick */
                <div className="w-full h-full flex">
                  <div className="w-1/2 h-full relative overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.beforePhotoUrl!}
                      alt="Przed"
                      className="absolute inset-0 w-[200%] h-full object-cover"
                    />
                  </div>
                  <div className="w-0.5 bg-white z-10 relative" />
                  <div className="w-1/2 h-full relative overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.afterPhotoUrl!}
                      alt="Po"
                      className="absolute inset-0 w-[200%] h-full object-cover object-right"
                    />
                  </div>
                </div>
              ) : photo.afterPhotoUrl ? (
                <Image
                  src={photo.afterPhotoUrl}
                  alt={photo.description || "Zdjecie galerii"}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                />
              ) : photo.beforePhotoUrl ? (
                <Image
                  src={photo.beforePhotoUrl}
                  alt={photo.description || "Zdjecie galerii"}
                  fill
                  className="object-cover"
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-muted">
                  <ImageIcon className="w-12 h-12 text-muted-foreground" />
                </div>
              )}

              {/* Badges */}
              {isPair && (
                <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1">
                  <SlidersHorizontal className="w-3 h-3" />
                  Przed / Po
                </div>
              )}

              {/* Hover overlay with zoom icon */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <Maximize2 className="w-8 h-8 text-white drop-shadow-lg" />
                </div>
              </div>
            </div>

            <div className="p-3">
              {photo.employeeFirstName && (
                <p className="text-sm font-medium">
                  {photo.employeeFirstName} {photo.employeeLastName}
                </p>
              )}
              {photo.serviceName && (
                <Badge variant="secondary" className="text-xs mt-1">
                  {photo.serviceName}
                </Badge>
              )}
              {photo.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {photo.description}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
