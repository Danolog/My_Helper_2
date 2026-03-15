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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

interface ClientHealthPreferencesCardProps {
  allergiesList: string[];
  preferencesList: string[];
  formNotes: string;
  onAllergiesChange: (allergies: string[]) => void;
  onPreferencesChange: (preferences: string[]) => void;
  onNotesChange: (notes: string) => void;
}

/**
 * Card for managing client health information (allergies),
 * preferences, and general notes.
 */
export function ClientHealthPreferencesCard({
  allergiesList,
  preferencesList,
  formNotes,
  onAllergiesChange,
  onPreferencesChange,
  onNotesChange,
}: ClientHealthPreferencesCardProps) {
  const [newAllergyInput, setNewAllergyInput] = useState("");
  const [newPreferenceInput, setNewPreferenceInput] = useState("");

  const handleAddAllergy = () => {
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
    </Card>
  );
}
