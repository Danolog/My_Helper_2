"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { Upload, X, Loader2, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { GalleryPhoto } from "./gallery-types";

interface PhotoLinkDialogProps {
  photo: GalleryPhoto | null;
  onClose: () => void;
  /** Called with the updated photo after a successful link */
  onLinked: (updatedPhoto: GalleryPhoto) => void;
}

/**
 * Uploads a file to the gallery upload endpoint, returning the URL on success.
 */
async function uploadFileToServer(file: File): Promise<string | null> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/gallery/upload", {
    method: "POST",
    body: formData,
  });
  const data = await res.json();
  if (data.success) {
    return data.data.url;
  }
  return null;
}

export function PhotoLinkDialog({
  photo,
  onClose,
  onLinked,
}: PhotoLinkDialogProps) {
  const [linkFile, setLinkFile] = useState<File | null>(null);
  const [linkPreview, setLinkPreview] = useState<string | null>(null);
  const [linkUploading, setLinkUploading] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    setLinkFile(null);
    setLinkPreview(null);
    onClose();
  };

  const handleLinkUpload = async () => {
    if (!photo || !linkFile) return;
    setLinkUploading(true);

    try {
      const url = await uploadFileToServer(linkFile);
      if (!url) {
        toast.error("Nie udalo sie przeslac zdjecia. Sprobuj ponownie.");
        return;
      }

      // Determine which field to update
      const isAddingBefore = !photo.beforePhotoUrl;
      const updatePayload = isAddingBefore
        ? { beforePhotoUrl: url }
        : { afterPhotoUrl: url };

      const res = await fetch(`/api/gallery/${photo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatePayload),
      });

      const data = await res.json();
      if (data.success) {
        onLinked(data.data);
        setLinkFile(null);
        setLinkPreview(null);
      } else {
        toast.error("Nie udalo sie polaczyc zdjec. Sprobuj ponownie.");
      }
    } catch {
      toast.error("Nie udalo sie polaczyc zdjec. Sprawdz polaczenie i sprobuj ponownie.");
    } finally {
      setLinkUploading(false);
    }
  };

  if (!photo) return null;

  return (
    <Dialog open={!!photo} onOpenChange={() => handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {photo.beforePhotoUrl && !photo.afterPhotoUrl
              ? "Dodaj zdjecie PO zabiegu"
              : "Dodaj zdjecie PRZED zabiegiem"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          {/* Show existing photo */}
          <div>
            <Label className="mb-2 block text-sm text-muted-foreground">
              Istniejace zdjecie ({photo.beforePhotoUrl ? "przed" : "po"}):
            </Label>
            <div className="relative h-40 rounded-lg border overflow-hidden">
              <Image
                src={photo.beforePhotoUrl || photo.afterPhotoUrl || ""}
                alt="Istniejace zdjecie"
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 448px"
              />
              <div className={`absolute top-2 left-2 text-white text-xs font-semibold px-2 py-1 rounded ${
                photo.beforePhotoUrl ? "bg-orange-500" : "bg-green-500"
              }`}>
                {photo.beforePhotoUrl ? "PRZED" : "PO"}
              </div>
            </div>
          </div>

          {/* Upload matching photo */}
          <div>
            <Label className="mb-2 block">
              {photo.beforePhotoUrl && !photo.afterPhotoUrl
                ? "Zdjecie PO zabiegu"
                : "Zdjecie PRZED zabiegiem"}
              <span className="text-red-500 ml-1">*</span>
            </Label>
            <input
              ref={linkInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setLinkFile(file);
                  const reader = new FileReader();
                  reader.onload = () => setLinkPreview(reader.result as string);
                  reader.readAsDataURL(file);
                }
              }}
              className="hidden"
            />
            {linkPreview ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- data URI from FileReader */}
                <img
                  src={linkPreview}
                  alt="Nowe zdjecie"
                  className="w-full h-40 object-cover rounded-lg border"
                />
                <div className={`absolute top-2 left-2 text-white text-xs font-semibold px-2 py-1 rounded ${
                  photo.beforePhotoUrl ? "bg-green-500" : "bg-orange-500"
                }`}>
                  {photo.beforePhotoUrl ? "PO" : "PRZED"}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2"
                  onClick={() => { setLinkFile(null); setLinkPreview(null); }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => linkInputRef.current?.click()}
                className={`w-full h-40 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 transition-colors ${
                  photo.beforePhotoUrl
                    ? "border-green-300 hover:border-green-500 bg-green-50/50"
                    : "border-orange-300 hover:border-orange-500 bg-orange-50/50"
                }`}
              >
                <Upload className={`w-6 h-6 ${photo.beforePhotoUrl ? "text-green-400" : "text-orange-400"}`} />
                <span className={`text-sm font-medium ${photo.beforePhotoUrl ? "text-green-600" : "text-orange-600"}`}>
                  {photo.beforePhotoUrl ? "Zdjecie PO" : "Zdjecie PRZED"}
                </span>
                <span className="text-xs text-muted-foreground">
                  JPEG, PNG, WebP, GIF (max 10MB)
                </span>
              </button>
            )}
          </div>

          {/* Pair preview */}
          {linkPreview && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Link2 className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-700">Podglad pary</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- may be data URI from FileReader */}
                  <img
                    src={photo.beforePhotoUrl || linkPreview}
                    alt="Przed"
                    className="w-full h-20 object-cover rounded border"
                  />
                  <span className="absolute bottom-1 left-1 bg-orange-500 text-white text-[10px] px-1 rounded">PRZED</span>
                </div>
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- may be data URI from FileReader */}
                  <img
                    src={photo.beforePhotoUrl ? linkPreview : (photo.afterPhotoUrl || "")}
                    alt="Po"
                    className="w-full h-20 object-cover rounded border"
                  />
                  <span className="absolute bottom-1 left-1 bg-green-500 text-white text-[10px] px-1 rounded">PO</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleClose}>
              Anuluj
            </Button>
            <Button onClick={handleLinkUpload} disabled={!linkFile || linkUploading}>
              {linkUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Laczenie...
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4 mr-2" />
                  Polacz zdjecia
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
