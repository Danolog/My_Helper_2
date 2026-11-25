"use client";

import { useState } from "react";
import {
  Heart,
  AlertTriangle,
  StickyNote,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { formatConsentDate } from "./health-data-consent-form";

/** Treść pola zgody pokazywana personelowi. */
export const HEALTH_DATA_CONSENT_LABEL =
  "Klient wyraził wyraźną zgodę na zapis informacji o zdrowiu";

/** Zgoda zapisana w bazie: kiedy i przez kogo (do wyświetlenia). */
export interface SavedHealthDataConsent {
  at: string;
  byLabel: string;
}

interface ClientHealthPreferencesCardProps {
  allergiesList: string[];
  preferencesList: string[];
  formNotes: string;
  /** Stan pola zgody w formularzu. */
  healthConsentChecked: boolean;
  /** Zgoda zapisana w danych wczytanych do formularza (`null` = brak). */
  savedHealthConsent: SavedHealthDataConsent | null;
  /** Komunikat błędu zapisu dotyczący zgody (np. 400 z serwera). */
  healthConsentError: string | null;
  onHealthConsentChange: (checked: boolean) => void;
  onAllergiesChange: (allergies: string[]) => void;
  onPreferencesChange: (preferences: string[]) => void;
  onNotesChange: (notes: string) => void;
}

/**
 * Card for managing client health information (allergies),
 * preferences, and general notes.
 *
 * Alergie to informacja o zdrowiu: pole jest zablokowane, dopóki personel nie
 * zaznaczy zgody klienta. Odznaczenie zgody przy wpisanych alergiach wymaga
 * potwierdzenia, bo po zapisie alergie zostaną usunięte.
 */
export function ClientHealthPreferencesCard({
  allergiesList,
  preferencesList,
  formNotes,
  healthConsentChecked,
  savedHealthConsent,
  healthConsentError,
  onHealthConsentChange,
  onAllergiesChange,
  onPreferencesChange,
  onNotesChange,
}: ClientHealthPreferencesCardProps) {
  const [newAllergyInput, setNewAllergyInput] = useState("");
  const [newPreferenceInput, setNewPreferenceInput] = useState("");
  const [confirmWithdrawOpen, setConfirmWithdrawOpen] = useState(false);

  const allergiesLocked = !healthConsentChecked;

  const handleConsentChange = (checked: boolean) => {
    if (!checked && allergiesList.length > 0) {
      // Najpierw potwierdzenie — pole zostaje zaznaczone do decyzji personelu.
      setConfirmWithdrawOpen(true);
      return;
    }
    if (!checked) setNewAllergyInput("");
    onHealthConsentChange(checked);
  };

  const handleConfirmWithdraw = () => {
    setConfirmWithdrawOpen(false);
    setNewAllergyInput("");
    onHealthConsentChange(false);
  };

  const handleAddAllergy = () => {
    if (allergiesLocked) return;
    const trimmed = newAllergyInput.trim();
    if (!trimmed) {
      toast.error("Wpisz nazwe alergii");
      return;
    }
    if (allergiesList.some((a) => a.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("Ta alergia jest juz na liscie");
      return;
    }
    onAllergiesChange([...allergiesList, trimmed]);
    setNewAllergyInput("");
  };

  const handleRemoveAllergy = (index: number) => {
    onAllergiesChange(allergiesList.filter((_, i) => i !== index));
  };

  const handleAllergyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddAllergy();
    }
  };

  const handleAddPreference = () => {
    const trimmed = newPreferenceInput.trim();
    if (!trimmed) {
      toast.error("Wpisz preferencje klienta");
      return;
    }
    if (preferencesList.some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("Ta preferencja jest juz na liscie");
      return;
    }
    onPreferencesChange([...preferencesList, trimmed]);
    setNewPreferenceInput("");
  };

  const handleRemovePreference = (index: number) => {
    onPreferencesChange(preferencesList.filter((_, i) => i !== index));
  };

  const handlePreferenceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddPreference();
    }
  };

  return (
    <Card className="mb-6" data-testid="health-preferences-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Heart className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Zdrowie i preferencje</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Allergies section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            <Label className="text-base font-medium">Alergie</Label>
          </div>

          {/* Zgoda klienta na zapis informacji o zdrowiu */}
          <div className="mb-3 rounded-md border p-3" data-testid="health-consent-section">
            <div className="flex items-start gap-2">
              <Checkbox
                id="health-data-consent"
                checked={healthConsentChecked}
                onCheckedChange={handleConsentChange}
                className="mt-0.5"
                data-testid="health-consent-checkbox"
              />
              <Label htmlFor="health-data-consent" className="text-sm font-normal leading-snug cursor-pointer">
                {HEALTH_DATA_CONSENT_LABEL}
              </Label>
            </div>
            <p className="text-xs text-muted-foreground mt-2" data-testid="health-consent-status">
              {renderConsentStatus()}
            </p>
          </div>

          {healthConsentError && (
            <p
              role="alert"
              className="text-sm text-destructive mb-3"
              data-testid="health-consent-error"
            >
              {healthConsentError}
            </p>
          )}

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
              placeholder={
                allergiesLocked
                  ? "Najpierw zaznacz zgodę klienta"
                  : "np. Latex, Parafenylodiamina (PPD)"
              }
              value={newAllergyInput}
              onChange={(e) => setNewAllergyInput(e.target.value)}
              onKeyDown={handleAllergyKeyDown}
              disabled={allergiesLocked}
              aria-label="Nowa alergia"
              className="max-w-sm"
              data-testid="new-allergy-input"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddAllergy}
              disabled={allergiesLocked}
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
          <div className="flex items-center gap-2 mb-3">
            <StickyNote className="h-4 w-4 text-blue-500" />
            <Label className="text-base font-medium">
              Preferencje klienta
            </Label>
          </div>

          {preferencesList.length === 0 ? (
            <p
              className="text-sm text-muted-foreground mb-3"
              data-testid="no-preferences-message"
            >
              Brak preferencji
            </p>
          ) : (
            <div
              className="flex flex-wrap gap-2 mb-3"
              data-testid="preferences-list"
            >
              {preferencesList.map((preference, index) => (
                <Badge
                  key={`${preference}-${index}`}
                  variant="secondary"
                  className="flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                  data-testid={`preference-badge-${index}`}
                >
                  {preference}
                  <button
                    type="button"
                    onClick={() => handleRemovePreference(index)}
                    className="ml-1 hover:bg-blue-200 dark:hover:bg-blue-800 rounded-full p-0.5"
                    aria-label={`Usun preferencje: ${preference}`}
                    data-testid={`remove-preference-${index}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {/* Add preference form */}
          <div className="flex items-center gap-2">
            <Input
              placeholder="np. Preferuje kawe, Wrazliwa skora glowy"
              value={newPreferenceInput}
              onChange={(e) => setNewPreferenceInput(e.target.value)}
              onKeyDown={handlePreferenceKeyDown}
              className="max-w-sm"
              data-testid="new-preference-input"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddPreference}
              data-testid="add-preference-btn"
            >
              <Plus className="h-4 w-4 mr-1" />
              Dodaj preferencje
            </Button>
          </div>
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
            onChange={(e) => onNotesChange(e.target.value)}
            rows={3}
            data-testid="client-notes-input"
          />
        </div>
      </CardContent>

      <AlertDialog open={confirmWithdrawOpen} onOpenChange={setConfirmWithdrawOpen}>
        <AlertDialogContent data-testid="health-consent-withdraw-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Cofnąć zgodę i usunąć alergie?</AlertDialogTitle>
            <AlertDialogDescription>
              Po zapisaniu kartoteki zgoda zostanie cofnięta, a wpisane alergie
              klienta zostaną trwale usunięte.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="health-consent-withdraw-cancel">
              Anuluj
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleConfirmWithdraw}
              data-testid="health-consent-withdraw-confirm"
            >
              Cofnij zgodę i usuń alergie
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );

  function renderConsentStatus() {
    if (savedHealthConsent && healthConsentChecked) {
      return `Zgoda zapisana ${formatConsentDate(savedHealthConsent.at)}, zapisał(a): ${savedHealthConsent.byLabel}.`;
    }
    if (savedHealthConsent && !healthConsentChecked) {
      return "Po zapisaniu kartoteki zgoda zostanie cofnięta, a alergie usunięte.";
    }
    if (healthConsentChecked) {
      return "Zgoda zostanie zapisana z bieżącą datą po kliknięciu „Zapisz”.";
    }
    return "Brak zgody. Pole alergii jest zablokowane do czasu jej zaznaczenia.";
  }
}
