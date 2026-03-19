"use client";

import { useState, useCallback } from "react";
import { ImageIcon, Sparkles, Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ────────────────────────────────────────────────────────────
// Style options (Polish labels matching the image-generator component)
// ────────────────────────────────────────────────────────────

const STYLE_OPTIONS = [
  { value: "modern", label: "Nowoczesny" },
  { value: "vintage", label: "Vintage" },
  { value: "minimal", label: "Minimalistyczny" },
  { value: "luxurious", label: "Luksusowy" },
  { value: "natural", label: "Naturalny" },
  { value: "vibrant", label: "Kolorowy" },
] as const;

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface GenerateResponse {
  success?: boolean;
  imageUrl?: string;
  prompt?: string;
  error?: string;
  code?: string;
}

interface ServiceIllustrationButtonProps {
  /** Name of the service (used to generate the illustration prompt) */
  serviceName: string;
  /** Optional category name for more context-aware generation */
  categoryName?: string;
  /** Called when the user accepts a generated illustration */
  onGenerated?: (imageUrl: string) => void;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "icon";
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export function ServiceIllustrationButton({
  serviceName,
  categoryName,
  onGenerated,
  variant = "outline",
  size = "sm",
}: ServiceIllustrationButtonProps) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState("modern");
  const [generating, setGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setPreviewUrl(null);

    try {
      const res = await fetch("/api/ai/image/service-illustration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceName, categoryName, style }),
      });

      const data: GenerateResponse = await res.json();

      if (data.success && data.imageUrl) {
        setPreviewUrl(data.imageUrl);
        toast.success("Ilustracja wygenerowana!");
      } else if (data.code === "PLAN_UPGRADE_REQUIRED") {
        toast.error("Generowanie ilustracji dostepne tylko w Planie Pro");
      } else {
        toast.error(data.error ?? "Nie udalo sie wygenerowac ilustracji");
      }
    } catch {
      toast.error("Blad podczas generowania ilustracji");
    } finally {
      setGenerating(false);
    }
  }, [serviceName, categoryName, style]);

  const handleAccept = useCallback(() => {
    if (previewUrl) {
      onGenerated?.(previewUrl);
      setOpen(false);
      setPreviewUrl(null);
    }
  }, [previewUrl, onGenerated]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      // Reset preview when closing the dialog
      if (!nextOpen) {
        setPreviewUrl(null);
      }
    },
    [],
  );

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <Sparkles className="h-4 w-4 mr-1" />
        Generuj ilustracje
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Generuj ilustracje uslugi
            </DialogTitle>
            <DialogDescription>
              AI wygeneruje ilustracje dla &ldquo;{serviceName}&rdquo;
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Style selector */}
            <div className="space-y-2">
              <Label>Styl</Label>
              <Select value={style} onValueChange={setStyle}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STYLE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Preview area */}
            {previewUrl ? (
              <div className="rounded-lg border overflow-hidden bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt={`Ilustracja uslugi: ${serviceName}`}
                  className="w-full h-auto"
                />
              </div>
            ) : (
              <div className="rounded-lg border bg-muted flex items-center justify-center py-16">
                <ImageIcon className="h-12 w-12 text-muted-foreground/30" />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Anuluj
            </Button>
            {previewUrl ? (
              <>
                <Button
                  variant="outline"
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  {generating && (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  )}
                  Regeneruj
                </Button>
                <Button onClick={handleAccept}>Zastosuj</Button>
              </>
            ) : (
              <Button onClick={handleGenerate} disabled={generating}>
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generowanie...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generuj
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
