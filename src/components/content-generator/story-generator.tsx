"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Smartphone,
  Sparkles,
  Download,
  Loader2,
  Copy,
  ImageIcon,
  Tag,
  Star,
  Scissors,
  Camera,
  Snowflake,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { mutationFetch } from "@/lib/api-client";

// ────────────────────────────────────────────────────────────
// Option constants
// ────────────────────────────────────────────────────────────

const TEMPLATE_OPTIONS = [
  {
    value: "promotion",
    label: "Promocja",
    description: "Oferta specjalna lub rabat",
    icon: Tag,
  },
  {
    value: "new_service",
    label: "Nowa usluga",
    description: "Elegancka prezentacja nowosci",
    icon: Star,
  },
  {
    value: "transformation",
    label: "Metamorfoza",
    description: "Efektowne przed/po",
    icon: Scissors,
  },
  {
    value: "behind_scenes",
    label: "Za kulisami",
    description: "Autentyczne zycie salonu",
    icon: Camera,
  },
  {
    value: "seasonal",
    label: "Sezonowe",
    description: "Swiateczne lub okolicznosciowe",
    icon: Snowflake,
  },
] as const;

const DURATION_OPTIONS = [
  { value: "4", label: "4 sekundy" },
  { value: "6", label: "6 sekund" },
  { value: "8", label: "8 sekund" },
] as const;

/** Polling interval in milliseconds — 5 seconds between each status check */
const POLL_INTERVAL_MS = 5_000;

/** Maximum number of polls before giving up (5 min at 5s intervals) */
const MAX_POLL_ATTEMPTS = 60;

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

type TemplateValue = (typeof TEMPLATE_OPTIONS)[number]["value"];

type GenerationStatus =
  | "idle"
  | "starting"
  | "processing"
  | "completed"
  | "failed";

interface GenerateResponse {
  success?: boolean;
  taskId?: string;
  status?: string;
  template?: string;
  error?: string;
  code?: string;
}

interface StatusResponse {
  success?: boolean;
  status?: string;
  videoUrl?: string;
  error?: string;
}

interface GalleryPhoto {
  id: string;
  afterPhotoUrl: string | null;
  beforePhotoUrl: string | null;
  description: string | null;
  serviceName: string | null;
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export function StoryGenerator() {
  const [prompt, setPrompt] = useState("");
  const [template, setTemplate] = useState<TemplateValue>("promotion");
  const [duration, setDuration] = useState("6");
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);

  // Gallery photo picker state
  const [galleryPhotos, setGalleryPhotos] = useState<GalleryPhoto[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryLoaded, setGalleryLoaded] = useState(false);

  // Generation state
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Track poll count to enforce a ceiling and prevent runaway polling
  const pollCountRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Cleanup polling on unmount ──────────────────────────
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // ── Fetch gallery photos on demand ──────────────────────
  const loadGalleryPhotos = useCallback(async () => {
    if (galleryLoaded || galleryLoading) return;

    setGalleryLoading(true);
    try {
      // Fetch the salon's gallery photos; the API requires salonId as a query param.
      // We make a dedicated call to a lightweight endpoint for the photo picker.
      const res = await fetch("/api/ai/video/story/photos");
      if (!res.ok) {
        throw new Error("Failed to fetch gallery photos");
      }
      const data = await res.json();
      if (data.success && Array.isArray(data.photos)) {
        setGalleryPhotos(data.photos);
      }
    } catch {
      // Gallery loading is optional — silently degrade
    } finally {
      setGalleryLoading(false);
      setGalleryLoaded(true);
    }
  }, [galleryLoaded, galleryLoading]);

  // ── Poll for video status ──────────────────────────────
  const startPolling = useCallback((id: string) => {
    // Reset poll counter
    pollCountRef.current = 0;

    // Clear any stale interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(async () => {
      pollCountRef.current += 1;

      // Safety valve: stop after MAX_POLL_ATTEMPTS
      if (pollCountRef.current > MAX_POLL_ATTEMPTS) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setStatus("failed");
        setErrorMessage(
          "Przekroczono czas oczekiwania na story. Sprobuj ponownie.",
        );
        toast.error("Czas generowania story uplynal");
        return;
      }

      try {
        const res = await fetch(`/api/ai/video/status/${id}`);
        const data: StatusResponse = await res.json();

        if (data.status === "completed" && data.videoUrl) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setVideoUrl(data.videoUrl);
          setStatus("completed");
          toast.success("Story wygenerowane!");
        } else if (data.status === "failed") {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setStatus("failed");
          setErrorMessage(data.error ?? "Nie udalo sie wygenerowac story");
          toast.error(data.error ?? "Blad generowania story");
        }
        // "processing" — keep polling
      } catch {
        // Network error — keep polling; transient failures are normal
      }
    }, POLL_INTERVAL_MS);
  }, []);

  // ── Start generation ────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      toast.error("Wpisz opis story");
      return;
    }

    // Reset previous state
    setStatus("starting");
    setVideoUrl(null);
    setErrorMessage(null);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    try {
      const res = await mutationFetch("/api/ai/video/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          template,
          duration,
          ...(selectedPhotoId ? { photoId: selectedPhotoId } : {}),
        }),
      });

      const data: GenerateResponse = await res.json();

      if (data.success && data.taskId) {
        setStatus("processing");
        toast.info(
          "Generowanie story rozpoczete. Moze to potrwac do kilku minut.",
        );
        startPolling(data.taskId);
      } else if (data.code === "PLAN_UPGRADE_REQUIRED") {
        setStatus("idle");
        toast.error("Animowane Stories dostepne tylko w Planie Pro");
      } else {
        setStatus("failed");
        setErrorMessage(
          data.error ?? "Nie udalo sie rozpoczac generowania",
        );
        toast.error(data.error ?? "Blad podczas generowania story");
      }
    } catch {
      setStatus("failed");
      setErrorMessage("Blad polaczenia z serwerem");
      toast.error("Blad polaczenia z serwerem");
    }
  }, [prompt, template, duration, selectedPhotoId, startPolling]);

  // ── Download video ──────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!videoUrl) return;
    const link = document.createElement("a");
    link.href = videoUrl;
    link.download = `salon-story-${Date.now()}.mp4`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.click();
  }, [videoUrl]);

  // ── Copy URL ────────────────────────────────────────────
  const handleCopyUrl = useCallback(() => {
    if (!videoUrl) return;
    navigator.clipboard.writeText(videoUrl).then(
      () => toast.success("URL skopiowany"),
      () => toast.error("Nie udalo sie skopiowac URL"),
    );
  }, [videoUrl]);

  const isGenerating = status === "starting" || status === "processing";

  // Find the selected photo for display
  const selectedPhoto = selectedPhotoId
    ? galleryPhotos.find((p) => p.id === selectedPhotoId)
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Configuration card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Animowane Stories
            <Badge variant="secondary" className="text-xs">
              9:16
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Template selector — visual cards */}
          <div className="space-y-2">
            <Label>Szablon</Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TEMPLATE_OPTIONS.map((t) => {
                const Icon = t.icon;
                const isSelected = template === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setTemplate(t.value)}
                    className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:border-primary/50 hover:bg-muted/50"
                    } ${isGenerating ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-xs font-medium">{t.label}</span>
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      {t.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prompt */}
          <div className="space-y-2">
            <Label htmlFor="story-prompt">Opis story</Label>
            <Textarea
              id="story-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="np. Promocja -20% na koloryzacje wlosow, ciepla jesienna atmosfera"
              rows={3}
              maxLength={500}
              disabled={isGenerating}
            />
            <p className="text-xs text-muted-foreground text-right">
              {prompt.length}/500
            </p>
          </div>

          {/* Gallery photo picker (optional) */}
          <div className="space-y-2">
            <Label>Zdjecie z galerii (opcjonalne)</Label>
            {selectedPhoto ? (
              <div className="flex items-center gap-3 rounded-lg border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedPhoto.afterPhotoUrl ?? selectedPhoto.beforePhotoUrl ?? ""}
                  alt={selectedPhoto.description ?? "Zdjecie z galerii"}
                  className="h-12 w-12 rounded object-cover"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {selectedPhoto.description ?? selectedPhoto.serviceName ?? "Zdjecie"}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => setSelectedPhotoId(null)}
                  disabled={isGenerating}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={loadGalleryPhotos}
                disabled={isGenerating || galleryLoading}
              >
                {galleryLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <ImageIcon className="h-4 w-4 mr-2" />
                )}
                {galleryLoaded && galleryPhotos.length === 0
                  ? "Brak zdjec w galerii"
                  : "Wybierz zdjecie z galerii"}
              </Button>
            )}

            {/* Photo selection grid (visible after loading) */}
            {galleryLoaded && !selectedPhoto && galleryPhotos.length > 0 && (
              <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto rounded-lg border p-2">
                {galleryPhotos.map((photo) => (
                  <button
                    key={photo.id}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setSelectedPhotoId(photo.id)}
                    className="group relative aspect-square rounded overflow-hidden border hover:border-primary transition-colors"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.afterPhotoUrl ?? photo.beforePhotoUrl ?? ""}
                      alt={photo.description ?? "Zdjecie"}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Duration selector */}
          <div className="space-y-2">
            <Label>Czas trwania</Label>
            <Select
              value={duration}
              onValueChange={setDuration}
              disabled={isGenerating}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((o) => (
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
            disabled={isGenerating || !prompt.trim()}
            className="w-full"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {status === "starting"
                  ? "Wysylanie..."
                  : "Generowanie story..."}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generuj story
              </>
            )}
          </Button>

          {isGenerating && (
            <p className="text-xs text-muted-foreground text-center">
              Generowanie story moze potrwac 2-5 minut. Mozesz poczekac na
              tej stronie — status aktualizuje sie automatycznie.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Preview card — vertical 9:16 aspect ratio */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Podglad story
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Processing state */}
          {isGenerating && (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
              <div className="relative">
                <Loader2 className="h-12 w-12 text-primary animate-spin" />
              </div>
              <div className="space-y-1">
                <p className="font-medium text-sm">Generowanie story...</p>
                <p className="text-xs text-muted-foreground">
                  Veo 3.1 tworzy Twoje animowane story (9:16)
                </p>
              </div>
            </div>
          )}

          {/* Completed state */}
          {status === "completed" && videoUrl && (
            <div className="space-y-4">
              {/* Vertical 9:16 container */}
              <div className="mx-auto max-w-[280px] rounded-lg border overflow-hidden bg-muted">
                <div className="relative" style={{ aspectRatio: "9/16" }}>
                  <video
                    src={videoUrl}
                    controls
                    playsInline
                    className="absolute inset-0 w-full h-full object-contain"
                    preload="metadata"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownload}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Pobierz
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                >
                  <Sparkles className="h-4 w-4 mr-1" />
                  Regeneruj
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyUrl}
                >
                  <Copy className="h-4 w-4 mr-1" />
                  URL
                </Button>
              </div>
            </div>
          )}

          {/* Error state */}
          {status === "failed" && (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
              <Smartphone className="h-12 w-12 text-destructive/30" />
              <div className="space-y-1">
                <p className="font-medium text-sm text-destructive">
                  Blad generowania
                </p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  {errorMessage ?? "Nieznany blad"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerate}
                disabled={!prompt.trim()}
              >
                Sprobuj ponownie
              </Button>
            </div>
          )}

          {/* Idle state */}
          {status === "idle" && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Smartphone className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground">
                Wygeneruj story aby zobaczyc podglad
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Animowane story 9:16 idealne na Instagram i TikTok
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
