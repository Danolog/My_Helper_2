"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Mail,
  Loader2,
  Copy,
  Check,
  Sparkles,
  RefreshCw,
  Save,
  Clock,
  FileText,
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

type GoalType =
  | "promotion"
  | "seasonal"
  | "loyalty"
  | "reactivation"
  | "news"
  | "tips";
type Tone = "professional" | "casual" | "fun" | "luxurious" | "educational";
type Length = "short" | "medium" | "long";

const GOALS: { value: GoalType; label: string; description: string }[] = [
  {
    value: "promotion",
    label: "Promocja",
    description: "Promocja uslugi, produktu lub oferty specjalnej",
  },
  {
    value: "seasonal",
    label: "Sezonowy",
    description: "Oferta sezonowa lub swiateczna",
  },
  {
    value: "loyalty",
    label: "Lojalnosc",
    description: "Budowanie relacji z obecnymi klientami",
  },
  {
    value: "reactivation",
    label: "Reaktywacja",
    description: "Zachecenie nieaktywnych klientow do powrotu",
  },
  {
    value: "news",
    label: "Nowosci",
    description: "Informacje o nowosciach w salonie",
  },
  {
    value: "tips",
    label: "Porady",
    description: "Wskazowki i porady pielegnacyjne",
  },
];

const TONES: { value: Tone; label: string }[] = [
  { value: "professional", label: "Profesjonalny" },
  { value: "casual", label: "Swobodny" },
  { value: "fun", label: "Zabawny" },
  { value: "luxurious", label: "Luksusowy" },
  { value: "educational", label: "Edukacyjny" },
];

const LENGTHS: { value: Length; label: string; description: string }[] = [
  { value: "short", label: "Krotki", description: "150-250 slow" },
  { value: "medium", label: "Sredni", description: "250-400 slow" },
  { value: "long", label: "Dlugi", description: "400-600 slow" },
];

type GeneratedNewsletter = {
  subject: string;
  content: string;
  wordCount: number;
  goal: GoalType;
  tone: Tone;
  savedId: string | null;
};

type SavedNewsletter = {
  id: string;
  subject: string;
  content: string;
  createdAt: string;
  sentAt: string | null;
  recipientsCount: number;
};

function NewslettersContent() {
  const [topic, setTopic] = useState("");
  const [goals, setGoals] = useState<GoalType>("promotion");
  const [tone, setTone] = useState<Tone>("professional");
  const [length, setLength] = useState<Length>("medium");
  const [includeCallToAction, setIncludeCallToAction] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedNewsletter, setGeneratedNewsletter] =
    useState<GeneratedNewsletter | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedNewsletters, setSavedNewsletters] = useState<SavedNewsletter[]>(
    []
  );
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"create" | "saved">("create");

  // Load saved newsletters
  useEffect(() => {
    fetchSavedNewsletters();
  }, []);

  const fetchSavedNewsletters = async () => {
    try {
      const response = await fetch("/api/ai/content/newsletter");
      if (response.ok) {
        const data = await response.json();
        setSavedNewsletters(data.newsletters || []);
      }
    } catch (error) {
      console.error("Error fetching saved newsletters:", error);
    } finally {
      setLoadingSaved(false);
    }
  };

  const handleGenerate = async () => {
    if (!topic.trim()) {
      toast.error("Podaj temat lub cel newslettera");
      return;
    }

    setIsGenerating(true);
    setGeneratedNewsletter(null);

    try {
      const response = await fetch("/api/ai/content/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          goals,
          tone,
          length,
          includeCallToAction,
          save: false,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Blad podczas generowania newslettera");
        return;
      }

      setGeneratedNewsletter(data);
      toast.success("Newsletter wygenerowany pomyslnie!");
    } catch (error) {
      console.error("Error generating newsletter:", error);
      toast.error(
        "Nie udalo sie wygenerowac newslettera. Sprobuj ponownie."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!generatedNewsletter) return;

    setIsSaving(true);
    try {
      const response = await fetch("/api/ai/content/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          goals,
          tone,
          length,
          includeCallToAction,
          save: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Blad podczas zapisywania");
        return;
      }

      if (data.savedId) {
        setGeneratedNewsletter({ ...generatedNewsletter, savedId: data.savedId });
        toast.success("Newsletter zapisany!");
        // Refresh saved list
        fetchSavedNewsletters();
      }
    } catch (error) {
      console.error("Error saving newsletter:", error);
      toast.error("Nie udalo sie zapisac newslettera.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedNewsletter) return;
    const fullText = `Temat: ${generatedNewsletter.subject}\n\n${generatedNewsletter.content}`;
    try {
      await navigator.clipboard.writeText(fullText);
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

  const selectedGoal = GOALS.find((g) => g.value === goals);

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/content-generator">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="h-6 w-6 text-primary" />
            Newslettery
          </h1>
          <p className="text-muted-foreground">
            Tworzenie newsletterow promocyjnych i informacyjnych z pomoca AI
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <Button
          variant={activeTab === "create" ? "default" : "outline"}
          onClick={() => setActiveTab("create")}
          className="flex items-center gap-2"
        >
          <Sparkles className="h-4 w-4" />
          Generuj nowy
        </Button>
        <Button
          variant={activeTab === "saved" ? "default" : "outline"}
          onClick={() => setActiveTab("saved")}
          className="flex items-center gap-2"
        >
          <FileText className="h-4 w-4" />
          Zapisane ({savedNewsletters.length})
        </Button>
      </div>

      {activeTab === "create" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left column - Configuration */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Konfiguracja newslettera
              </CardTitle>
              <CardDescription>
                Okresl temat, cel i styl newslettera
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Topic / Context */}
              <div className="space-y-2">
                <Label htmlFor="topic">
                  Temat / cel newslettera{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="topic"
                  placeholder="Np. Promocja wiosenna -30% na wszystkie zabiegi pielegnacyjne, nowy zabieg lifting twarzy, zaproszenie na dzien otwarty..."
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  rows={3}
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {topic.length}/500
                </p>
              </div>

              {/* Goal */}
              <div className="space-y-2">
                <Label>Cel newslettera</Label>
                <Select
                  value={goals}
                  onValueChange={(v) => setGoals(v as GoalType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GOALS.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        <span className="font-medium">{g.label}</span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          — {g.description}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedGoal && (
                  <p className="text-xs text-muted-foreground">
                    {selectedGoal.description}
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

              {/* Length */}
              <div className="space-y-2">
                <Label>Dlugosc</Label>
                <div className="flex gap-2">
                  {LENGTHS.map((l) => (
                    <Button
                      key={l.value}
                      variant={length === l.value ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      onClick={() => setLength(l.value)}
                    >
                      <div className="text-center">
                        <div>{l.label}</div>
                        <div className="text-xs opacity-70">
                          {l.description}
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              </div>

              {/* Options */}
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeCallToAction}
                    onChange={(e) =>
                      setIncludeCallToAction(e.target.checked)
                    }
                    className="rounded border-gray-300"
                  />
                  Wezwanie do dzialania (CTA)
                </label>
              </div>

              {/* Generate button */}
              <Button
                className="w-full"
                size="lg"
                onClick={handleGenerate}
                disabled={isGenerating || !topic.trim()}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generowanie...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Wygeneruj newsletter
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Right column - Generated newsletter */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Wygenerowany newsletter
              </CardTitle>
              <CardDescription>
                Podglad wygenerowanej tresci - zapisz lub skopiuj
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isGenerating ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">
                    AI generuje newsletter...
                  </p>
                </div>
              ) : generatedNewsletter ? (
                <div className="space-y-4">
                  {/* Meta badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">
                      {GOALS.find((g) => g.value === generatedNewsletter.goal)
                        ?.label || generatedNewsletter.goal}
                    </Badge>
                    <Badge variant="outline">
                      {TONES.find((t) => t.value === generatedNewsletter.tone)
                        ?.label || generatedNewsletter.tone}
                    </Badge>
                    <Badge variant="secondary">
                      {generatedNewsletter.wordCount} slow
                    </Badge>
                    {generatedNewsletter.savedId && (
                      <Badge
                        variant="default"
                        className="bg-green-600 hover:bg-green-700"
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Zapisany
                      </Badge>
                    )}
                  </div>

                  {/* Subject line */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Temat emaila
                    </Label>
                    <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 font-medium">
                      {generatedNewsletter.subject}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Tresc newslettera
                    </Label>
                    <div className="bg-muted/50 rounded-lg p-4 whitespace-pre-wrap text-sm leading-relaxed border max-h-[400px] overflow-y-auto">
                      {generatedNewsletter.content}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 flex-wrap">
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
                          Kopiuj
                        </>
                      )}
                    </Button>
                    {!generatedNewsletter.savedId && (
                      <Button
                        variant="secondary"
                        onClick={handleSave}
                        disabled={isSaving}
                      >
                        {isSaving ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4 mr-2" />
                        )}
                        Zapisz
                      </Button>
                    )}
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
                  <Mail className="h-12 w-12 opacity-20" />
                  <p className="text-sm text-center">
                    Podaj temat i kliknij &quot;Wygeneruj newsletter&quot; aby
                    otrzymac tresc gotowa do wyslania
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        /* Saved newsletters tab */
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Zapisane newslettery
            </CardTitle>
            <CardDescription>
              Historia wygenerowanych i zapisanych newsletterow
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingSaved ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : savedNewsletters.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                <Mail className="h-12 w-12 opacity-20" />
                <p className="text-sm text-center">
                  Nie masz jeszcze zapisanych newsletterow.
                  <br />
                  Wygeneruj newsletter i kliknij &quot;Zapisz&quot;.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {savedNewsletters.map((nl) => (
                  <div
                    key={nl.id}
                    className="border rounded-lg p-4 space-y-2 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium truncate">{nl.subject}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                          {nl.content.slice(0, 200)}...
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {nl.sentAt ? (
                          <Badge
                            variant="default"
                            className="bg-green-600 hover:bg-green-700"
                          >
                            Wyslany
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Wersja robocza</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(nl.createdAt).toLocaleDateString("pl-PL", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {nl.recipientsCount > 0 && (
                        <span>
                          {nl.recipientsCount} odbiorcow
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function NewslettersPage() {
  return (
    <ProPlanGate
      featureName="Newslettery AI"
      featureDescription="AI tworzy profesjonalne newslettery emailowe dopasowane do Twojego salonu - promocyjne, informacyjne i sezonowe."
      proBenefits={[
        "Generowanie newsletterow promocyjnych i informacyjnych",
        "6 celow newslettera (promocja, reaktywacja, nowosci i wiecej)",
        "5 tonow komunikacji do wyboru",
        "Automatyczny tytul i wezwanie do dzialania",
        "Zapis i historia newsletterow",
        "Kontekst salonu i uslug wbudowany w AI",
      ]}
    >
      <NewslettersContent />
    </ProPlanGate>
  );
}
