"use client";

import {
  Cake,
  Gift,
  Save,
  Percent,
  Package,
  MessageSquare,
  ToggleLeft,
  ToggleRight,
  CheckCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BirthdaySettings as BirthdaySettingsType } from "../_types";

interface BirthdaySettingsProps {
  settings: BirthdaySettingsType;
  saving: boolean;
  savedSuccessfully: boolean;
  onUpdateSetting: <K extends keyof BirthdaySettingsType>(
    key: K,
    value: BirthdaySettingsType[K],
  ) => void;
  onSave: () => Promise<void>;
}

export function BirthdaySettings({
  settings,
  saving,
  savedSuccessfully,
  onUpdateSetting,
  onSave,
}: BirthdaySettingsProps) {
  return (
    <div
      className="border rounded-lg p-6 bg-pink-50 dark:bg-pink-950/20 border-pink-200 dark:border-pink-800"
      data-testid="birthday-gift-settings"
    >
      <div className="flex items-center gap-2 mb-4">
        <Cake className="w-5 h-5 text-pink-600" />
        <h2 className="text-xl font-semibold text-pink-800 dark:text-pink-300">
          Konfiguracja prezentu urodzinowego
        </h2>
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        Skonfiguruj prezenty i rabaty urodzinowe dla swoich klientow. Ustawienia
        beda automatycznie stosowane przy wysylaniu powiadomien urodzinowych.
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
              <div className="font-medium" data-testid="birthday-enabled-label">
                Powiadomienia urodzinowe
              </div>
              <div className="text-sm text-muted-foreground">
                {settings.enabled
                  ? "Wlaczone - klienci otrzymaja zyczenia i prezenty"
                  : "Wylaczone - brak powiadomien urodzinowych"}
              </div>
            </div>
          </div>
          <Button
            variant={settings.enabled ? "default" : "outline"}
            size="sm"
            onClick={() => onUpdateSetting("enabled", !settings.enabled)}
            data-testid="birthday-toggle-btn"
            className={
              settings.enabled
                ? "bg-green-600 hover:bg-green-700 text-white"
                : ""
            }
          >
            {settings.enabled ? "Wlaczone" : "Wylaczone"}
          </Button>
        </div>

        {/* Gift Type Selection */}
        <div className="p-4 bg-white dark:bg-gray-900 rounded-lg border">
          <div className="flex items-center gap-2 mb-3">
            <Gift className="w-5 h-5 text-pink-600" />
            <span className="font-medium">Typ prezentu</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => onUpdateSetting("giftType", "discount")}
              data-testid="gift-type-discount"
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                settings.giftType === "discount"
                  ? "border-pink-500 bg-pink-50 dark:bg-pink-950/30"
                  : "border-gray-200 dark:border-gray-700 hover:border-pink-300"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Percent className="w-5 h-5 text-pink-600" />
                <span className="font-medium">Rabat procentowy</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Zaoferuj znizkowy rabat na nastepna wizyte
              </p>
            </button>
            <button
              onClick={() => onUpdateSetting("giftType", "product")}
              data-testid="gift-type-product"
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                settings.giftType === "product"
                  ? "border-pink-500 bg-pink-50 dark:bg-pink-950/30"
                  : "border-gray-200 dark:border-gray-700 hover:border-pink-300"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Package className="w-5 h-5 text-pink-600" />
                <span className="font-medium">Darmowy produkt/usluga</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Podaruj darmowy produkt lub zabiegu
              </p>
            </button>
          </div>
        </div>

        {/* Discount Percentage (shown when giftType === 'discount') */}
        {settings.giftType === "discount" && (
          <div className="p-4 bg-white dark:bg-gray-900 rounded-lg border">
            <div className="flex items-center gap-2 mb-3">
              <Percent className="w-5 h-5 text-pink-600" />
              <label htmlFor="discount-percentage" className="font-medium">
                Procent rabatu
              </label>
            </div>
            <div className="flex items-center gap-3">
              <input
                id="discount-percentage"
                type="number"
                min="1"
                max="100"
                value={settings.discountPercentage}
                onChange={(e) =>
                  onUpdateSetting(
                    "discountPercentage",
                    Math.max(1, Math.min(100, parseInt(e.target.value) || 1)),
                  )
                }
                className="w-24 border rounded-md px-3 py-2 text-sm bg-background"
                data-testid="discount-percentage-input"
              />
              <span className="text-muted-foreground">%</span>
              <span className="text-sm text-muted-foreground">
                (np. {settings.discountPercentage}% rabatu na nastepna wizyte)
              </span>
            </div>
            {/* Quick presets */}
            <div className="flex gap-2 mt-3">
              {[5, 10, 15, 20, 25].map((pct) => (
                <button
                  key={pct}
                  onClick={() => onUpdateSetting("discountPercentage", pct)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    settings.discountPercentage === pct
                      ? "bg-pink-600 text-white border-pink-600"
                      : "border-gray-300 dark:border-gray-600 hover:border-pink-400"
                  }`}
                  data-testid={`preset-${pct}`}
                >
                  {pct}%
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Product Name (shown when giftType === 'product') */}
        {settings.giftType === "product" && (
          <div className="p-4 bg-white dark:bg-gray-900 rounded-lg border">
            <div className="flex items-center gap-2 mb-3">
              <Package className="w-5 h-5 text-pink-600" />
              <label htmlFor="product-name" className="font-medium">
                Nazwa produktu/uslugi
              </label>
            </div>
            <input
              id="product-name"
              type="text"
              value={settings.productName}
              onChange={(e) => onUpdateSetting("productName", e.target.value)}
              placeholder="np. Darmowy zabieg pielegnacyjny, Maska regenerujaca"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              data-testid="product-name-input"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Podaj nazwe produktu lub uslugi, ktora klient otrzyma jako prezent
              urodzinowy.
            </p>
          </div>
        )}

        {/* Custom Message Template */}
        <div className="p-4 bg-white dark:bg-gray-900 rounded-lg border">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-5 h-5 text-pink-600" />
            <label htmlFor="custom-message" className="font-medium">
              Tresc wiadomosci urodzinowej
            </label>
          </div>
          <textarea
            id="custom-message"
            value={settings.customMessage}
            onChange={(e) => onUpdateSetting("customMessage", e.target.value)}
            rows={3}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background resize-none"
            data-testid="custom-message-input"
          />
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="text-xs text-muted-foreground">
              Dostepne zmienne:
            </span>
            <code className="text-xs bg-pink-100 dark:bg-pink-900/30 px-1.5 py-0.5 rounded text-pink-700 dark:text-pink-300">
              {"{imie}"}
            </code>
            <code className="text-xs bg-pink-100 dark:bg-pink-900/30 px-1.5 py-0.5 rounded text-pink-700 dark:text-pink-300">
              {"{nazwisko}"}
            </code>
            <code className="text-xs bg-pink-100 dark:bg-pink-900/30 px-1.5 py-0.5 rounded text-pink-700 dark:text-pink-300">
              {"{salon}"}
            </code>
          </div>
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
                  ? "Wiadomosci beda wysylane automatycznie rano w dniu urodzin"
                  : "Wiadomosci musisz wyslac recznie ze strony powiadomien"}
              </div>
            </div>
          </div>
          <Button
            variant={settings.autoSend ? "default" : "outline"}
            size="sm"
            onClick={() => onUpdateSetting("autoSend", !settings.autoSend)}
            data-testid="auto-send-toggle-btn"
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
          <div className="p-4 bg-white dark:bg-gray-900 rounded-lg border border-dashed border-pink-300">
            <div className="text-sm font-medium text-pink-700 dark:text-pink-300 mb-2">
              Podglad wiadomosci:
            </div>
            <div className="text-sm text-foreground bg-pink-50 dark:bg-pink-950/20 p-3 rounded">
              {settings.customMessage
                .replace("{imie}", "Anna")
                .replace("{nazwisko}", "Kowalska")
                .replace("{salon}", "Salon Piękności")}
              {settings.giftType === "discount" &&
                settings.discountPercentage > 0 && (
                  <span>
                    {" "}
                    Z tej okazji przygotowalismy dla Ciebie{" "}
                    {settings.discountPercentage}% rabatu na nastepna wizyte.
                    Zapraszamy!
                  </span>
                )}
              {settings.giftType === "product" && settings.productName && (
                <span>
                  {" "}
                  Z tej okazji przygotowalismy dla Ciebie prezent:{" "}
                  {settings.productName}. Zapraszamy!
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
            className="bg-pink-600 hover:bg-pink-700 text-white"
            data-testid="save-birthday-settings-btn"
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
              data-testid="save-success-message"
            >
              Ustawienia zostaly zapisane pomyslnie
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
