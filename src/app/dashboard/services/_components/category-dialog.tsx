"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ServiceCategory } from "../_types";

interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingCategory: ServiceCategory | null;
  savingCategory: boolean;
  categoryFormName: string;
  onCategoryFormNameChange: (v: string) => void;
  onSave: () => Promise<void>;
  onCancel: () => void;
}

export function CategoryDialog({
  open,
  onOpenChange,
  editingCategory,
  savingCategory,
  categoryFormName,
  onCategoryFormNameChange,
  onSave,
  onCancel,
}: CategoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>
            {editingCategory ? "Edytuj kategorie" : "Dodaj nowa kategorie"}
          </DialogTitle>
          <DialogDescription>
            {editingCategory
              ? "Zmien nazwe kategorii uslug."
              : "Podaj nazwe nowej kategorii uslug."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="category-name">Nazwa kategorii *</Label>
            <Input
              id="category-name"
              placeholder="np. Uslugi fryzjerskie"
              value={categoryFormName}
              onChange={(e) => onCategoryFormNameChange(e.target.value)}
              data-testid="category-name-input"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onSave();
                }
              }}
            />
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
