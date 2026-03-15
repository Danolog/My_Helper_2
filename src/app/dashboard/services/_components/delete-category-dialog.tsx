"use client";

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
import type { ServiceCategory } from "../_types";

interface DeleteCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: ServiceCategory | null;
  deletingCategory: boolean;
  /** Number of services assigned to this category */
  serviceCount: number;
  onConfirm: () => Promise<void>;
}

export function DeleteCategoryDialog({
  open,
  onOpenChange,
  category,
  deletingCategory,
  serviceCount,
  onConfirm,
}: DeleteCategoryDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Usunac kategorie?</AlertDialogTitle>
          <AlertDialogDescription>
            {(() => {
              if (!category) return "";
              if (serviceCount > 0) {
                return `Nie mozna usunac kategorii "${category.name}" - ${serviceCount} uslug jest do niej przypisanych. Najpierw przenies uslugi do innej kategorii.`;
              }
              return `Czy na pewno chcesz usunac kategorie "${category.name}"? Ta operacja jest nieodwracalna.`;
            })()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="cancel-delete-category-btn">
            Anuluj
          </AlertDialogCancel>
          {category && serviceCount === 0 && (
            <AlertDialogAction
              onClick={onConfirm}
              disabled={deletingCategory}
              className="bg-destructive text-white hover:bg-destructive/90"
              data-testid="confirm-delete-category-btn"
            >
              {deletingCategory ? "Usuwanie..." : "Usun kategorie"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
