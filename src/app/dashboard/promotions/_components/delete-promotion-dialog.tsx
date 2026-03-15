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
import type { Promotion } from "../_types";

interface DeletePromotionDialogProps {
  deleteTarget: Promotion | null;
  deleting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function DeletePromotionDialog({
  deleteTarget,
  deleting,
  onOpenChange,
  onConfirm,
}: DeletePromotionDialogProps) {
  return (
    <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && onOpenChange(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Usunac promocje?</AlertDialogTitle>
          <AlertDialogDescription>
            Czy na pewno chcesz usunac promocje{" "}
            <strong>&ldquo;{deleteTarget?.name}&rdquo;</strong>? Tej operacji nie mozna cofnac.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Anuluj</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={deleting}>
            {deleting ? "Usuwanie..." : "Usun"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
