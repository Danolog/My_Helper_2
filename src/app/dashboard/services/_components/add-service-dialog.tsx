"use client";

import { Plus } from "lucide-react";
import { FormRecoveryBanner } from "@/components/form-recovery-banner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ServiceCategory } from "../_types";

interface AddServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  categories: ServiceCategory[];

  // Form state
  formName: string;
  onFormNameChange: (v: string) => void;
  formDescription: string;
  onFormDescriptionChange: (v: string) => void;
  formCategoryId: string;
  onFormCategoryIdChange: (v: string) => void;
  formPrice: string;
  onFormPriceChange: (v: string) => void;
  formDuration: string;
  onFormDurationChange: (v: string) => void;
  formErrors: Record<string, string>;
  setFormErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  clearFieldError: (field: string) => void;

  // Form recovery
  serviceWasRecovered: boolean;
  onRestore: () => void;
  onDismissRecovery: () => void;

  // Actions
  onSave: () => Promise<void>;
  onCancel: () => void;
}

export function AddServiceDialog({
  open,
  onOpenChange,
  saving,
  categories,
  formName,
  onFormNameChange,
  formDescription,
  onFormDescriptionChange,
  formCategoryId,
  onFormCategoryIdChange,
  formPrice,
  onFormPriceChange,
  formDuration,
  onFormDurationChange,
  formErrors,
  setFormErrors,
  clearFieldError,
  serviceWasRecovered,
  onRestore,
  onDismissRecovery,
  onSave,
  onCancel,
}: AddServiceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button data-testid="add-service-btn">
          <Plus className="h-4 w-4 mr-2" />
          Dodaj usluge
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Dodaj nowa usluge</DialogTitle>
          <DialogDescription>
            Wypelnij formularz, aby dodac nowa usluge do oferty salonu.
          </DialogDescription>
        </DialogHeader>
        {serviceWasRecovered && (
          <FormRecoveryBanner
            onRestore={onRestore}
            onDismiss={onDismissRecovery}
          />
        )}
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="service-name">Nazwa uslugi *</Label>
            <Input
              id="service-name"
              placeholder="np. Strzyzenie meskie"
              value={formName}
              onChange={(e) => {
                onFormNameChange(e.target.value);
                if (e.target.value.trim()) clearFieldError("name");
              }}
              required
              aria-invalid={!!formErrors.name}
              className={formErrors.name ? "border-destructive" : ""}
              data-testid="service-name-input"
            />
            {formErrors.name && (
              <p className="text-sm text-destructive" data-testid="error-service-name">
                {formErrors.name}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="service-description">Opis</Label>
            <Textarea
              id="service-description"
              placeholder="Krotki opis uslugi..."
              value={formDescription}
              onChange={(e) => onFormDescriptionChange(e.target.value)}
              rows={3}
              data-testid="service-description-input"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="service-category">Kategoria</Label>
            <Select
              value={formCategoryId}
              onValueChange={onFormCategoryIdChange}
            >
              <SelectTrigger
                id="service-category"
                data-testid="service-category-select"
              >
                <SelectValue placeholder="Wybierz kategorie" />
              </SelectTrigger>
              <SelectContent>
                {categories.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    Brak kategorii - dodaj je w zakladce Kategorie
                  </SelectItem>
                ) : (
                  categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="service-price">Cena bazowa (PLN) *</Label>
              <Input
                id="service-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={formPrice}
                onChange={(e) => {
                  onFormPriceChange(e.target.value);
                  const val = e.target.value;
                  if (val && !isNaN(Number(val)) && parseFloat(val) >= 0) {
                    clearFieldError("price");
                  } else if (val && (isNaN(Number(val)))) {
                    setFormErrors((prev) => ({ ...prev, price: "Cena musi byc liczba" }));
                  } else if (val && parseFloat(val) < 0) {
                    setFormErrors((prev) => ({ ...prev, price: "Cena nie moze byc ujemna" }));
                  }
                }}
                onKeyDown={(e) => {
                  // Block letters and special chars except numeric input helpers
                  if (
                    !/[0-9]/.test(e.key) &&
                    !["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", ".", ",", "-"].includes(e.key) &&
                    !e.ctrlKey && !e.metaKey
                  ) {
                    e.preventDefault();
                  }
                  // Block minus key for price (no negatives)
                  if (e.key === "-") {
                    e.preventDefault();
                  }
                }}
                required
                aria-invalid={!!formErrors.price}
                className={formErrors.price ? "border-destructive" : ""}
                data-testid="service-price-input"
              />
              {formErrors.price && (
                <p className="text-sm text-destructive" data-testid="error-service-price">
                  {formErrors.price}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="service-duration">
                Czas trwania (min) *
              </Label>
              <Input
                id="service-duration"
                type="number"
                min="1"
                step="5"
                placeholder="30"
                value={formDuration}
                onChange={(e) => {
                  onFormDurationChange(e.target.value);
                  const val = e.target.value;
                  if (val && !isNaN(Number(val)) && parseInt(val, 10) > 0) {
                    clearFieldError("duration");
                  } else if (val && isNaN(Number(val))) {
                    setFormErrors((prev) => ({ ...prev, duration: "Czas trwania musi byc liczba" }));
                  } else if (val && parseInt(val, 10) <= 0) {
                    setFormErrors((prev) => ({ ...prev, duration: "Czas trwania musi byc wiekszy niz 0" }));
                  }
                }}
                onKeyDown={(e) => {
                  if (
                    !/[0-9]/.test(e.key) &&
                    !["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key) &&
                    !e.ctrlKey && !e.metaKey
                  ) {
                    e.preventDefault();
                  }
                }}
                required
                aria-invalid={!!formErrors.duration}
                className={formErrors.duration ? "border-destructive" : ""}
                data-testid="service-duration-input"
              />
              {formErrors.duration && (
                <p className="text-sm text-destructive" data-testid="error-service-duration">
                  {formErrors.duration}
                </p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
          >
            Anuluj
          </Button>
          <Button
            onClick={onSave}
            disabled={saving}
            data-testid="save-service-btn"
          >
            {saving ? "Zapisywanie..." : "Zapisz usluge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
