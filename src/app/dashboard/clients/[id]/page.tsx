"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Lock,
  ArrowLeft,
  User,
  Phone,
  Mail,
  StickyNote,
  AlertTriangle,
  Plus,
  X,
  Save,
  Heart,
} from "lucide-react";
import { toast } from "sonner";

interface ClientData {
  id: string;
  salonId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  preferences: string | null;
  allergies: string | null;
  favoriteEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Parses the comma-separated allergies string into an array of trimmed,
 * non-empty allergy entries.
 */
function parseAllergies(allergiesStr: string | null): string[] {
  if (!allergiesStr) return [];
  return allergiesStr
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

/**
 * Serializes an array of allergy strings back to a comma-separated string,
 * or null if the array is empty.
 */
function serializeAllergies(allergies: string[]): string | null {
  if (allergies.length === 0) return null;
  return allergies.join(", ");
}

export default function ClientProfilePage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.id as string;
  const { data: session, isPending } = useSession();

  const [client, setClient] = useState<ClientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable form fields
  const [formNotes, setFormNotes] = useState("");
  const [formPreferences, setFormPreferences] = useState("");
  const [allergiesList, setAllergiesList] = useState<string[]>([]);
  const [newAllergyInput, setNewAllergyInput] = useState("");

  const fetchClient = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}`);
      const data = await res.json();
      if (data.success) {
        const clientData = data.data as ClientData;
        setClient(clientData);
        setFormNotes(clientData.notes || "");
        setFormPreferences(clientData.preferences || "");
        setAllergiesList(parseAllergies(clientData.allergies));
      } else {
        toast.error("Nie znaleziono klienta");
        router.push("/dashboard/clients");
      }
    } catch (error) {
      console.error("Failed to fetch client:", error);
      toast.error("Blad podczas ladowania danych klienta");
    } finally {
      setLoading(false);
    }
  }, [clientId, router]);

  useEffect(() => {
    fetchClient();
  }, [fetchClient]);

  const handleAddAllergy = () => {
    const trimmed = newAllergyInput.trim();
    if (!trimmed) {
      toast.error("Wpisz nazwe alergii");
      return;
    }
    // Prevent duplicate entries (case-insensitive check)
    if (allergiesList.some((a) => a.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("Ta alergia jest juz na liscie");
      return;
    }
    setAllergiesList((prev) => [...prev, trimmed]);
    setNewAllergyInput("");
  };

  const handleRemoveAllergy = (index: number) => {
    setAllergiesList((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAllergyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddAllergy();
    }
  };

  const handleSave = async () => {
    if (!client) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: formNotes.trim() || null,
          preferences: formPreferences.trim() || null,
          allergies: serializeAllergies(allergiesList),
        }),
      });

      const data = await res.json();

      if (data.success) {
        setClient(data.data as ClientData);
        toast.success("Dane klienta zostaly zapisane");
      } else {
        toast.error(data.error || "Nie udalo sie zapisac danych klienta");
      }
    } catch (error) {
      console.error("Failed to save client:", error);
      toast.error("Blad podczas zapisywania danych klienta");
    } finally {
      setSaving(false);
    }
  };

  if (isPending || loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Wymagane logowanie</h1>
          <p className="text-muted-foreground mb-6">
            Musisz sie zalogowac, aby zarzadzac klientami
          </p>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <p className="text-muted-foreground">Nie znaleziono klienta</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Header with back button */}
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push("/dashboard/clients")}
          data-testid="back-to-clients-btn"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3 flex-1">
          <User className="w-8 h-8 text-primary" />
          <div>
            <h1
              className="text-2xl font-bold"
              data-testid="client-profile-name"
            >
              {client.firstName} {client.lastName}
            </h1>
            <p className="text-muted-foreground text-sm">Profil klienta</p>
          </div>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          data-testid="save-client-btn"
        >
          <Save className="h-4 w-4 mr-2" />
          {saving ? "Zapisywanie..." : "Zapisz zmiany"}
        </Button>
      </div>

      {/* Allergy warning banner - displayed prominently when allergies exist */}
      {allergiesList.length > 0 && (
        <div
          className="flex items-start gap-3 p-4 mb-6 rounded-lg border border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30"
          data-testid="allergy-warning-banner"
        >
          <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-orange-800 dark:text-orange-300">
              Uwaga - alergie klienta
            </p>
            <p className="text-sm text-orange-700 dark:text-orange-400 mt-1">
              {allergiesList.join(", ")}
            </p>
          </div>
        </div>
      )}

      {/* Client info card */}
      <Card className="mb-6" data-testid="client-info-card">
        <CardHeader>
          <CardTitle className="text-lg">Dane kontaktowe</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-medium">
                {client.firstName} {client.lastName}
              </span>
            </div>
            {client.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                <span data-testid="client-phone">{client.phone}</span>
              </div>
            )}
            {client.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                <span data-testid="client-email">{client.email}</span>
              </div>
            )}
            {!client.phone && !client.email && (
              <p className="text-sm text-muted-foreground col-span-2">
                Brak danych kontaktowych
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Health & Preferences section */}
      <Card className="mb-6" data-testid="health-preferences-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Heart className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">
              Zdrowie i preferencje
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Allergies section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <Label className="text-base font-medium">Alergie</Label>
            </div>

            {allergiesList.length === 0 ? (
              <p
                className="text-sm text-muted-foreground mb-3"
                data-testid="no-allergies-message"
              >
                Brak alergii
              </p>
            ) : (
              <div
                className="flex flex-wrap gap-2 mb-3"
                data-testid="allergies-list"
              >
                {allergiesList.map((allergy, index) => (
                  <Badge
                    key={`${allergy}-${index}`}
                    variant="destructive"
                    className="flex items-center gap-1 px-3 py-1"
                    data-testid={`allergy-badge-${index}`}
                  >
                    {allergy}
                    <button
                      type="button"
                      onClick={() => handleRemoveAllergy(index)}
                      className="ml-1 hover:bg-destructive/80 rounded-full p-0.5"
                      aria-label={`Usun alergie: ${allergy}`}
                      data-testid={`remove-allergy-${index}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Add allergy form */}
            <div className="flex items-center gap-2">
              <Input
                placeholder="np. Latex, Parafenylodiamina (PPD)"
                value={newAllergyInput}
                onChange={(e) => setNewAllergyInput(e.target.value)}
                onKeyDown={handleAllergyKeyDown}
                className="max-w-sm"
                data-testid="new-allergy-input"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddAllergy}
                data-testid="add-allergy-btn"
              >
                <Plus className="h-4 w-4 mr-1" />
                Dodaj alergie
              </Button>
            </div>
          </div>

          <Separator />

          {/* Preferences */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <StickyNote className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="client-preferences" className="text-base font-medium">
                Preferencje klienta
              </Label>
            </div>
            <Textarea
              id="client-preferences"
              placeholder="np. Preferuje ciche otoczenie, lubi rozmawiac podczas zabiegu..."
              value={formPreferences}
              onChange={(e) => setFormPreferences(e.target.value)}
              rows={3}
              data-testid="client-preferences-input"
            />
          </div>

          <Separator />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <StickyNote className="h-4 w-4 text-muted-foreground" />
              <Label htmlFor="client-notes" className="text-base font-medium">
                Notatki
              </Label>
            </div>
            <Textarea
              id="client-notes"
              placeholder="Dodatkowe informacje o kliencie..."
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              rows={3}
              data-testid="client-notes-input"
            />
          </div>
        </CardContent>
      </Card>

      {/* Client meta info */}
      <Card data-testid="client-meta-card">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>
              Dodano:{" "}
              {new Date(client.createdAt).toLocaleDateString("pl-PL", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
            <span>
              Ostatnia aktualizacja:{" "}
              {new Date(client.updatedAt).toLocaleDateString("pl-PL", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
