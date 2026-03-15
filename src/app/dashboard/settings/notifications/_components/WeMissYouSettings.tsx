"use client";

import {
  UserX,
  Calendar,
  MessageSquare,
  Link2,
  Save,
  ToggleLeft,
  ToggleRight,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WeMissYouSettings as WeMissYouSettingsType } from "../_types";

interface WeMissYouSettingsProps {
  settings: WeMissYouSettingsType;
  saving: boolean;
  savedSuccessfully: boolean;
  onUpdateSetting: <K extends keyof WeMissYouSettingsType>(
    key: K,
    value: WeMissYouSettingsType[K],
  ) => void;
  onSave: () => Promise<void>;
}

export function WeMissYouSettings({
  settings,
  saving,
  savedSuccessfully,
  onUpdateSetting,
  onSave,
}: WeMissYouSettingsProps) {
  return (
    <div
      className="mt-6 border rounded-lg p-6 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
      data-testid="we-miss-you-settings"
    >
      <div className="flex items-center gap-2 mb-4">
        <UserX className="w-5 h-5 text-amber-600" />
        <h2 className="text-xl font-semibold text-amber-800 dark:text-amber-300">
          Powiadomienia &quot;Tesknimy&quot;
        </h2>
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        Skonfiguruj automatyczne powiadomienia re-engagement dla klientow,
        ktorzy dawno nie odwiedzili salonu. Zachecaj ich do powrotu!
      </p>

      <div className="space-y-6">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-lg border">
          <div className="flex items-center gap-3">
            {settings.enabled ? (
              <ToggleRight className="w-6 h-6 text-green-600" />
            ) : (
              <ToggleLeft className="w-6 h-6 text-gray-400" />
            )}
            <div>
              <div
                className="font-medium"
                data-testid="we-miss-you-enabled-label"
              >
                Powiadomienia re-engagement
              </div>
              <div className="text-sm text-muted-foreground">
                {settings.enabled
                  ? "Wlaczone - nieaktywni klienci otrzymaja wiadomosc"
                  : "Wylaczone - brak powiadomien re-engagement"}
              </div>
            </div>
          </div>
          <Button
            variant={settings.enabled ? "default" : "outline"}
            size="sm"
            onClick={() => onUpdateSetting("enabled", !settings.enabled)}
            data-testid="we-miss-you-toggle-btn"
            className={
              settings.enabled
                ? "bg-green-600 hover:bg-green-700 text-white"
                : ""
            }
          >
            {settings.enabled ? "Wlaczone" : "Wylaczone"}
          </Button>
        </div>

        {/* Inactive Period Threshold */}
        <div className="p-4 bg-white dark:bg-gray-900 rounded-lg border">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-5 h-5 text-amber-600" />
            <label htmlFor="inactive-days" className="font-medium">
              Prog nieaktywnosci (dni)
            </label>
          </div>
          <div className="flex items-center gap-3">
            <input
              id="inactive-days"
              type="number"
              min="1"
              max="365"
              value={settings.inactiveDays}
              onChange={(e) =>
                onUpdateSetting(
                  "inactiveDays",
                  Math.max(1, Math.min(365, parseInt(e.target.value) || 30)),
                )
              }
              className="w-24 border rounded-md px-3 py-2 text-sm bg-background"
              data-testid="inactive-days-input"
            />
            <span className="text-muted-foreground">dni</span>
            <span className="text-sm text-muted-foreground">
              (klient bez wizyty przez {settings.inactiveDays} dni zostanie
              powiadomiony)
            </span>
          </div>
          {/* Quick presets */}
          <div className="flex gap-2 mt-3">
            {[14, 30, 60, 90, 180].map((days) => (
              <button
                key={days}
                onClick={() => onUpdateSetting("inactiveDays", days)}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  settings.inactiveDays === days
                    ? "bg-amber-600 text-white border-amber-600"
                    : "border-gray-300 dark:border-gray-600 hover:border-amber-400"
                }`}
                data-testid={`inactive-preset-${days}`}
              >
                {days} dni
              </button>
            ))}
          </div>
        </div>

        {/* Custom Message Template */}
        <div className="p-4 bg-white dark:bg-gray-900 rounded-lg border">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-5 h-5 text-amber-600" />
            <label htmlFor="we-miss-you-message" className="font-medium">
              Tresc wiadomosci
            </label>
          </div>
          <textarea
            id="we-miss-you-message"
            value={settings.customMessage}
            onChange={(e) => onUpdateSetting("customMessage", e.target.value)}
            rows={3}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background resize-none"
            data-testid="we-miss-you-message-input"
          />
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="text-xs text-muted-foreground">
              Dostepne zmienne:
            </span>
            <code className="text-xs bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded text-amber-700 dark:text-amber-300">
              {"{imie}"}
            </code>
            <code className="text-xs bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded text-amber-700 dark:text-amber-300">
              {"{nazwisko}"}
            </code>
            <code className="text-xs bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded text-amber-700 dark:text-amber-300">
              {"{salon}"}
            </code>
            <code className="text-xs bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded text-amber-700 dark:text-amber-300">
              {"{dni}"}
            </code>
          </div>
        </div>

        {/* Include Booking Link Toggle */}
        <div className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-lg border">
          <div className="flex items-center gap-3">
            <Link2 className="w-5 h-5 text-amber-600" />
            <div>
              <div className="font-medium">Link do rezerwacji</div>
              <div className="text-sm text-muted-foreground">
                {settings.includeBookingLink
                  ? "Wiadomosc bedzie zawierac link do rezerwacji online"
                  : "Brak linku do rezerwacji w wiadomosci"}
              </div>
            </div>
          </div>
          <Button
            variant={settings.includeBookingLink ? "default" : "outline"}
            size="sm"
            onClick={() =>
              onUpdateSetting(
                "includeBookingLink",
                !settings.includeBookingLink,
              )
            }
            data-testid="include-booking-link-toggle-btn"
            className={
              settings.includeBookingLink
                ? "bg-green-600 hover:bg-green-700 text-white"
                : ""
            }
          >
            {settings.includeBookingLink ? "Wlaczone" : "Wylaczone"}
          </Button>
        </div>

        {/* Auto-send Toggle */}
        <div className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-lg border">
          <div className="flex items-center gap-3">
            {settings.autoSend ? (
              <ToggleRight className="w-6 h-6 text-green-600" />
            ) : (
              <ToggleLeft className="w-6 h-6 text-gray-400" />
            )}
            <div>
              <div className="font-medium">Automatyczne wysylanie</div>
              <div className="text-sm text-muted-foreground">
                {settings.autoSend
                  ? "Powiadomienia beda wysylane automatycznie co tydzien"
                  : "Powiadomienia musisz wyslac recznie ze strony powiadomien"}
              </div>
            </div>
          </div>
          <Button
            variant={settings.autoSend ? "default" : "outline"}
            size="sm"
            onClick={() => onUpdateSetting("autoSend", !settings.autoSend)}
            data-testid="we-miss-you-auto-send-toggle-btn"
            className={
              settings.autoSend
                ? "bg-green-600 hover:bg-green-700 text-white"
                : ""
            }
          >
            {settings.autoSend ? "Wlaczone" : "Wylaczone"}
          </Button>
        </div>

        {/* Preview Section */}
        {settings.enabled && (
          <div className="p-4 bg-white dark:bg-gray-900 rounded-lg border border-dashed border-amber-300">
            <div className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-2">
              Podglad wiadomosci:
            </div>
            <div className="text-sm text-foreground bg-amber-50 dark:bg-amber-950/20 p-3 rounded">
              {settings.customMessage
                .replace("{imie}", "Anna")
                .replace("{nazwisko}", "Kowalska")
                .replace("{salon}", "Salon Pieknosci")
                .replace("{dni}", String(settings.inactiveDays))}
              {settings.includeBookingLink && (
                <span className="text-amber-600">
                  {" "}
                  Zarezerwuj teraz:{" "}
                  {process.env.NEXT_PUBLIC_APP_URL || ""}/salons/example/book
                </span>
              )}
            </div>
          </div>
        )}

        {/* Save Button */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            onClick={onSave}
            disabled={saving}
            className="bg-amber-600 hover:bg-amber-700 text-white"
            data-testid="save-we-miss-you-settings-btn"
          >
            {saving ? (
              "Zapisywanie..."
            ) : savedSuccessfully ? (
              <>
                <CheckCircle className="w-4 h-4 mr-1" />
                Zapisano!
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-1" />
                Zapisz ustawienia
              </>
            )}
          </Button>
          {savedSuccessfully && (
            <span
              className="text-sm text-green-600 font-medium"
              data-testid="we-miss-you-save-success-message"
            >
              Ustawienia zostaly zapisane pomyslnie
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
