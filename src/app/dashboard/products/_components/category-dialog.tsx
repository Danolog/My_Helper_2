"use client";

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
import type { ProductCategory } from "../_types";

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingCategory: ProductCategory | null;
  savingCategory: boolean;
  categoryFormName: string;
  onCategoryFormNameChange: (v: string) => void;
  categoryFormErrors: Record<string, string>;
  clearCategoryFieldError: (field: string) => void;
  onSave: () => Promise<void>;
}

export function CategoryDialog({
  open,
  onOpenChange,
  editingCategory,
  savingCategory,
  categoryFormName,
  onCategoryFormNameChange,
  categoryFormErrors,
  clearCategoryFieldError,
  onSave,
}: CategoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-testid="category-dialog">
        <DialogHeader>
          <DialogTitle>
            {editingCategory ? "Zmien nazwe kategorii" : "Dodaj kategorie"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="category-name">Nazwa kategorii *</Label>
            <Input
              id="category-name"
              value={categoryFormName}
              onChange={(e) => {
                onCategoryFormNameChange(e.target.value);
                if (e.target.value.trim())
                  clearCategoryFieldError("categoryName");
              }}
              placeholder="np. Farby do wlosow"
              aria-invalid={!!categoryFormErrors.categoryName}
              className={
                categoryFormErrors.categoryName ? "border-destructive" : ""
              }
              data-testid="category-name-input"
            />
            {categoryFormErrors.categoryName && (
              <p
                className="text-sm text-destructive mt-1"
                data-testid="error-category-name"
              >
                {categoryFormErrors.categoryName}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button
            onClick={onSave}
            disabled={savingCategory}
            data-testid="save-category-btn"
          >
            {savingCategory
              ? "Zapisywanie..."
              : editingCategory
                ? "Zapisz zmiany"
                : "Dodaj kategorie"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
