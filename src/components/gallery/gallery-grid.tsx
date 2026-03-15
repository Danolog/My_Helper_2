"use client";

import Image from "next/image";
import { Trash2, Image as ImageIcon, Pencil, SlidersHorizontal, Link2, EyeOff, FolderPlus, Loader2, Plus } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { GalleryPhoto } from "./gallery-types";

interface GalleryGridProps {
  photos: GalleryPhoto[];
  loading: boolean;
  filterPairsOnly: boolean;
  onSelectPhoto: (photo: GalleryPhoto) => void;
  onEditPhoto: (photo: GalleryPhoto) => void;
  onDeletePhoto: (photoId: string) => void;
  onLinkPhoto: (photo: GalleryPhoto) => void;
  onAddToAlbum: (photoId: string) => void;
  onOpenUploadDialog: () => void;
}

export function GalleryGrid({
  photos,
  loading,
  filterPairsOnly,
  onSelectPhoto,
  onEditPhoto,
  onDeletePhoto,
  onLinkPhoto,
  onAddToAlbum,
  onOpenUploadDialog,
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
      <EmptyState
        icon={ImageIcon}
        title={filterPairsOnly ? "Brak par przed/po" : "Galeria jest pusta"}
        description={filterPairsOnly
          ? "Dodaj zdjecia przed i po zabiegu, aby utworzyc pary."
          : "Dodaj pierwsze zdjecie do portfolio salonu."}
        action={{
          label: "Dodaj zdjecie",
          icon: Plus,
          onClick: onOpenUploadDialog,
        }}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {photos.map((photo) => {
        const isPair = photo.beforePhotoUrl && photo.afterPhotoUrl;
        const isBeforeOnly = photo.beforePhotoUrl && !photo.afterPhotoUrl;
        const isAfterOnly = !photo.beforePhotoUrl && photo.afterPhotoUrl;

        return (
          <div
            key={photo.id}
            className="group relative border rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all"
            onClick={() => onSelectPhoto(photo)}
          >
            <div className="aspect-square relative">
              {isPair ? (
                /* Show split preview for pairs -- keep raw img for w-[200%] crop trick */
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
              {isBeforeOnly && (
                <div className="absolute top-2 left-2 bg-orange-500 text-white text-xs font-semibold px-2 py-1 rounded">
                  Przed
                </div>
              )}
              {isAfterOnly && (
                <div className="absolute top-2 left-2 bg-green-500 text-white text-xs font-semibold px-2 py-1 rounded">
                  Po
                </div>
              )}
            </div>

            <div className="p-3">
              {photo.employeeFirstName && (
                <p className="text-sm font-medium">
                  {photo.employeeFirstName} {photo.employeeLastName}
                </p>
              )}
              {photo.serviceName && (
                <p className="text-xs text-muted-foreground">{photo.serviceName}</p>
              )}
              {photo.description && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {photo.description}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-muted-foreground">
                  {new Date(photo.createdAt).toLocaleDateString("pl-PL")}
                </p>
                {photo.productsUsed && !photo.showProductsToClients && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded" title="Produkty ukryte przed klientami">
                    <EyeOff className="w-3 h-3" />
                  </span>
                )}
              </div>
            </div>

            {/* Action button overlays */}
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {/* Link button for incomplete pairs */}
              {(isBeforeOnly || isAfterOnly) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onLinkPhoto(photo);
                  }}
                  className="bg-blue-500/80 text-white p-1.5 rounded hover:bg-blue-600/90 transition-colors"
                  title={isBeforeOnly ? "Dodaj zdjecie 'po'" : "Dodaj zdjecie 'przed'"}
                >
                  <Link2 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToAlbum(photo.id);
                }}
                className="bg-purple-500/80 text-white p-1.5 rounded hover:bg-purple-600/90 transition-colors"
                title="Dodaj do albumu"
              >
                <FolderPlus className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEditPhoto(photo);
                }}
                className="bg-blue-500/80 text-white p-1.5 rounded hover:bg-blue-600/90 transition-colors"
                title="Edytuj zdjecie"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeletePhoto(photo.id);
                }}
                className="bg-red-500/80 text-white p-1.5 rounded hover:bg-red-600/90 transition-colors"
                title="Usun zdjecie"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
