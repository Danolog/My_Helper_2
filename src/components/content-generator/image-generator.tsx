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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { mutationFetch } from "@/lib/api-client";

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
  { value: "tiktok", label: "TikTok (9:16)" },
] as const;

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface GeneratedImage {
  url: string;
  prompt: string;
}

interface GenerateResponse {
  success?: boolean;
  imageUrl?: string;
  prompt?: string;
  error?: string;
  code?: string;
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export function ImageGenerator() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("modern");
  const [size, setSize] = useState("instagram-square");
  const [autoPrompt, setAutoPrompt] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<GeneratedImage | null>(
    null,
  );

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      toast.error("Wpisz opis obrazu");
      return;
    }

    setGenerating(true);
    try {
      const res = await mutationFetch("/api/ai/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, style, size, autoPrompt }),
      });

      const data: GenerateResponse = await res.json();

      if (data.success && data.imageUrl) {
        setGeneratedImage({ url: data.imageUrl, prompt: data.prompt ?? prompt });
        toast.success("Obraz wygenerowany!");
      } else if (data.code === "PLAN_UPGRADE_REQUIRED") {
        toast.error("Generowanie obrazow dostepne tylko w Planie Pro");
      } else {
        toast.error(data.error ?? "Nie udalo sie wygenerowac obrazu");
      }
    } catch {
      toast.error("Blad podczas generowania obrazu");
    } finally {
      setGenerating(false);
    }
  }, [prompt, style, size, autoPrompt]);

  const handleDownload = useCallback(() => {
    if (!generatedImage) return;
    const link = document.createElement("a");
    link.href = generatedImage.url;
    link.download = `salon-image-${Date.now()}.png`;
    link.click();
  }, [generatedImage]);

  const handleCopyUrl = useCallback(() => {
    if (!generatedImage) return;
    navigator.clipboard.writeText(generatedImage.url).then(
      () => toast.success("URL skopiowany"),
      () => toast.error("Nie udalo sie skopiowac URL"),
    );
  }, [generatedImage]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Configuration card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Generuj grafike AI
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Prompt */}
          <div className="space-y-2">
            <Label htmlFor="image-prompt">Opis obrazu</Label>
            <Textarea
              id="image-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="np. Elegancki salon fryzjerski z nowoczesnymi fotelami i cieplym oswietleniem"
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground text-right">
              {prompt.length}/500
            </p>
          </div>

          {/* Auto-prompt toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id="auto-prompt"
              checked={autoPrompt}
              onCheckedChange={setAutoPrompt}
            />
            <Label htmlFor="auto-prompt">
              Auto-optymalizacja promptu (AI)
            </Label>
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

          {/* Generate button */}
          <Button
            onClick={handleGenerate}
            disabled={generating || !prompt.trim()}
            className="w-full"
            size="lg"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generowanie...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generuj obraz
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
          {generatedImage ? (
            <div className="space-y-4">
              <div className="rounded-lg border overflow-hidden bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={generatedImage.url}
                  alt="Wygenerowany obraz"
                  className="w-full h-auto"
                />
              </div>

              {generatedImage.prompt && (
                <p className="text-xs text-muted-foreground">
                  Prompt: {generatedImage.prompt}
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
                Wygeneruj obraz aby zobaczyc podglad
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
