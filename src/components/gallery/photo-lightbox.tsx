"use client";

import { useState } from "react";
import Image from "next/image";
import { Trash2, Pencil, SlidersHorizontal, Link2, Eye, EyeOff, FolderPlus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ComparisonSlider } from "./comparison-slider";
import type { GalleryPhoto } from "./gallery-types";

interface PhotoLightboxProps {
  photo: GalleryPhoto | null;
  onClose: () => void;
  onEdit: (photo: GalleryPhoto) => void;
  onDelete: (photoId: string) => void;
  onLink: (photo: GalleryPhoto) => void;
  onAddToAlbum: (photoId: string) => void;
  onGenerateCaption: (photo: GalleryPhoto) => void;
}

export function PhotoLightbox({
  photo,
  onClose,
  onEdit,
  onDelete,
  onLink,
  onAddToAlbum,
  onGenerateCaption,
}: PhotoLightboxProps) {
  const [comparisonMode, setComparisonMode] = useState<"slider" | "side-by-side">("slider");

  if (!photo) return null;

  return (
    <Dialog open={!!photo} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] p-0">
        <div className="overflow-y-auto max-h-[calc(90vh-4rem)] p-6">
        <DialogHeader>
          <DialogTitle>
            {photo.description || "Zdjecie galerii"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          {/* Before/After comparison */}
          {photo.beforePhotoUrl && photo.afterPhotoUrl ? (
            <div>
              {/* Comparison mode toggle */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-medium">Widok porownania:</span>
                <Button
                  variant={comparisonMode === "slider" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setComparisonMode("slider")}
                >
                  <SlidersHorizontal className="w-4 h-4 mr-1" />
                  Suwak
                </Button>
                <Button
                  variant={comparisonMode === "side-by-side" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setComparisonMode("side-by-side")}
                >
                  Obok siebie
                </Button>
              </div>

              {comparisonMode === "slider" ? (
                <ComparisonSlider
                  beforeUrl={photo.beforePhotoUrl}
                  afterUrl={photo.afterPhotoUrl}
                />
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium mb-2 text-center bg-orange-100 text-orange-700 rounded py-1">Przed</p>
                    <div className="relative aspect-[3/4]">
                      <Image
                        src={photo.beforePhotoUrl}
                        alt="Przed"
                        fill
                        className="rounded-lg object-cover"
                        sizes="(max-width: 768px) 45vw, 30vw"
                      />
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2 text-center bg-green-100 text-green-700 rounded py-1">Po</p>
                    <div className="relative aspect-[3/4]">
                      <Image
                        src={photo.afterPhotoUrl}
                        alt="Po"
                        fill
                        className="rounded-lg object-cover"
                        sizes="(max-width: 768px) 45vw, 30vw"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              {/* Single photo with option to add matching */}
              <div className="relative w-full" style={{ height: "50vh" }}>
                <Image
                  src={photo.afterPhotoUrl || photo.beforePhotoUrl || ""}
                  alt={photo.description || "Zdjecie"}
                  fill
                  className="object-contain rounded-lg"
                  sizes="(max-width: 768px) 100vw, 60vw"
                />
              </div>
              {/* Show badge for single photos */}
              {photo.beforePhotoUrl && !photo.afterPhotoUrl && (
                <div className="mt-2 p-3 bg-orange-50 border border-orange-200 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="bg-orange-500 text-white text-xs font-semibold px-2 py-1 rounded">PRZED</span>
                    <span className="text-sm text-orange-700">Brak zdjecia &quot;po&quot; - dodaj aby utworzyc pare</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onLink(photo)}
                  >
                    <Link2 className="w-4 h-4 mr-1" />
                    Dodaj &quot;po&quot;
                  </Button>
                </div>
              )}
              {!photo.beforePhotoUrl && photo.afterPhotoUrl && (
                <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="bg-green-500 text-white text-xs font-semibold px-2 py-1 rounded">PO</span>
                    <span className="text-sm text-green-700">Brak zdjecia &quot;przed&quot; - dodaj aby utworzyc pare</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onLink(photo)}
                  >
                    <Link2 className="w-4 h-4 mr-1" />
                    Dodaj &quot;przed&quot;
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            {photo.employeeFirstName && (
              <p className="text-sm">
                <span className="font-medium">Pracownik:</span>{" "}
                {photo.employeeFirstName} {photo.employeeLastName}
              </p>
            )}
            {photo.serviceName && (
              <p className="text-sm">
                <span className="font-medium">Usluga:</span> {photo.serviceName}
              </p>
            )}
            {photo.techniques && (
              <p className="text-sm">
                <span className="font-medium">Techniki:</span> {photo.techniques}
              </p>
            )}
            {photo.productsUsed && (
              <div className="text-sm">
                <span className="font-medium">Produkty:</span> {photo.productsUsed}
                <span className="ml-2 inline-flex items-center gap-1 text-xs">
                  {photo.showProductsToClients ? (
                    <span className="text-green-600 flex items-center gap-1">
                      <Eye className="w-3 h-3" /> widoczne dla klientow
                    </span>
                  ) : (
                    <span className="text-muted-foreground flex items-center gap-1">
                      <EyeOff className="w-3 h-3" /> ukryte przed klientami
                    </span>
                  )}
                </span>
              </div>
            )}
            {photo.duration && (
              <p className="text-sm">
                <span className="font-medium">Czas trwania:</span> {photo.duration} min
              </p>
            )}
            {photo.description && (
              <p className="text-sm">
                <span className="font-medium">Opis:</span> {photo.description}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Dodano: {new Date(photo.createdAt).toLocaleDateString("pl-PL", {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onGenerateCaption(photo)}
              className="text-purple-600 border-purple-200 hover:bg-purple-50"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Generuj post
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onAddToAlbum(photo.id)}
            >
              <FolderPlus className="w-4 h-4 mr-2" />
              Do albumu
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(photo)}
            >
              <Pencil className="w-4 h-4 mr-2" />
              Edytuj
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onDelete(photo.id)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Usun zdjecie
            </Button>
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
