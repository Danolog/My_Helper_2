"use client";

import { useState, useCallback } from "react";
import {
  Video,
  Sparkles,
  Loader2,
  Copy,
  Check,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Camera,
  MessageCircle,
  Hash,
  Lightbulb,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReadAloudButton } from "@/components/ui/read-aloud-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { mutationFetch } from "@/lib/api-client";

// ────────────────────────────────────────────────────────────
// Option constants
// ────────────────────────────────────────────────────────────

type Platform = "instagram" | "tiktok" | "youtube" | "facebook";
type Tone = "professional" | "casual" | "emotional" | "energetic";
type Duration = "15" | "30" | "60";

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "facebook", label: "Facebook" },
];

const TONES: { value: Tone; label: string }[] = [
  { value: "professional", label: "Profesjonalny" },
  { value: "casual", label: "Swobodny" },
  { value: "emotional", label: "Emocjonalny" },
  { value: "energetic", label: "Energiczny" },
];

const DURATIONS: { value: Duration; label: string }[] = [
  { value: "15", label: "15 sekund" },
  { value: "30", label: "30 sekund" },
  { value: "60", label: "60 sekund" },
];

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface TestimonialTemplateData {
  intro: string;
  questions: string[];
  suggestedAnswerTips: string[];
  outro: string;
  hashtags: string[];
  shootingTips: string[];
  estimatedDuration: string;
}

// ────────────────────────────────────────────────────────────
// Format template as copyable text
// ────────────────────────────────────────────────────────────

function formatTemplateAsText(template: TestimonialTemplateData): string {
  const lines: string[] = [];

  lines.push("SZABLON TESTIMONIAL WIDEO");
  lines.push("========================");
  lines.push("");

  lines.push(`WSTEP:`);
  lines.push(template.intro);
  lines.push("");

  lines.push("PYTANIA DO KLIENTA:");
  template.questions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q}`);
  });
  lines.push("");

  if (template.suggestedAnswerTips.length > 0) {
    lines.push("WSKAZOWKI DLA ODPOWIEDZI:");
    template.suggestedAnswerTips.forEach((tip) => {
      lines.push(`- ${tip}`);
    });
    lines.push("");
  }

  lines.push("ZAKONCZENIE (CTA):");
  lines.push(template.outro);
  lines.push("");

  if (template.hashtags.length > 0) {
    lines.push("HASHTAGI:");
    lines.push(template.hashtags.join(" "));
    lines.push("");
  }

  if (template.shootingTips.length > 0) {
    lines.push("WSKAZOWKI NAGRYWANIA:");
    template.shootingTips.forEach((tip) => {
      lines.push(`- ${tip}`);
    });
    lines.push("");
  }

  lines.push(`Szacowany czas: ${template.estimatedDuration}`);

  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export function TestimonialTemplate() {
  // Form state
  const [serviceName, setServiceName] = useState("");
  const [clientName, setClientName] = useState("");
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [tone, setTone] = useState<Tone>("casual");
  const [duration, setDuration] = useState<Duration>("30");

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [template, setTemplate] = useState<TestimonialTemplateData | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [showShootingTips, setShowShootingTips] = useState(false);

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setTemplate(null);

    try {
      const response = await mutationFetch(
        "/api/ai/video/testimonial-template",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serviceName: serviceName.trim() || undefined,
            clientName: clientName.trim() || undefined,
            platform,
            tone,
            duration,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Blad podczas generowania szablonu");
        return;
      }

      setTemplate(data.template);
      setShowShootingTips(false);
      toast.success("Szablon testimonial wygenerowany!");
    } catch {
      toast.error("Nie udalo sie wygenerowac szablonu. Sprobuj ponownie.");
    } finally {
      setIsGenerating(false);
    }
  }, [serviceName, clientName, platform, tone, duration]);

  const handleCopy = useCallback(async () => {
    if (!template) return;
    try {
      await navigator.clipboard.writeText(formatTemplateAsText(template));
      setCopied(true);
      toast.success("Szablon skopiowany do schowka!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Nie udalo sie skopiowac szablonu");
    }
  }, [template]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ── Left column: Configuration ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Konfiguracja szablonu
          </CardTitle>
          <CardDescription>
            AI wygeneruje tekstowy scenariusz testimonial wideo
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Service name (optional) */}
          <div className="space-y-2">
            <Label htmlFor="service-name">
              Nazwa uslugi{" "}
              <span className="text-muted-foreground text-xs">
                (opcjonalnie)
              </span>
            </Label>
            <Input
              id="service-name"
              placeholder="np. Koloryzacja balayage, Zabieg oczyszczajacy..."
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              maxLength={200}
            />
          </div>

          {/* Client name (optional) */}
          <div className="space-y-2">
            <Label htmlFor="client-name">
              Imie klienta{" "}
              <span className="text-muted-foreground text-xs">
                (opcjonalnie)
              </span>
            </Label>
            <Input
              id="client-name"
              placeholder="np. Anna, Kasia..."
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              maxLength={100}
            />
          </div>

          {/* Platform */}
          <div className="space-y-2">
            <Label>Platforma</Label>
            <div className="flex gap-2 flex-wrap">
              {PLATFORMS.map((p) => (
                <Button
                  key={p.value}
                  variant={platform === p.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPlatform(p.value)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Tone */}
          <div className="space-y-2">
            <Label>Ton komunikacji</Label>
            <Select
              value={tone}
              onValueChange={(v) => setTone(v as Tone)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TONES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Duration */}
          <div className="space-y-2">
            <Label>Docelowy czas wideo</Label>
            <Select
              value={duration}
              onValueChange={(v) => setDuration(v as Duration)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Generate button */}
          <Button
            className="w-full"
            size="lg"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generowanie...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Wygeneruj szablon
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* ── Right column: Generated template ── */}
      <div className="space-y-4">
        {isGenerating ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                AI generuje szablon testimonial...
              </p>
            </CardContent>
          </Card>
        ) : template ? (
          <>
            {/* Intro card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Video className="h-4 w-4 text-primary" />
                  Wstep (hook)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-start gap-2">
                  <p className="bg-muted/50 rounded-lg p-3 text-sm leading-relaxed border flex-1">
                    {template.intro}
                  </p>
                  <ReadAloudButton text={template.intro} />
                </div>
              </CardContent>
            </Card>

            {/* Questions card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-primary" />
                  Pytania do klienta
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {template.questions.map((question, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 bg-muted/50 rounded-lg p-3 border"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-medium shrink-0">
                      {i + 1}
                    </span>
                    <p className="text-sm leading-relaxed">{question}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Answer tips (muted box) */}
            {template.suggestedAnswerTips.length > 0 && (
              <Card className="border-dashed">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2 text-muted-foreground">
                    <Lightbulb className="h-4 w-4" />
                    Wskazowki dla odpowiedzi
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5">
                    {template.suggestedAnswerTips.map((tip, i) => (
                      <li
                        key={i}
                        className="text-sm text-muted-foreground flex items-start gap-2"
                      >
                        <span className="text-primary mt-0.5 shrink-0">
                          &bull;
                        </span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Outro card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Video className="h-4 w-4 text-primary" />
                  Zakonczenie (CTA)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="bg-muted/50 rounded-lg p-3 text-sm leading-relaxed border">
                  {template.outro}
                </p>
              </CardContent>
            </Card>

            {/* Hashtags */}
            {template.hashtags.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Hash className="h-4 w-4 text-primary" />
                    Hashtagi
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {template.hashtags.map((tag, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Shooting tips — collapsible section */}
            {template.shootingTips.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <button
                    type="button"
                    className="flex items-center justify-between w-full"
                    onClick={() => setShowShootingTips((prev) => !prev)}
                  >
                    <CardTitle className="text-base flex items-center gap-2">
                      <Camera className="h-4 w-4 text-primary" />
                      Wskazowki nagrywania
                    </CardTitle>
                    {showShootingTips ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                </CardHeader>
                {showShootingTips && (
                  <CardContent className="pt-0">
                    <ul className="space-y-2">
                      {template.shootingTips.map((tip, i) => (
                        <li
                          key={i}
                          className="text-sm flex items-start gap-2"
                        >
                          <Camera className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                )}
              </Card>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button variant="default" className="flex-1" onClick={handleCopy}>
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Skopiowano!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Kopiuj szablon
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Generuj ponownie
              </Button>
            </div>
          </>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
              <Video className="h-12 w-12 opacity-20" />
              <p className="text-sm text-center">
                Skonfiguruj szablon i kliknij &quot;Wygeneruj szablon&quot; aby
                otrzymac scenariusz testimonial wideo
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
