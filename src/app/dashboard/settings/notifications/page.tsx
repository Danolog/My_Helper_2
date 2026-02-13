"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Cake,
  Gift,
  Save,
  Settings,
  Percent,
  Package,
  MessageSquare,
  ToggleLeft,
  ToggleRight,
  CheckCircle,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";

interface BirthdaySettings {
  enabled: boolean;
  giftType: "discount" | "product";
  discountPercentage: number;
  productName: string;
  customMessage: string;
  autoSend: boolean;
}

export default function NotificationSettingsPage() {
  const { data: session } = useSession();
  const [salonId, setSalonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<BirthdaySettings>({
    enabled: false,
    giftType: "discount",
    discountPercentage: 10,
    productName: "",
    customMessage:
      "Wszystkiego najlepszego z okazji urodzin, {imie}! {salon} zyczy Ci wspanialego dnia!",
    autoSend: false,
  });
  const [savedSuccessfully, setSavedSuccessfully] = useState(false);

  // Fetch salon ID - prefer salon owned by current user
  useEffect(() => {
    async function fetchSalonId() {
      try {
        const res = await fetch("/api/salons");
        const data = await res.json();
        if (data.success && data.data.length > 0) {
          // Try to find a salon owned by the current user
          const userId = session?.user?.id;
          const userSalon = userId
            ? data.data.find(
                (s: { ownerId: string | null }) => s.ownerId === userId
              )
            : null;
          setSalonId(userSalon ? userSalon.id : data.data[0].id);
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to fetch salon:", err);
        setLoading(false);
      }
    }
    if (session?.user) {
      fetchSalonId();
    }
  }, [session]);

  // Fetch birthday settings when salonId is available
  const fetchSettings = useCallback(async () => {
    if (!salonId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/salons/${salonId}/birthday-settings`);
      const data = await res.json();
      if (data.success) {
        setSettings(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch birthday settings:", err);
      toast.error("Nie mozna zaladowac ustawien urodzinowych");
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  useEffect(() => {
    if (salonId) {
      fetchSettings();
    }
  }, [salonId, fetchSettings]);

  // Save settings
  const handleSave = async () => {
    if (!salonId) return;
    setSaving(true);
    setSavedSuccessfully(false);
    try {
      const res = await fetch(`/api/salons/${salonId}/birthday-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Ustawienia zapisane!");
        setSavedSuccessfully(true);
        // Auto-hide the success indicator after 3 seconds
        setTimeout(() => setSavedSuccessfully(false), 3000);
      } else {
        toast.error(data.error || "Blad zapisywania ustawien");
      }
    } catch (err) {
      console.error("Failed to save birthday settings:", err);
      toast.error("Blad zapisywania ustawien");
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = <K extends keyof BirthdaySettings>(
    key: K,
    value: BirthdaySettings[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSavedSuccessfully(false);
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex justify-center items-center py-12">
          <div className="text-muted-foreground">Ladowanie ustawien...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Dashboard
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <Settings className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Ustawienia powiadomien</h1>
      </div>

      {/* Birthday Gift Configuration Section */}
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

        {/* Enable/Disable Toggle */}
        <div className="space-y-6">
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
              onClick={() => updateSetting("enabled", !settings.enabled)}
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
                onClick={() => updateSetting("giftType", "discount")}
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
                onClick={() => updateSetting("giftType", "product")}
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
                    updateSetting(
                      "discountPercentage",
                      Math.max(1, Math.min(100, parseInt(e.target.value) || 1))
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
                    onClick={() => updateSetting("discountPercentage", pct)}
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
                onChange={(e) => updateSetting("productName", e.target.value)}
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
              onChange={(e) => updateSetting("customMessage", e.target.value)}
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
              onClick={() => updateSetting("autoSend", !settings.autoSend)}
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
              onClick={handleSave}
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

      {/* Link to notifications page */}
      <div className="mt-6 p-4 border rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Powiadomienia urodzinowe</div>
            <div className="text-sm text-muted-foreground">
              Przejdz do strony powiadomien, aby wyslac lub sprawdzic zyczenia
              urodzinowe
            </div>
          </div>
          <Button variant="outline" asChild>
            <Link href="/dashboard/notifications">
              <MessageSquare className="w-4 h-4 mr-1" />
              Powiadomienia
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
