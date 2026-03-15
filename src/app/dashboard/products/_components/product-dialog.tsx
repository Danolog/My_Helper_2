"use client";

import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormRecoveryBanner } from "@/components/form-recovery-banner";
import type { Product } from "../_types";
import { NO_CATEGORY, UNITS } from "../_types";

interface ProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingProduct: Product | null;
  saving: boolean;

  // Form values
  formName: string;
  onFormNameChange: (v: string) => void;
  formCategory: string;
  onFormCategoryChange: (v: string) => void;
  formQuantity: string;
  onFormQuantityChange: (v: string) => void;
  formMinQuantity: string;
  onFormMinQuantityChange: (v: string) => void;
  formUnit: string;
  onFormUnitChange: (v: string) => void;
  formPricePerUnit: string;
  onFormPricePerUnitChange: (v: string) => void;

  // Validation
  formErrors: Record<string, string>;
  setFormErrors: Dispatch<SetStateAction<Record<string, string>>>;
  clearFieldError: (field: string) => void;

  // Category options
  categoryNames: string[];

  // Recovery
  productWasRecovered: boolean;
  onRestore: () => void;
  onDismissRecovery: () => void;

  // Actions
  onSave: () => Promise<void>;
}

/** Prevent non-numeric keyboard input for number fields */
function blockNonNumericKey(e: KeyboardEvent<HTMLInputElement>) {
  if (
    !/[0-9]/.test(e.key) &&
    ![
      "Backspace",
      "Delete",
      "Tab",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
      ".",
      ",",
    ].includes(e.key) &&
    !e.ctrlKey &&
    !e.metaKey
  ) {
    e.preventDefault();
  }
  if (e.key === "-") e.preventDefault();
}

export function ProductDialog({
  open,
  onOpenChange,
  editingProduct,
  saving,
  formName,
  onFormNameChange,
  formCategory,
  onFormCategoryChange,
  formQuantity,
  onFormQuantityChange,
  formMinQuantity,
  onFormMinQuantityChange,
  formUnit,
  onFormUnitChange,
  formPricePerUnit,
  onFormPricePerUnitChange,
  formErrors,
  setFormErrors,
  clearFieldError,
  categoryNames,
  productWasRecovered,
  onRestore,
  onDismissRecovery,
  onSave,
}: ProductDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="product-dialog">
        <DialogHeader>
          <DialogTitle>
            {editingProduct ? "Edytuj produkt" : "Dodaj produkt"}
          </DialogTitle>
        </DialogHeader>
        {productWasRecovered && !editingProduct && (
          <FormRecoveryBanner
            onRestore={onRestore}
            onDismiss={onDismissRecovery}
          />
        )}
        <div className="space-y-4">
          {/* Name */}
          <div className="grid gap-2">
            <Label htmlFor="product-name">Nazwa produktu *</Label>
            <Input
              id="product-name"
              value={formName}
              onChange={(e) => {
                onFormNameChange(e.target.value);
                if (e.target.value.trim()) clearFieldError("name");
              }}
              placeholder="np. Farba Wella Koleston 6/0"
              required
              aria-invalid={!!formErrors.name}
              className={formErrors.name ? "border-destructive" : ""}
              data-testid="product-name-input"
            />
            {formErrors.name && (
              <p
                className="text-sm text-destructive"
                data-testid="error-product-name"
              >
                {formErrors.name}
              </p>
            )}
          </div>

          {/* Category */}
          <div>
            <Label htmlFor="product-category">Kategoria</Label>
            <Select
              value={formCategory || NO_CATEGORY}
              onValueChange={(val) =>
                onFormCategoryChange(val === NO_CATEGORY ? "" : val)
              }
            >
              <SelectTrigger data-testid="product-category-select">
                <SelectValue placeholder="Wybierz kategorie" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>Bez kategorii</SelectItem>
                {categoryNames.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quantity + Unit */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="product-quantity">Ilosc</Label>
              <Input
                id="product-quantity"
                type="number"
                step="0.01"
                min="0"
                value={formQuantity}
                onChange={(e) => {
                  onFormQuantityChange(e.target.value);
                  const val = e.target.value;
                  if (
                    val === "" ||
                    (!isNaN(Number(val)) && parseFloat(val) >= 0)
                  ) {
                    clearFieldError("quantity");
                  } else if (val && isNaN(Number(val))) {
                    setFormErrors((prev) => ({
                      ...prev,
                      quantity: "Ilosc musi byc liczba",
                    }));
                  } else if (val && parseFloat(val) < 0) {
                    setFormErrors((prev) => ({
                      ...prev,
                      quantity: "Ilosc nie moze byc ujemna",
                    }));
                  }
                }}
                onKeyDown={blockNonNumericKey}
                placeholder="0"
                aria-invalid={!!formErrors.quantity}
                className={formErrors.quantity ? "border-destructive" : ""}
                data-testid="product-quantity-input"
              />
              {formErrors.quantity && (
                <p
                  className="text-sm text-destructive mt-1"
                  data-testid="error-product-quantity"
                >
                  {formErrors.quantity}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="product-unit">Jednostka</Label>
              <Select value={formUnit || "szt."} onValueChange={onFormUnitChange}>
                <SelectTrigger data-testid="product-unit-select">
                  <SelectValue placeholder="Jednostka" />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Min quantity + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="product-min-quantity">Min. stan</Label>
              <Input
                id="product-min-quantity"
                type="number"
                step="0.01"
                min="0"
                value={formMinQuantity}
                onChange={(e) => {
                  onFormMinQuantityChange(e.target.value);
                  const val = e.target.value;
                  if (
                    val === "" ||
                    (!isNaN(Number(val)) && parseFloat(val) >= 0)
                  ) {
                    clearFieldError("minQuantity");
                  } else if (val && isNaN(Number(val))) {
                    setFormErrors((prev) => ({
                      ...prev,
                      minQuantity: "Minimalny stan musi byc liczba",
                    }));
                  } else if (val && parseFloat(val) < 0) {
                    setFormErrors((prev) => ({
                      ...prev,
                      minQuantity: "Minimalny stan nie moze byc ujemny",
                    }));
                  }
                }}
                onKeyDown={blockNonNumericKey}
                placeholder="opcjonalnie"
                aria-invalid={!!formErrors.minQuantity}
                className={
                  formErrors.minQuantity ? "border-destructive" : ""
                }
                data-testid="product-min-quantity-input"
              />
              {formErrors.minQuantity && (
                <p
                  className="text-sm text-destructive mt-1"
                  data-testid="error-product-min-quantity"
                >
                  {formErrors.minQuantity}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="product-price">Cena za jedn. (PLN)</Label>
              <Input
                id="product-price"
                type="number"
                step="0.01"
                min="0"
                value={formPricePerUnit}
                onChange={(e) => {
                  onFormPricePerUnitChange(e.target.value);
                  const val = e.target.value;
                  if (
                    val === "" ||
                    (!isNaN(Number(val)) && parseFloat(val) >= 0)
                  ) {
                    clearFieldError("pricePerUnit");
                  } else if (val && isNaN(Number(val))) {
                    setFormErrors((prev) => ({
                      ...prev,
                      pricePerUnit: "Cena musi byc liczba",
                    }));
                  } else if (val && parseFloat(val) < 0) {
                    setFormErrors((prev) => ({
                      ...prev,
                      pricePerUnit: "Cena nie moze byc ujemna",
                    }));
                  }
                }}
                onKeyDown={blockNonNumericKey}
                placeholder="opcjonalnie"
                aria-invalid={!!formErrors.pricePerUnit}
                className={
                  formErrors.pricePerUnit ? "border-destructive" : ""
                }
                data-testid="product-price-input"
              />
              {formErrors.pricePerUnit && (
                <p
                  className="text-sm text-destructive mt-1"
                  data-testid="error-product-price"
                >
                  {formErrors.pricePerUnit}
                </p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button
            onClick={onSave}
            disabled={saving}
            data-testid="save-product-btn"
          >
            {saving
              ? "Zapisywanie..."
              : editingProduct
                ? "Zapisz zmiany"
                : "Dodaj produkt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
