"use client";

import {
  Phone,
  Volume2,
  Shield,
  User,
  Save,
  Loader2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VoiceAiConfig } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VoiceSettingsProps {
  config: VoiceAiConfig;
  saving: boolean;
  onConfigChange: (updater: (prev: VoiceAiConfig | null) => VoiceAiConfig | null) => void;
  onSave: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoiceSettings({
  config,
  saving,
  onConfigChange,
  onSave,
}: VoiceSettingsProps) {
  function updateCapability(
    key: keyof VoiceAiConfig["capabilities"],
    value: boolean
  ) {
    onConfigChange((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        capabilities: { ...prev.capabilities, [key]: value },
      };
    });
  }

  return (
    <div className="space-y-6">
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
                onConfigChange((prev) =>
                  prev ? { ...prev, enabled: checked } : prev
                )
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
                onConfigChange((prev) =>
                  prev
                    ? {
                        ...prev,
                        greeting: e.target.value,
                      }
                    : prev
                )
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
                  onConfigChange((prev) =>
                    prev
                      ? {
                          ...prev,
                          voiceStyle: value as VoiceAiConfig["voiceStyle"],
                        }
                      : prev
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="professional">Profesjonalny</SelectItem>
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
                  onConfigChange((prev) =>
                    prev
                      ? {
                          ...prev,
                          language: value as "pl" | "en",
                        }
                      : prev
                  )
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
                onConfigChange((prev) =>
                  prev
                    ? {
                        ...prev,
                        maxCallDuration: Number(e.target.value) || 300,
                      }
                    : prev
                )
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
                onConfigChange((prev) =>
                  prev
                    ? {
                        ...prev,
                        transferToHumanEnabled: checked,
                      }
                    : prev
                )
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
                  onConfigChange((prev) =>
                    prev
                      ? {
                          ...prev,
                          transferPhoneNumber: e.target.value,
                        }
                      : prev
                  )
                }
                placeholder="+48 123 456 789"
              />
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base">Tylko w godzinach pracy</Label>
              <p className="text-sm text-muted-foreground">
                AI odpowiada tylko w godzinach otwarcia salonu
              </p>
            </div>
            <Switch
              checked={config.businessHoursOnly}
              onCheckedChange={(checked) =>
                onConfigChange((prev) =>
                  prev
                    ? {
                        ...prev,
                        businessHoursOnly: checked,
                      }
                    : prev
                )
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={onSave} disabled={saving} size="lg">
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Zapisz konfiguracje
        </Button>
      </div>
    </div>
  );
}
