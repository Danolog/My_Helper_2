"use client";

import { useState, useCallback } from "react";
import {
  ImageIcon,
  Sparkles,
  Download,
  RefreshCw,
  Loader2,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ────────────────────────────────────────────────────────────
// Option constants
// ────────────────────────────────────────────────────────────

const STYLE_OPTIONS = [
  { value: "modern", label: "Nowoczesny" },
  { value: "vintage", label: "Vintage" },
  { value: "minimal", label: "Minimalistyczny" },
  { value: "luxurious", label: "Luksusowy" },
  { value: "natural", label: "Naturalny" },
  { value: "vibrant", label: "Kolorowy" },
] as const;

const SIZE_OPTIONS = [
  { value: "instagram-square", label: "Instagram Post (1:1)" },
  { value: "instagram-story", label: "Instagram Story (9:16)" },
  { value: "facebook-post", label: "Facebook Post (16:9)" },
  { value: "facebook-cover", label: "Facebook Cover (16:9)" },
] as const;

const OVERLAY_OPTIONS = [
  { value: "dark", label: "Ciemny" },
  { value: "light", label: "Jasny" },
  { value: "primary", label: "Kolorowy (fioletowy)" },
] as const;

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface GeneratedBanner {
  url: string;
  prompt: string;
}

interface BannerResponse {
  success?: boolean;
  bannerUrl?: string;
  prompt?: string;
  error?: string;
  code?: string;
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export function BannerGenerator() {
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [style, setStyle] = useState("modern");
  const [size, setSize] = useState("instagram-square");
  const [overlayColor, setOverlayColor] = useState("dark");
  const [generating, setGenerating] = useState(false);
  const [banner, setBanner] = useState<GeneratedBanner | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!title.trim()) {
      toast.error("Wpisz tytul promocji");
      return;
    }

    setGenerating(true);
    try {
      const res = await fetch("/api/ai/image/banner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          subtitle: subtitle || undefined,
          style,
          size,
          overlayColor,
        }),
      });

      const data: BannerResponse = await res.json();

      if (data.success && data.bannerUrl) {
        setBanner({ url: data.bannerUrl, prompt: data.prompt ?? title });
        toast.success("Baner wygenerowany!");
      } else if (data.code === "PLAN_UPGRADE_REQUIRED") {
        toast.error("Generowanie banerow dostepne tylko w Planie Pro");
      } else {
        toast.error(data.error ?? "Nie udalo sie wygenerowac baneru");
      }
    } catch {
      toast.error("Blad podczas generowania baneru");
    } finally {
      setGenerating(false);
    }
  }, [title, subtitle, style, size, overlayColor]);

  const handleDownload = useCallback(() => {
    if (!banner) return;
    const link = document.createElement("a");
    link.href = banner.url;
    link.download = `banner-${Date.now()}.jpg`;
    link.click();
  }, [banner]);

  const handleCopyUrl = useCallback(() => {
    if (!banner) return;
    navigator.clipboard.writeText(banner.url).then(
      () => toast.success("URL skopiowany"),
      () => toast.error("Nie udalo sie skopiowac URL"),
    );
  }, [banner]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Configuration card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Generator baneru promocyjnego
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="banner-title">Tytul promocji</Label>
            <Input
              id="banner-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="np. Wiosenna Promocja"
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground text-right">
              {title.length}/100
            </p>
          </div>

          {/* Subtitle */}
          <div className="space-y-2">
            <Label htmlFor="banner-subtitle">
              Podtytul{" "}
              <span className="text-muted-foreground font-normal">
                (opcjonalny)
              </span>
            </Label>
            <Input
              id="banner-subtitle"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="np. -20% na wszystkie uslugi"
              maxLength={200}
            />
          </div>

          {/* Style & Size selectors */}
          <div className="grid grid-cols-2 gap-3">
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

            <div className="space-y-2">
              <Label>Rozmiar</Label>
              <Select value={size} onValueChange={setSize}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIZE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Overlay colour */}
          <div className="space-y-2">
            <Label>Kolor nakladki tekstu</Label>
            <Select value={overlayColor} onValueChange={setOverlayColor}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OVERLAY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Generate button */}
          <Button
            onClick={handleGenerate}
            disabled={generating || !title.trim()}
            className="w-full"
            size="lg"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generowanie baneru...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generuj baner
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Preview card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            Podglad
          </CardTitle>
        </CardHeader>
        <CardContent>
          {banner ? (
            <div className="space-y-4">
              <div className="rounded-lg border overflow-hidden bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={banner.url}
                  alt="Wygenerowany baner promocyjny"
                  className="w-full h-auto"
                />
              </div>

              {banner.prompt && (
                <p className="text-xs text-muted-foreground">
                  Prompt tla: {banner.prompt}
                </p>
              )}

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-1" />
                  Pobierz
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Regeneruj
                </Button>
                <Button variant="outline" size="sm" onClick={handleCopyUrl}>
                  <Copy className="h-4 w-4 mr-1" />
                  URL
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ImageIcon className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground">
                Wygeneruj baner aby zobaczyc podglad
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
