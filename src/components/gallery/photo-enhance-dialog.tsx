"use client";

import { useState } from "react";
import Image from "next/image";
import { Sparkles, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { mutationFetch } from "@/lib/api-client";
import type { GalleryPhoto } from "./gallery-types";

/**
 * Available enhancement presets with user-facing labels and descriptions.
 */
const PRESET_OPTIONS = [
  { value: "auto", label: "Automatyczny", description: "Jasnosc, kontrast, ostrosc" },
  { value: "brighten", label: "Rozjasnij", description: "Zwieksz jasnosc i gamma" },
  { value: "sharpen", label: "Wyostrz", description: "Zwieksz ostrosc detali" },
  { value: "warm", label: "Cieple tony", description: "Cieple, przytulne odcienie" },
  { value: "cool", label: "Chlodne tony", description: "Chlodne, swieze odcienie" },
  { value: "vibrant", label: "Zywe kolory", description: "Intensywne, nasycone kolory" },
  { value: "bw", label: "Czarno-bialy", description: "Klasyczny monochromatyczny" },
] as const;

interface PhotoEnhanceDialogProps {
  photo: GalleryPhoto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnhanced?: (enhancedUrl: string) => void;
}

export function PhotoEnhanceDialog({
  photo,
  open,
  onOpenChange,
  onEnhanced,
}: PhotoEnhanceDialogProps) {
  const [preset, setPreset] = useState("auto");
  const [enhancing, setEnhancing] = useState(false);
  const [enhancedUrl, setEnhancedUrl] = useState<string | null>(null);

  /**
   * Determine the primary display URL for the photo.
   * Prefers the "after" photo if available, falls back to "before".
   */
  const photoUrl = photo?.afterPhotoUrl ?? photo?.beforePhotoUrl ?? "";

  const handleEnhance = async () => {
    if (!photoUrl) return;

    setEnhancing(true);
    setEnhancedUrl(null);

    try {
      const res = await mutationFetch("/api/ai/image/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: photoUrl, preset }),
      });

      const data = await res.json();

      if (data.success) {
        setEnhancedUrl(data.enhancedUrl);
        toast.success("Zdjecie ulepszone!");
      } else {
        toast.error(data.error || "Nie udalo sie ulepszyc zdjecia");
      }
    } catch {
      toast.error("Blad podczas ulepszania zdjecia");
    } finally {
      setEnhancing(false);
    }
  };

  const handleAccept = () => {
    if (enhancedUrl) {
      onEnhanced?.(enhancedUrl);
      handleClose();
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset state after closing so next open starts fresh
    setEnhancedUrl(null);
    setPreset("auto");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Ulepsz zdjecie
          </DialogTitle>
          <DialogDescription>
            Wybierz preset i porownaj oryginalne zdjecie z ulepszonym
          </DialogDescription>
        </DialogHeader>

        {photo && (
          <div className="space-y-4 mt-4">
            {/* Preset selector */}
            <div className="flex flex-wrap gap-2">
              {PRESET_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => {
                    setPreset(p.value);
                    setEnhancedUrl(null);
                  }}
                  className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                    preset === p.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-muted hover:border-primary/50"
                  }`}
                >
                  <span className="font-medium">{p.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {p.description}
                  </span>
                </button>
              ))}
            </div>

            {/* Side-by-side comparison */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium mb-2">Oryginal</p>
                <div className="rounded-lg border overflow-hidden bg-muted relative aspect-[3/4]">
                  <Image
                    src={photoUrl}
                    alt="Oryginal"
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 45vw, 30vw"
                  />
                </div>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">
                  {enhancedUrl ? "Ulepszone" : "Podglad"}
                </p>
                <div className="rounded-lg border overflow-hidden bg-muted relative aspect-[3/4]">
                  {enhancedUrl ? (
                    <Image
                      src={enhancedUrl}
                      alt="Ulepszone"
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 45vw, 30vw"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                      <Sparkles className="h-8 w-8" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer actions */}
            <DialogFooter className="flex gap-2">
              <Button variant="outline" onClick={handleClose}>
                Anuluj
              </Button>
              {!enhancedUrl ? (
                <Button onClick={handleEnhance} disabled={enhancing}>
                  {enhancing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Ulepszanie...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Ulepsz
                    </>
                  )}
                </Button>
              ) : (
                <Button onClick={handleAccept}>
                  <Check className="h-4 w-4 mr-2" />
                  Zastosuj
                </Button>
              )}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
