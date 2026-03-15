"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Gift,
  Save,
  Award,
  Plus,
  Trash2,
  Star,
  CheckCircle,
  ToggleLeft,
  ToggleRight,
  Timer,
  Coins,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";

interface RewardTier {
  id: string;
  name: string;
  pointsRequired: number;
  rewardType: "discount" | "free_service" | "product";
  rewardValue: number;
  description: string;
}

interface LoyaltySettings {
  enabled: boolean;
  pointsPerCurrencyUnit: number;
  currencyUnit: number;
  pointsExpiryDays: number | null;
  rewardTiers: RewardTier[];
}

export default function LoyaltySettingsPage() {
  const { data: session } = useSession();
  const [salonId, setSalonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccessfully, setSavedSuccessfully] = useState(false);

  const [settings, setSettings] = useState<LoyaltySettings>({
    enabled: false,
    pointsPerCurrencyUnit: 1,
    currencyUnit: 1,
    pointsExpiryDays: null,
    rewardTiers: [],
  });

  const [expiryEnabled, setExpiryEnabled] = useState(false);
  const [expiryDaysInput, setExpiryDaysInput] = useState("365");

  // New tier form state
  const [showAddTier, setShowAddTier] = useState(false);
  const [newTier, setNewTier] = useState<Omit<RewardTier, "id">>({
    name: "",
    pointsRequired: 100,
    rewardType: "discount",
    rewardValue: 10,
    description: "",
  });

  // Fetch salon ID
  useEffect(() => {
    async function fetchSalonId() {
      try {
        const res = await fetch("/api/salons");
        const data = await res.json();
        if (data.success && data.data.length > 0) {
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
      } catch {
        setLoading(false);
      }
    }
    if (session?.user) {
      fetchSalonId();
    }
  }, [session]);

  // Fetch loyalty settings
  const fetchSettings = useCallback(async () => {
    if (!salonId) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/salons/${salonId}/loyalty-settings`);
      const data = await res.json();
      if (data.success) {
        setSettings(data.data);
        if (data.data.pointsExpiryDays !== null) {
          setExpiryEnabled(true);
          setExpiryDaysInput(String(data.data.pointsExpiryDays));
        } else {
          setExpiryEnabled(false);
          setExpiryDaysInput("365");
        }
      }
    } catch {
      toast.error("Nie udalo sie zaladowac ustawien");
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
    try {
      setSaving(true);
      const settingsToSave: LoyaltySettings = {
        ...settings,
        pointsExpiryDays: expiryEnabled ? parseInt(expiryDaysInput) || 365 : null,
      };

      const res = await fetch(`/api/salons/${salonId}/loyalty-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsToSave),
      });
      const data = await res.json();
      if (data.success) {
        setSettings(data.data);
        if (data.data.pointsExpiryDays !== null) {
          setExpiryEnabled(true);
          setExpiryDaysInput(String(data.data.pointsExpiryDays));
        }
        toast.success(data.message || "Ustawienia zapisane");
        setSavedSuccessfully(true);
        setTimeout(() => setSavedSuccessfully(false), 3000);
      } else {
        toast.error(data.error || "Nie udalo sie zapisac ustawien");
      }
    } catch {
      toast.error("Blad zapisu ustawien");
    } finally {
      setSaving(false);
    }
  };

  // Add reward tier
  const handleAddTier = () => {
    if (!newTier.name.trim()) {
      toast.error("Podaj nazwe nagrody");
      return;
    }
    if (newTier.pointsRequired < 1) {
      toast.error("Minimalna liczba punktow to 1");
      return;
    }
    if (newTier.rewardValue < 1) {
      toast.error("Wartosc nagrody musi byc wieksza niz 0");
      return;
    }

    const tier: RewardTier = {
      ...newTier,
      id: crypto.randomUUID(),
    };
    setSettings((prev) => ({
      ...prev,
      rewardTiers: [...prev.rewardTiers, tier].sort(
        (a, b) => a.pointsRequired - b.pointsRequired
      ),
    }));
    setNewTier({
      name: "",
      pointsRequired: 100,
      rewardType: "discount",
      rewardValue: 10,
      description: "",
    });
    setShowAddTier(false);
    toast.success(`Dodano nagrode: ${tier.name}`);
  };

  // Remove reward tier
  const handleRemoveTier = (tierId: string) => {
    setSettings((prev) => ({
      ...prev,
      rewardTiers: prev.rewardTiers.filter((t) => t.id !== tierId),
    }));
    toast.success("Nagroda usunieta");
  };

  const getRewardTypeLabel = (type: string) => {
    switch (type) {
      case "discount":
        return "Rabat procentowy";
      case "free_service":
        return "Darmowa usluga";
      case "product":
        return "Produkt gratis";
      default:
        return type;
    }
  };

  const getRewardValueDisplay = (tier: RewardTier) => {
    switch (tier.rewardType) {
      case "discount":
        return `${tier.rewardValue}% rabatu`;
      case "free_service":
        return `Do ${tier.rewardValue} PLN`;
      case "product":
        return `Do ${tier.rewardValue} PLN`;
      default:
        return `${tier.rewardValue}`;
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex justify-center items-center h-64">
          <p className="text-muted-foreground">Ladowanie ustawien...</p>
        </div>
      </div>
    );
  }

  if (!salonId) {
    return (
      <div className="container mx-auto p-6">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-2">Brak salonu</h1>
          <p className="text-muted-foreground">
            Nie znaleziono salonu. Utwórz salon, aby skonfigurowac program lojalnosciowy.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Gift className="w-8 h-8 text-primary" />
            Program lojalnosciowy
          </h1>
          <p className="text-muted-foreground mt-1">
            Konfiguracja systemu punktow i nagrod dla klientow
          </p>
        </div>
      </div>

      {/* Enable/Disable Toggle */}
      <div className="border border-border rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {settings.enabled ? (
              <ToggleRight className="w-6 h-6 text-green-500" />
            ) : (
              <ToggleLeft className="w-6 h-6 text-muted-foreground" />
            )}
            <div>
              <h2 className="text-xl font-semibold">
                {settings.enabled ? "Program aktywny" : "Program nieaktywny"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {settings.enabled
                  ? "Klienci zbieraja punkty za wizyty"
                  : "Wlacz program, aby klienci mogli zbierac punkty"}
              </p>
            </div>
          </div>
          <Button
            variant={settings.enabled ? "destructive" : "default"}
            onClick={() =>
              setSettings((prev) => ({ ...prev, enabled: !prev.enabled }))
            }
          >
            {settings.enabled ? "Wylacz" : "Wlacz program"}
          </Button>
        </div>
      </div>

      {/* Points Configuration */}
      <div className="border border-border rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Coins className="w-5 h-5 text-primary" />
          Konfiguracja punktow
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <Label htmlFor="pointsPerUnit">Punkty za jednostke walutowa</Label>
            <p className="text-sm text-muted-foreground mb-2">
              Ile punktow klient otrzymuje
            </p>
            <Input
              id="pointsPerUnit"
              type="number"
              min={1}
              max={100}
              value={settings.pointsPerCurrencyUnit}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  pointsPerCurrencyUnit: parseInt(e.target.value) || 1,
                }))
              }
            />
          </div>
          <div>
            <Label htmlFor="currencyUnit">Za kazde (PLN)</Label>
            <p className="text-sm text-muted-foreground mb-2">
              Za ile PLN wydanych przyznawany jest punkt
            </p>
            <Input
              id="currencyUnit"
              type="number"
              min={1}
              max={100}
              value={settings.currencyUnit}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  currencyUnit: parseInt(e.target.value) || 1,
                }))
              }
            />
          </div>
        </div>

        <div className="mt-4 p-3 bg-muted rounded-md">
          <p className="text-sm">
            <Star className="w-4 h-4 inline mr-1 text-yellow-500" />
            Przyklad: Klient placi <strong>100 PLN</strong> za wizyte i otrzymuje{" "}
            <strong>
              {Math.floor(100 / settings.currencyUnit) * settings.pointsPerCurrencyUnit}{" "}
              punktow
            </strong>
          </p>
        </div>
      </div>

      {/* Points Expiry */}
      <div className="border border-border rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Timer className="w-5 h-5 text-primary" />
          Waznosc punktow
        </h2>

        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-medium">Czy punkty wygasaja?</p>
            <p className="text-sm text-muted-foreground">
              {expiryEnabled
                ? "Punkty wygasna po okreslonym czasie"
                : "Punkty nigdy nie wygasaja"}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setExpiryEnabled(!expiryEnabled)}
          >
            {expiryEnabled ? "Wylacz wygasanie" : "Wlacz wygasanie"}
          </Button>
        </div>

        {expiryEnabled && (
          <div>
            <Label htmlFor="expiryDays">Waznosc punktow (dni)</Label>
            <p className="text-sm text-muted-foreground mb-2">
              Po ilu dniach bezczynnosci punkty wygasaja (min. 30, max. 3650)
            </p>
            <Input
              id="expiryDays"
              type="number"
              min={30}
              max={3650}
              value={expiryDaysInput}
              onChange={(e) => setExpiryDaysInput(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Reward Tiers */}
      <div className="border border-border rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Award className="w-5 h-5 text-primary" />
            Nagrody ({settings.rewardTiers.length})
          </h2>
          <Button
            variant="outline"
            onClick={() => setShowAddTier(!showAddTier)}
          >
            <Plus className="w-4 h-4 mr-1" />
            Dodaj nagrode
          </Button>
        </div>

        {/* Add Tier Form */}
        {showAddTier && (
          <div className="border border-dashed border-border rounded-lg p-4 mb-4 bg-muted/30">
            <h3 className="font-medium mb-3">Nowa nagroda</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <Label htmlFor="tierName">Nazwa nagrody</Label>
                <Input
                  id="tierName"
                  placeholder="np. Rabat 10%"
                  value={newTier.name}
                  onChange={(e) =>
                    setNewTier((prev) => ({ ...prev, name: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="tierPoints">Wymagane punkty</Label>
                <Input
                  id="tierPoints"
                  type="number"
                  min={1}
                  value={newTier.pointsRequired}
                  onChange={(e) =>
                    setNewTier((prev) => ({
                      ...prev,
                      pointsRequired: parseInt(e.target.value) || 1,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="tierType">Typ nagrody</Label>
                <select
                  id="tierType"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={newTier.rewardType}
                  onChange={(e) =>
                    setNewTier((prev) => ({
                      ...prev,
                      rewardType: e.target.value as RewardTier["rewardType"],
                    }))
                  }
                >
                  <option value="discount">Rabat procentowy</option>
                  <option value="free_service">Darmowa usluga</option>
                  <option value="product">Produkt gratis</option>
                </select>
              </div>
              <div>
                <Label htmlFor="tierValue">
                  {newTier.rewardType === "discount"
                    ? "Rabat (%)"
                    : "Wartosc (PLN)"}
                </Label>
                <Input
                  id="tierValue"
                  type="number"
                  min={1}
                  value={newTier.rewardValue}
                  onChange={(e) =>
                    setNewTier((prev) => ({
                      ...prev,
                      rewardValue: parseInt(e.target.value) || 1,
                    }))
                  }
                />
              </div>
            </div>
            <div className="mb-4">
              <Label htmlFor="tierDescription">Opis (opcjonalnie)</Label>
              <Input
                id="tierDescription"
                placeholder="Opis nagrody..."
                value={newTier.description}
                onChange={(e) =>
                  setNewTier((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleAddTier}>
                <Plus className="w-4 h-4 mr-1" />
                Dodaj
              </Button>
              <Button variant="outline" onClick={() => setShowAddTier(false)}>
                Anuluj
              </Button>
            </div>
          </div>
        )}

        {/* Tier List */}
        {settings.rewardTiers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Award className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p>Brak nagrod. Dodaj pierwsza nagrode.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {settings.rewardTiers.map((tier) => (
              <div
                key={tier.id}
                className="flex items-center justify-between p-4 border border-border rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
                    <Award className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{tier.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {tier.pointsRequired} pkt &middot;{" "}
                      {getRewardTypeLabel(tier.rewardType)} &middot;{" "}
                      {getRewardValueDisplay(tier)}
                    </p>
                    {tier.description && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {tier.description}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleRemoveTier(tier.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Powrot do dashboardu
          </Link>
        </Button>
        <Button onClick={handleSave} disabled={saving} size="lg">
          {saving ? (
            "Zapisywanie..."
          ) : savedSuccessfully ? (
            <>
              <CheckCircle className="w-4 h-4 mr-2" />
              Zapisano
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Zapisz ustawienia
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
