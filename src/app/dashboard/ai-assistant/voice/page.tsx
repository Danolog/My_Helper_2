"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Mic,
  Phone,
  PhoneIncoming,
  PhoneOff,
  Settings2,
  Save,
  Loader2,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Clock,
  User,
  Volume2,
  Send,
  History,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";
import { toast } from "sonner";

type VoiceAiConfig = {
  enabled: boolean;
  greeting: string;
  businessHoursOnly: boolean;
  language: "pl" | "en";
  voiceStyle: "professional" | "friendly" | "warm";
  maxCallDuration: number;
  transferToHumanEnabled: boolean;
  transferPhoneNumber: string;
  capabilities: {
    bookAppointments: boolean;
    checkAvailability: boolean;
    cancelAppointments: boolean;
    rescheduleAppointments: boolean;
    answerFaq: boolean;
  };
};

type CallSimulationResult = {
  conversationId: string;
  greeting: string;
  response: string;
  intent: string;
  intentLabel: string;
  suggestedAction: string | null;
  voiceStyle: string;
  language: string;
  transferToHuman: boolean;
};

type CallLogEntry = {
  id: string;
  callerPhone: string;
  callerMessage: string;
  aiResponse: string;
  intent: string;
  timestamp: string;
};

const DEFAULT_CONFIG: VoiceAiConfig = {
  enabled: false,
  greeting:
    "Dzien dobry! Dzwonisz do naszego salonu. Jestem asystentem AI. W czym moge pomoc?",
  businessHoursOnly: true,
  language: "pl",
  voiceStyle: "friendly",
  maxCallDuration: 300,
  transferToHumanEnabled: true,
  transferPhoneNumber: "",
  capabilities: {
    bookAppointments: true,
    checkAvailability: true,
    cancelAppointments: true,
    rescheduleAppointments: true,
    answerFaq: true,
  },
};

function VoiceAiContent() {
  const [config, setConfig] = useState<VoiceAiConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [callerMessage, setCallerMessage] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [callResult, setCallResult] = useState<CallSimulationResult | null>(
    null
  );
  const [callLog, setCallLog] = useState<CallLogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/voice/config", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
      }
    } catch (err) {
      console.error("Failed to load config:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCallLog = useCallback(async () => {
    setLoadingLog(true);
    try {
      const res = await fetch("/api/ai/voice/call-log", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setCallLog(data.logs || []);
      }
    } catch (err) {
      console.error("Failed to load call log:", err);
    } finally {
      setLoadingLog(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadCallLog();
  }, [loadConfig, loadCallLog]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/ai/voice/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        toast.success("Zapisano", {
          description: "Konfiguracja asystenta glosowego zostala zapisana.",
        });
      } else {
        const data = await res.json();
        toast.error("Blad", {
          description: data.error || "Nie udalo sie zapisac konfiguracji.",
        });
      }
    } catch {
      toast.error("Blad", {
        description: "Nie udalo sie polaczyc z serwerem.",
      });
    } finally {
      setSaving(false);
    }
  };

  const simulateCall = async () => {
    if (!callerMessage.trim()) return;
    if (!config.enabled) {
      toast.error("Asystent wylaczony", {
        description:
          "Wlacz asystenta glosowego AI w zakladce Konfiguracja, aby symulowac polaczenia.",
      });
      return;
    }

    setSimulating(true);
    setCallResult(null);
    try {
      const res = await fetch("/api/ai/voice/incoming", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerMessage: callerMessage.trim(),
          callerPhone: "+48 123 456 789",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setCallResult(data);
        setCallerMessage("");
        // Reload call log after successful simulation
        loadCallLog();
      } else {
        const data = await res.json();
        toast.error("Blad symulacji", {
          description: data.error || "Nie udalo sie przetworzyc polaczenia.",
        });
      }
    } catch {
      toast.error("Blad", {
        description: "Nie udalo sie polaczyc z serwerem.",
      });
    } finally {
      setSimulating(false);
    }
  };

  const updateCapability = (
    key: keyof VoiceAiConfig["capabilities"],
    value: boolean
  ) => {
    setConfig((prev) => ({
      ...prev,
      capabilities: { ...prev.capabilities, [key]: value },
    }));
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/ai-assistant">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mic className="h-6 w-6 text-primary" />
            Asystent glosowy AI
          </h1>
          <p className="text-muted-foreground">
            Automatyczne odbieranie polaczen telefonicznych
          </p>
        </div>
        <Badge
          variant={config.enabled ? "default" : "secondary"}
          className="gap-1"
        >
          {config.enabled ? (
            <>
              <CheckCircle2 className="h-3 w-3" /> Aktywny
            </>
          ) : (
            <>
              <XCircle className="h-3 w-3" /> Nieaktywny
            </>
          )}
        </Badge>
      </div>

      <Tabs defaultValue="config" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="config" className="gap-2">
            <Settings2 className="h-4 w-4" />
            Konfiguracja
          </TabsTrigger>
          <TabsTrigger value="simulate" className="gap-2">
            <PhoneIncoming className="h-4 w-4" />
            Symulacja polaczenia
          </TabsTrigger>
          <TabsTrigger value="log" className="gap-2">
            <History className="h-4 w-4" />
            Historia polaczen
          </TabsTrigger>
        </TabsList>

        {/* Configuration Tab */}
        <TabsContent value="config" className="space-y-6">
          {/* Enable/Disable */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5" />
                Status asystenta
              </CardTitle>
              <CardDescription>
                Wlacz lub wylacz automatyczne odbieranie polaczen przez AI
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="voice-enabled" className="text-base">
                    Asystent glosowy AI
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {config.enabled
                      ? "AI automatycznie odbiera polaczenia"
                      : "Polaczenia nie sa odbierane przez AI"}
                  </p>
                </div>
                <Switch
                  id="voice-enabled"
                  checked={config.enabled}
                  onCheckedChange={(checked) =>
                    setConfig((prev) => ({ ...prev, enabled: checked }))
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* Greeting & Voice */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Volume2 className="h-5 w-5" />
                Powitanie i glos
              </CardTitle>
              <CardDescription>
                Dostosuj sposob w jaki AI wita dzwoniacych
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="greeting">Tekst powitania</Label>
                <Textarea
                  id="greeting"
                  value={config.greeting}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      greeting: e.target.value,
                    }))
                  }
                  rows={3}
                  placeholder="Dzien dobry! W czym moge pomoc?"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Styl glosu</Label>
                  <Select
                    value={config.voiceStyle}
                    onValueChange={(value) =>
                      setConfig((prev) => ({
                        ...prev,
                        voiceStyle: value as VoiceAiConfig["voiceStyle"],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="professional">
                        Profesjonalny
                      </SelectItem>
                      <SelectItem value="friendly">Przyjazny</SelectItem>
                      <SelectItem value="warm">Ciepaly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Jezyk</Label>
                  <Select
                    value={config.language}
                    onValueChange={(value) =>
                      setConfig((prev) => ({
                        ...prev,
                        language: value as "pl" | "en",
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pl">Polski</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="max-duration">
                  Maks. czas polaczenia (sekundy): {config.maxCallDuration}s
                </Label>
                <Input
                  id="max-duration"
                  type="number"
                  min={60}
                  max={600}
                  value={config.maxCallDuration}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      maxCallDuration: Number(e.target.value) || 300,
                    }))
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* Capabilities */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Mozliwosci asystenta
              </CardTitle>
              <CardDescription>
                Wybierz co asystent moze robic podczas polaczenia
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                {
                  key: "bookAppointments" as const,
                  label: "Rezerwacja wizyt",
                  desc: "AI moze umawiać wizyty",
                },
                {
                  key: "checkAvailability" as const,
                  label: "Sprawdzanie dostepnosci",
                  desc: "AI moze sprawdzac wolne terminy",
                },
                {
                  key: "cancelAppointments" as const,
                  label: "Odwolywanie wizyt",
                  desc: "AI moze pomoc odwolac wizyte",
                },
                {
                  key: "rescheduleAppointments" as const,
                  label: "Zmiana terminow",
                  desc: "AI moze pomoc zmienic termin",
                },
                {
                  key: "answerFaq" as const,
                  label: "Odpowiadanie na pytania",
                  desc: "AI odpowiada na ogolne pytania o salon",
                },
              ].map((cap) => (
                <div
                  key={cap.key}
                  className="flex items-center justify-between"
                >
                  <div>
                    <Label className="text-base">{cap.label}</Label>
                    <p className="text-sm text-muted-foreground">{cap.desc}</p>
                  </div>
                  <Switch
                    checked={config.capabilities[cap.key]}
                    onCheckedChange={(checked) =>
                      updateCapability(cap.key, checked)
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Transfer to Human */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Przekierowanie do czlowieka
              </CardTitle>
              <CardDescription>
                Gdy AI nie moze pomoc, przekieruj do recepcji
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base">
                    Przekierowywanie do czlowieka
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Pozwol AI na przekierowanie do pracownika salonu
                  </p>
                </div>
                <Switch
                  checked={config.transferToHumanEnabled}
                  onCheckedChange={(checked) =>
                    setConfig((prev) => ({
                      ...prev,
                      transferToHumanEnabled: checked,
                    }))
                  }
                />
              </div>

              {config.transferToHumanEnabled && (
                <div className="space-y-2">
                  <Label htmlFor="transfer-phone">
                    Numer telefonu do recepcji
                  </Label>
                  <Input
                    id="transfer-phone"
                    value={config.transferPhoneNumber}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        transferPhoneNumber: e.target.value,
                      }))
                    }
                    placeholder="+48 123 456 789"
                  />
                </div>
              )}

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-base">
                    Tylko w godzinach pracy
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    AI odpowiada tylko w godzinach otwarcia salonu
                  </p>
                </div>
                <Switch
                  checked={config.businessHoursOnly}
                  onCheckedChange={(checked) =>
                    setConfig((prev) => ({
                      ...prev,
                      businessHoursOnly: checked,
                    }))
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* Save Button */}
          <div className="flex justify-end">
            <Button onClick={saveConfig} disabled={saving} size="lg">
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Zapisz konfiguracje
            </Button>
          </div>
        </TabsContent>

        {/* Call Simulation Tab */}
        <TabsContent value="simulate" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PhoneIncoming className="h-5 w-5 text-green-600" />
                Symulacja polaczenia przychodzacego
              </CardTitle>
              <CardDescription>
                Przetestuj jak AI odpowiada na rozne zapytania klientow
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!config.enabled && (
                <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-200">
                  <XCircle className="h-4 w-4 shrink-0" />
                  Asystent glosowy jest wylaczony. Wlacz go w zakladce
                  Konfiguracja, aby testowac polaczenia.
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="caller-message">
                  Wiadomosc dzwoniacego klienta
                </Label>
                <div className="flex gap-2">
                  <Textarea
                    id="caller-message"
                    value={callerMessage}
                    onChange={(e) => setCallerMessage(e.target.value)}
                    placeholder="Np. Chcialbym umowic sie na strzyzenie na piatek..."
                    rows={2}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        simulateCall();
                      }
                    }}
                  />
                  <Button
                    onClick={simulateCall}
                    disabled={simulating || !callerMessage.trim()}
                    className="shrink-0"
                    size="lg"
                  >
                    {simulating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Quick Test Messages */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">
                  Szybkie testy:
                </Label>
                <div className="flex flex-wrap gap-2">
                  {[
                    "Chce umowic wizyte na strzyzenie",
                    "Jakie macie ceny?",
                    "Czy jest wolny termin w piatek?",
                    "Chce odwolac wizyte",
                    "Chce zmienic termin wizyty",
                    "Polacz mnie z recepcja",
                  ].map((msg) => (
                    <Button
                      key={msg}
                      variant="outline"
                      size="sm"
                      onClick={() => setCallerMessage(msg)}
                      className="text-xs"
                    >
                      {msg}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Call Result */}
          {callResult && (
            <Card className="border-green-200 dark:border-green-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-5 w-5" />
                  Odpowiedz asystenta AI
                </CardTitle>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge variant="secondary">
                    <MessageSquare className="h-3 w-3 mr-1" />
                    {callResult.intentLabel}
                  </Badge>
                  <Badge variant="outline">
                    <Volume2 className="h-3 w-3 mr-1" />
                    {callResult.voiceStyle === "professional"
                      ? "Profesjonalny"
                      : callResult.voiceStyle === "friendly"
                        ? "Przyjazny"
                        : "Ciepaly"}
                  </Badge>
                  {callResult.transferToHuman && (
                    <Badge
                      variant="destructive"
                      className="gap-1"
                    >
                      <PhoneOff className="h-3 w-3" />
                      Przekierowanie do czlowieka
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* AI Greeting */}
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1 font-medium">
                    Powitanie AI:
                  </p>
                  <p className="text-sm italic">{callResult.greeting}</p>
                </div>

                {/* AI Response */}
                <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
                  <p className="text-xs text-primary mb-1 font-medium">
                    Odpowiedz AI:
                  </p>
                  <p className="text-sm leading-relaxed">
                    {callResult.response}
                  </p>
                </div>

                {callResult.suggestedAction && (
                  <div className="text-xs text-muted-foreground">
                    Sugerowana akcja systemu:{" "}
                    <code className="bg-muted px-1 py-0.5 rounded">
                      {callResult.suggestedAction}
                    </code>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Call Log Tab */}
        <TabsContent value="log" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Historia polaczen AI
              </CardTitle>
              <CardDescription>
                Ostatnie polaczenia obsluzone przez asystenta glosowego
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingLog ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : callLog.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <PhoneOff className="h-12 w-12 mx-auto mb-3 opacity-40" />
                  <p>Brak historii polaczen</p>
                  <p className="text-sm">
                    Przetestuj asystenta w zakladce &quot;Symulacja polaczenia&quot;
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {callLog.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-3 border rounded-lg space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">
                            {entry.callerPhone}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {entry.intent}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(entry.timestamp).toLocaleString("pl-PL")}
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="font-medium text-muted-foreground">
                          Klient:
                        </span>{" "}
                        {entry.callerMessage}
                      </div>
                      <div className="text-sm">
                        <span className="font-medium text-primary">AI:</span>{" "}
                        {entry.aiResponse}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function VoiceAiPage() {
  return (
    <ProPlanGate
      featureName="Asystent glosowy AI"
      featureDescription="Asystent glosowy AI automatycznie odbiera polaczenia telefoniczne, umawia wizyty, sprawdza dostepnosc i odpowiada na pytania klientow."
      proBenefits={[
        "Automatyczne odbieranie polaczen telefonicznych 24/7",
        "Naturalna rozmowa w jezyku polskim",
        "Rezerwacja wizyt przez telefon",
        "Sprawdzanie dostepnosci terminow",
        "Odwolywanie i zmiana terminow wizyt",
        "Przekierowanie do recepcji gdy potrzeba",
      ]}
    >
      <VoiceAiContent />
    </ProPlanGate>
  );
}
