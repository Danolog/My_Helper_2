"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Instagram,
  Facebook,
  Loader2,
  Copy,
  Check,
  Sparkles,
  Hash,
  RefreshCw,
  X,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import { toast } from "sonner";
import { getTemplateById } from "@/lib/content-templates";

type Platform = "instagram" | "facebook" | "tiktok";
type PostType =
  | "promotion"
  | "service_highlight"
  | "tips_and_tricks"
  | "behind_the_scenes"
  | "client_transformation"
  | "seasonal"
  | "engagement";
type Tone = "professional" | "casual" | "fun" | "luxurious" | "educational";

const PLATFORMS: { value: Platform; label: string; icon: React.ReactNode }[] = [
  {
    value: "instagram",
    label: "Instagram",
    icon: <Instagram className="h-4 w-4" />,
  },
  {
    value: "facebook",
    label: "Facebook",
    icon: <Facebook className="h-4 w-4" />,
  },
  {
    value: "tiktok",
    label: "TikTok",
    icon: (
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.8a8.28 8.28 0 004.76 1.5V6.86a4.84 4.84 0 01-1-.17z" />
      </svg>
    ),
  },
];

const POST_TYPES: { value: PostType; label: string; description: string }[] = [
  {
    value: "promotion",
    label: "Promocja",
    description: "Oferta specjalna lub rabat",
  },
  {
    value: "service_highlight",
    label: "Prezentacja uslugi",
    description: "Wyroznienie wybranej uslugi",
  },
  {
    value: "tips_and_tricks",
    label: "Porady",
    description: "Wskazowki i triki dla klientow",
  },
  {
    value: "behind_the_scenes",
    label: "Za kulisami",
    description: "Codziennosc w salonie",
  },
  {
    value: "client_transformation",
    label: "Metamorfoza",
    description: "Efekty pracy - przed i po",
  },
  {
    value: "seasonal",
    label: "Sezonowy",
    description: "Post okolicznosciowy lub swiateczny",
  },
  {
    value: "engagement",
    label: "Angazujacy",
    description: "Pytanie lub ankieta dla obserwujacych",
  },
];

const TONES: { value: Tone; label: string }[] = [
  { value: "professional", label: "Profesjonalny" },
  { value: "casual", label: "Swobodny" },
  { value: "fun", label: "Zabawny" },
  { value: "luxurious", label: "Luksusowy" },
  { value: "educational", label: "Edukacyjny" },
];

/** Helper to validate whether a raw string is a recognised Platform value. */
function isValidPlatform(v: string): v is Platform {
  return (["instagram", "facebook", "tiktok"] as string[]).includes(v);
}

/** Helper to validate whether a raw string is a recognised PostType value. */
function isValidPostType(v: string): v is PostType {
  return POST_TYPES.some((pt) => pt.value === v);
}

/** Helper to validate whether a raw string is a recognised Tone value. */
function isValidTone(v: string): v is Tone {
  return TONES.some((t) => t.value === v);
}

type GeneratedPost = {
  post: string;
  platform: Platform;
  postType: PostType;
  hashtags: string[];
  characterCount: number;
  maxLength: number;
};

function SocialPostsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const templateId = searchParams.get("template");
  const template = templateId ? getTemplateById(templateId) : undefined;
  const preset = template?.socialPreset;

  const [platform, setPlatform] = useState<Platform>("instagram");
  const [postType, setPostType] = useState<PostType>("service_highlight");
  const [tone, setTone] = useState<Tone>("professional");
  const [context, setContext] = useState("");
  const [includeEmoji, setIncludeEmoji] = useState(true);
  const [includeHashtags, setIncludeHashtags] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPost, setGeneratedPost] = useState<GeneratedPost | null>(
    null
  );
  const [copied, setCopied] = useState(false);

  // Apply template preset values on mount (or when template changes)
  useEffect(() => {
    if (!preset) return;
    if (isValidPlatform(preset.platform)) setPlatform(preset.platform);
    if (isValidPostType(preset.postType)) setPostType(preset.postType);
    if (isValidTone(preset.tone)) setTone(preset.tone);
    setContext(preset.context);
    setIncludeEmoji(preset.includeEmoji);
    setIncludeHashtags(preset.includeHashtags);
  }, [preset]);

  /** Remove the template query param and reset form to defaults. */
  const handleClearTemplate = () => {
    router.replace("/dashboard/content-generator/social-posts");
    setPlatform("instagram");
    setPostType("service_highlight");
    setTone("professional");
    setContext("");
    setIncludeEmoji(true);
    setIncludeHashtags(true);
    setGeneratedPost(null);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGeneratedPost(null);

    try {
      const response = await fetch("/api/ai/content/social-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          postType,
          context: context.trim() || undefined,
          tone,
          includeEmoji,
          includeHashtags,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Blad podczas generowania posta");
        return;
      }

      setGeneratedPost(data);
      toast.success("Post wygenerowany pomyslnie!");
    } catch (error) {
      console.error("Error generating post:", error);
      toast.error("Nie udalo sie wygenerowac posta. Sprobuj ponownie.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedPost) return;
    try {
      await navigator.clipboard.writeText(generatedPost.post);
      setCopied(true);
      toast.success("Skopiowano do schowka!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Nie udalo sie skopiowac");
    }
  };

  const handleRegenerate = () => {
    handleGenerate();
  };

  const selectedPostType = POST_TYPES.find((pt) => pt.value === postType);

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/content-generator">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Instagram className="h-6 w-6 text-primary" />
            Posty social media
          </h1>
          <p className="text-muted-foreground">
            Generuj angazujace posty na Instagram, Facebook i TikTok
          </p>
        </div>
      </div>

      {/* Template banner - shown when a template is active */}
      {template && (
        <div className="flex items-center gap-3 mb-6 p-3 rounded-lg border border-primary/30 bg-primary/5">
          <BookOpen className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="text-sm font-medium flex-1">
            Szablon: {template.name}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearTemplate}
            className="h-7 px-2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Wyczysc
          </Button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column - Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Konfiguracja posta
            </CardTitle>
            <CardDescription>
              Wybierz platforme, typ posta i dodaj kontekst
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Platform selection */}
            <div className="space-y-2">
              <Label>Platforma</Label>
              <div className="flex gap-2">
                {PLATFORMS.map((p) => (
                  <Button
                    key={p.value}
                    variant={platform === p.value ? "default" : "outline"}
                    size="sm"
                    className="flex items-center gap-2"
                    onClick={() => setPlatform(p.value)}
                  >
                    {p.icon}
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Post type */}
            <div className="space-y-2">
              <Label>Typ posta</Label>
              <Select
                value={postType}
                onValueChange={(v) => setPostType(v as PostType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POST_TYPES.map((pt) => (
                    <SelectItem key={pt.value} value={pt.value}>
                      <span className="font-medium">{pt.label}</span>
                      <span className="text-muted-foreground ml-2 text-xs">
                        — {pt.description}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedPostType && (
                <p className="text-xs text-muted-foreground">
                  {selectedPostType.description}
                </p>
              )}
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

            {/* Context */}
            <div className="space-y-2">
              <Label htmlFor="context">
                Dodatkowy kontekst{" "}
                <span className="text-muted-foreground text-xs">
                  (opcjonalnie)
                </span>
              </Label>
              <Textarea
                id="context"
                placeholder="Np. nowa promocja -20% na koloryzacje, otwarcie nowego gabinetu, sezon letni..."
                value={context}
                onChange={(e) => setContext(e.target.value)}
                rows={3}
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground text-right">
                {context.length}/500
              </p>
            </div>

            {/* Options */}
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeEmoji}
                  onChange={(e) => setIncludeEmoji(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Emoji
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeHashtags}
                  onChange={(e) => setIncludeHashtags(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Hashtagi
              </label>
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
                  Wygeneruj post
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Right column - Generated post */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Hash className="h-5 w-5" />
              Wygenerowany post
            </CardTitle>
            <CardDescription>
              Podglad wygenerowanej tresci - skopiuj i opublikuj
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isGenerating ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  AI generuje tresc posta...
                </p>
              </div>
            ) : generatedPost ? (
              <div className="space-y-4">
                {/* Platform and type badges */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="flex items-center gap-1">
                    {PLATFORMS.find((p) => p.value === generatedPost.platform)
                      ?.icon}
                    {PLATFORMS.find((p) => p.value === generatedPost.platform)
                      ?.label}
                  </Badge>
                  <Badge variant="outline">
                    {POST_TYPES.find(
                      (pt) => pt.value === generatedPost.postType
                    )?.label}
                  </Badge>
                  <Badge
                    variant={
                      generatedPost.characterCount > generatedPost.maxLength
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {generatedPost.characterCount}/{generatedPost.maxLength}{" "}
                    znakow
                  </Badge>
                </div>

                {/* Post content */}
                <div className="bg-muted/50 rounded-lg p-4 whitespace-pre-wrap text-sm leading-relaxed border">
                  {generatedPost.post}
                </div>

                {/* Hashtags extracted */}
                {generatedPost.hashtags.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      Wyodrebnione hashtagi ({generatedPost.hashtags.length})
                    </Label>
                    <div className="flex flex-wrap gap-1">
                      {generatedPost.hashtags.map((tag, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    className="flex-1"
                    onClick={handleCopy}
                  >
                    {copied ? (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        Skopiowano!
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        Kopiuj do schowka
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleRegenerate}
                    disabled={isGenerating}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Generuj ponownie
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                <Sparkles className="h-12 w-12 opacity-20" />
                <p className="text-sm text-center">
                  Skonfiguruj post i kliknij &quot;Wygeneruj post&quot; aby
                  otrzymac tresc gotowa do publikacji
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function SocialPostsPage() {
  return (
    <ProPlanGate
      featureName="Posty social media"
      featureDescription="AI generuje angazujace posty na Instagram, Facebook i TikTok dopasowane do Twojego salonu."
      proBenefits={[
        "Posty na Instagram, Facebook i TikTok",
        "7 typow postow (promocja, porady, metamorfoza i wiecej)",
        "5 tonow komunikacji do wyboru",
        "Automatyczne hashtagi i emoji",
        "Kontekst salonu i uslug wbudowany w AI",
      ]}
    >
      <Suspense fallback={<div className="container mx-auto p-6"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
        <SocialPostsContent />
      </Suspense>
    </ProPlanGate>
  );
}
