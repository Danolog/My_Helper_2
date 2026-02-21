"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
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
  Send,
  Users,
  CheckCircle2,
  AlertCircle,
  X,
  BookOpen,
  Pencil,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import { toast } from "sonner";
import { getTemplateById } from "@/lib/content-templates";

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

/** Helper to validate whether a raw string is a recognised GoalType value. */
function isValidGoal(v: string): v is GoalType {
  return GOALS.some((g) => g.value === v);
}

/** Helper to validate whether a raw string is a recognised Tone value. */
function isValidTone(v: string): v is Tone {
  return TONES.some((t) => t.value === v);
}

/** Helper to validate whether a raw string is a recognised Length value. */
function isValidLength(v: string): v is Length {
  return LENGTHS.some((l) => l.value === v);
}

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

type Recipient = {
  clientId: string;
  firstName: string;
  lastName: string;
  email: string;
  consentGrantedAt: string;
};

type RecipientsData = {
  newsletterId: string;
  newsletterSubject: string;
  alreadySent: boolean;
  recipients: Recipient[];
  consentedCount: number;
  totalClientsWithEmail: number;
};

function SendNewsletterDialog({
  newsletter,
  open,
  onOpenChange,
  onSent,
}: {
  newsletter: SavedNewsletter | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [recipientsData, setRecipientsData] = useState<RecipientsData | null>(
    null
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendResult, setSendResult] = useState<{
    sentCount: number;
    failedCount: number;
  } | null>(null);

  // Fetch recipients when dialog opens
  useEffect(() => {
    if (open && newsletter) {
      setLoading(true);
      setSendResult(null);
      setSelectedIds(new Set());
      fetch(`/api/newsletters/${newsletter.id}/recipients`)
        .then((res) => res.json())
        .then((data: RecipientsData) => {
          setRecipientsData(data);
          // Select all by default
          setSelectedIds(new Set(data.recipients.map((r) => r.clientId)));
        })
        .catch(() => {
          toast.error("Blad podczas pobierania odbiorcow");
        })
        .finally(() => setLoading(false));
    }
  }, [open, newsletter]);

  const toggleRecipient = (clientId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (!recipientsData) return;
    if (selectedIds.size === recipientsData.recipients.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(
        new Set(recipientsData.recipients.map((r) => r.clientId))
      );
    }
  };

  const handleSend = async () => {
    if (!newsletter || selectedIds.size === 0) return;
    setSending(true);
    try {
      const response = await fetch(`/api/newsletters/${newsletter.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientIds: Array.from(selectedIds),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Blad podczas wysylania");
        return;
      }

      setSendResult({
        sentCount: data.sentCount,
        failedCount: data.failedCount,
      });
      toast.success(
        `Newsletter wyslany do ${data.sentCount} odbiorcow!`
      );
      onSent();
    } catch {
      toast.error("Blad podczas wysylania newslettera");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Wyslij newsletter
          </DialogTitle>
          <DialogDescription>
            {newsletter?.subject
              ? `"${newsletter.subject}"`
              : "Wybierz odbiorcow i wyslij newsletter"}
          </DialogDescription>
        </DialogHeader>

        {/* Send result view */}
        {sendResult ? (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="h-12 w-12 text-green-600" />
              <h3 className="text-lg font-semibold">Newsletter wyslany!</h3>
              <p className="text-sm text-muted-foreground">
                Wyslano do {sendResult.sentCount} odbiorcow
                {sendResult.failedCount > 0 &&
                  ` (${sendResult.failedCount} bledow)`}
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Zamknij</Button>
            </DialogFooter>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : recipientsData && recipientsData.recipients.length > 0 ? (
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>
                {recipientsData.consentedCount} klientow ze zgoda email (z{" "}
                {recipientsData.totalClientsWithEmail} z adresem email)
              </span>
            </div>

            {recipientsData.alreadySent && (
              <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm">
                <AlertCircle className="h-4 w-4 text-yellow-600 flex-shrink-0" />
                <span>
                  Ten newsletter byl juz wczesniej wyslany. Mozesz wyslac go
                  ponownie.
                </span>
              </div>
            )}

            {/* Select all */}
            <div className="flex items-center gap-2 pb-2 border-b">
              <Checkbox
                id="select-all"
                checked={
                  selectedIds.size === recipientsData.recipients.length
                }
                onCheckedChange={toggleAll}
              />
              <label
                htmlFor="select-all"
                className="text-sm font-medium cursor-pointer"
              >
                Zaznacz wszystkich ({recipientsData.recipients.length})
              </label>
            </div>

            {/* Recipients list */}
            <div className="max-h-[300px] overflow-y-auto space-y-1">
              {recipientsData.recipients.map((r) => (
                <div
                  key={r.clientId}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <Checkbox
                    id={`recipient-${r.clientId}`}
                    checked={selectedIds.has(r.clientId)}
                    onCheckedChange={() => toggleRecipient(r.clientId)}
                  />
                  <label
                    htmlFor={`recipient-${r.clientId}`}
                    className="flex-1 cursor-pointer"
                  >
                    <div className="text-sm font-medium">
                      {r.firstName} {r.lastName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.email}
                    </div>
                  </label>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Anuluj
              </Button>
              <Button
                onClick={handleSend}
                disabled={sending || selectedIds.size === 0}
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Wysylanie...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Wyslij do {selectedIds.size} odbiorcow
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
              <Users className="h-12 w-12 opacity-20" />
              <p className="text-sm">
                Brak klientow z aktywna zgoda na email.
              </p>
              <p className="text-xs">
                Dodaj zgody marketingowe (email) w profilu klienta, aby moc
                wysylac newslettery.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Zamknij
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewslettersContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const templateId = searchParams.get("template");
  const template = templateId ? getTemplateById(templateId) : undefined;
  const preset = template?.newsletterPreset;

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
  const [isEditingNewsletter, setIsEditingNewsletter] = useState(false);
  const [editedSubject, setEditedSubject] = useState("");
  const [editedContent, setEditedContent] = useState("");

  // Send dialog state
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendingNewsletter, setSendingNewsletter] =
    useState<SavedNewsletter | null>(null);

  // Apply template preset values on mount (or when template changes)
  useEffect(() => {
    if (!preset) return;
    setTopic(preset.topic);
    if (isValidGoal(preset.goals)) setGoals(preset.goals);
    if (isValidTone(preset.tone)) setTone(preset.tone);
    if (isValidLength(preset.length)) setLength(preset.length);
    setIncludeCallToAction(preset.includeCallToAction);
  }, [preset]);

  /** Remove the template query param and reset form to defaults. */
  const handleClearTemplate = () => {
    router.replace("/dashboard/content-generator/newsletters");
    setTopic("");
    setGoals("promotion");
    setTone("professional");
    setLength("medium");
    setIncludeCallToAction(true);
    setGeneratedNewsletter(null);
    setIsEditingNewsletter(false);
    setEditedSubject("");
    setEditedContent("");
  };

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
      setEditedSubject(data.subject);
      setEditedContent(data.content);
      setIsEditingNewsletter(false);
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

    // Save the currently displayed (possibly edited) content
    const subjectToSave = editedSubject || generatedNewsletter.subject;
    const contentToSave = editedContent || generatedNewsletter.content;

    setIsSaving(true);
    try {
      const response = await fetch("/api/newsletters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subjectToSave,
          content: contentToSave,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Blad podczas zapisywania");
        return;
      }

      if (data.savedId) {
        // Apply edited values to the generated newsletter state
        setGeneratedNewsletter({
          ...generatedNewsletter,
          subject: subjectToSave,
          content: contentToSave,
          savedId: data.savedId,
        });
        setIsEditingNewsletter(false);
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
    const subjectToCopy = editedSubject || generatedNewsletter.subject;
    const contentToCopy = editedContent || generatedNewsletter.content;
    const fullText = `Temat: ${subjectToCopy}\n\n${contentToCopy}`;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      toast.success("Skopiowano do schowka!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Nie udalo sie skopiowac");
    }
  };

  const handleToggleNewsletterEdit = () => {
    if (!isEditingNewsletter && generatedNewsletter) {
      setEditedSubject(editedSubject || generatedNewsletter.subject);
      setEditedContent(editedContent || generatedNewsletter.content);
    }
    setIsEditingNewsletter(!isEditingNewsletter);
  };

  const handleSaveNewsletterEdit = () => {
    if (generatedNewsletter) {
      setGeneratedNewsletter({
        ...generatedNewsletter,
        subject: editedSubject,
        content: editedContent,
        wordCount: editedContent.split(/\s+/).filter(Boolean).length,
      });
      setIsEditingNewsletter(false);
      toast.success("Zmiany zapisane!");
    }
  };

  const handleRegenerate = () => {
    handleGenerate();
  };

  const handleOpenSendDialog = useCallback((nl: SavedNewsletter) => {
    setSendingNewsletter(nl);
    setSendDialogOpen(true);
  }, []);

  const handleSendComplete = useCallback(() => {
    fetchSavedNewsletters();
  }, []);

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
                    {isEditingNewsletter ? (
                      <input
                        type="text"
                        value={editedSubject}
                        onChange={(e) => setEditedSubject(e.target.value)}
                        className="w-full bg-primary/5 border border-primary/40 rounded-lg p-3 font-medium text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        data-testid="edit-newsletter-subject"
                      />
                    ) : (
                      <div
                        className="bg-primary/5 border border-primary/20 rounded-lg p-3 font-medium cursor-pointer hover:border-primary/50 transition-colors"
                        onClick={handleToggleNewsletterEdit}
                      >
                        {generatedNewsletter.subject}
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">
                      Tresc newslettera
                    </Label>
                    {isEditingNewsletter ? (
                      <div className="space-y-2">
                        <Textarea
                          value={editedContent}
                          onChange={(e) => setEditedContent(e.target.value)}
                          rows={12}
                          className="text-sm leading-relaxed resize-y min-h-[200px]"
                          data-testid="edit-newsletter-content"
                        />
                        <div className="flex items-center justify-between">
                          <Badge variant="secondary">
                            {editedContent.split(/\s+/).filter(Boolean).length} slow
                          </Badge>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditedSubject(generatedNewsletter.subject);
                                setEditedContent(generatedNewsletter.content);
                                setIsEditingNewsletter(false);
                              }}
                            >
                              Anuluj
                            </Button>
                            <Button
                              size="sm"
                              onClick={handleSaveNewsletterEdit}
                            >
                              <Check className="h-3.5 w-3.5 mr-1" />
                              Zapisz zmiany
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="bg-muted/50 rounded-lg p-4 whitespace-pre-wrap text-sm leading-relaxed border max-h-[400px] overflow-y-auto cursor-pointer hover:border-primary/50 transition-colors group relative"
                        onClick={handleToggleNewsletterEdit}
                        data-testid="newsletter-content-display"
                      >
                        {generatedNewsletter.content}
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Badge variant="secondary" className="text-xs">
                            <Pencil className="h-3 w-3 mr-1" />
                            Kliknij aby edytowac
                          </Badge>
                        </div>
                      </div>
                    )}
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
                    <Button
                      variant="outline"
                      onClick={handleToggleNewsletterEdit}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Edytuj
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
              Historia wygenerowanych i zapisanych newsletterow - kliknij
              &quot;Wyslij&quot; aby wyslac do klientow ze zgoda
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
                    className="border rounded-lg p-4 space-y-3 hover:bg-muted/50 transition-colors"
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
                    <div className="flex items-center justify-between gap-3">
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
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {nl.recipientsCount} odbiorcow
                          </span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={nl.sentAt ? "outline" : "default"}
                        onClick={() => handleOpenSendDialog(nl)}
                        className="flex items-center gap-1"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {nl.sentAt ? "Wyslij ponownie" : "Wyslij"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Send dialog */}
      <SendNewsletterDialog
        newsletter={sendingNewsletter}
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        onSent={handleSendComplete}
      />
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
        "Wysylanie do klientow ze zgoda marketingowa",
      ]}
    >
      <Suspense fallback={<div className="container mx-auto p-6"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
        <NewslettersContent />
      </Suspense>
    </ProPlanGate>
  );
}
