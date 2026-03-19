"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Video,
  Sparkles,
  Download,
  Loader2,
  Copy,
  Monitor,
  Smartphone,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

// ────────────────────────────────────────────────────────────
// Option constants
// ────────────────────────────────────────────────────────────

const ASPECT_RATIO_OPTIONS = [
  { value: "16:9", label: "Poziome (16:9)", icon: Monitor },
  { value: "9:16", label: "Pionowe (9:16)", icon: Smartphone },
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

type GenerationStatus = "idle" | "starting" | "processing" | "completed" | "failed";

interface GenerateResponse {
  success?: boolean;
  taskId?: string;
  status?: string;
  error?: string;
  code?: string;
}

interface StatusResponse {
  success?: boolean;
  status?: string;
  videoUrl?: string;
  error?: string;
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export function VideoGenerator() {
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [duration, setDuration] = useState("6");
  const [autoPrompt, setAutoPrompt] = useState(true);

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
        setErrorMessage("Przekroczono czas oczekiwania na wideo. Sprobuj ponownie.");
        toast.error("Czas generowania wideo uplynal");
        return;
      }

      try {
        const res = await fetch(`/api/ai/video/status/${id}`);
        const data: StatusResponse = await res.json();

        if (data.status === "completed" && data.videoUrl) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setVideoUrl(data.videoUrl);
          setStatus("completed");
          toast.success("Wideo wygenerowane!");
        } else if (data.status === "failed") {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setStatus("failed");
          setErrorMessage(data.error ?? "Nie udalo sie wygenerowac wideo");
          toast.error(data.error ?? "Blad generowania wideo");
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
      toast.error("Wpisz opis wideo");
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
      const res = await fetch("/api/ai/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, aspectRatio, duration, autoPrompt }),
      });

      const data: GenerateResponse = await res.json();

      if (data.success && data.taskId) {
        setStatus("processing");
        toast.info("Generowanie wideo rozpoczete. Moze to potrwac do kilku minut.");
        startPolling(data.taskId);
      } else if (data.code === "PLAN_UPGRADE_REQUIRED") {
        setStatus("idle");
        toast.error("Generowanie wideo dostepne tylko w Planie Pro");
      } else {
        setStatus("failed");
        setErrorMessage(data.error ?? "Nie udalo sie rozpoczac generowania");
        toast.error(data.error ?? "Blad podczas generowania wideo");
      }
    } catch {
      setStatus("failed");
      setErrorMessage("Blad polaczenia z serwerem");
      toast.error("Blad polaczenia z serwerem");
    }
  }, [prompt, aspectRatio, duration, autoPrompt, startPolling]);

  // ── Download video ──────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!videoUrl) return;
    const link = document.createElement("a");
    link.href = videoUrl;
    link.download = `salon-video-${Date.now()}.mp4`;
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

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Configuration card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Generuj wideo AI
            <Badge variant="secondary" className="text-xs">
              Veo 3.1
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Prompt */}
          <div className="space-y-2">
            <Label htmlFor="video-prompt">Opis wideo</Label>
            <Textarea
              id="video-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="np. Elegancki salon fryzjerski z plynnym ruchem kamery przez stanowiska"
              rows={3}
              maxLength={500}
              disabled={isGenerating}
            />
            <p className="text-xs text-muted-foreground text-right">
              {prompt.length}/500
            </p>
          </div>

          {/* Auto-prompt toggle */}
          <div className="flex items-center gap-2">
            <Switch
              id="video-auto-prompt"
              checked={autoPrompt}
              onCheckedChange={setAutoPrompt}
              disabled={isGenerating}
            />
            <Label htmlFor="video-auto-prompt">
              Auto-optymalizacja promptu (AI)
            </Label>
          </div>

          {/* Aspect ratio & Duration selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Format</Label>
              <Select
                value={aspectRatio}
                onValueChange={setAspectRatio}
                disabled={isGenerating}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECT_RATIO_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="flex items-center gap-2">
                        <o.icon className="h-3.5 w-3.5" />
                        {o.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
                  : "Generowanie wideo..."}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generuj wideo
              </>
            )}
          </Button>

          {isGenerating && (
            <p className="text-xs text-muted-foreground text-center">
              Generowanie wideo moze potrwac 2-5 minut. Mozesz poczekac na
              tej stronie — status aktualizuje sie automatycznie.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Preview card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="h-5 w-5" />
            Podglad
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
                <p className="font-medium text-sm">Generowanie wideo...</p>
                <p className="text-xs text-muted-foreground">
                  Veo 3.1 tworzy Twoj klip promocyjny
                </p>
              </div>
            </div>
          )}

          {/* Completed state */}
          {status === "completed" && videoUrl && (
            <div className="space-y-4">
              <div className="rounded-lg border overflow-hidden bg-muted">
                <video
                  src={videoUrl}
                  controls
                  playsInline
                  className="w-full h-auto"
                  preload="metadata"
                />
              </div>

              <div className="flex gap-2">
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
              <Video className="h-12 w-12 text-destructive/30" />
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
              <Video className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground">
                Wygeneruj wideo aby zobaczyc podglad
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Krotkie klipy 4-8 sekund idealne na social media
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
