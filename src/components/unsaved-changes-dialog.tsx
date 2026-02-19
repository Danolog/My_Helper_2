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
import { AlertTriangle } from "lucide-react";

interface UnsavedChangesDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called when user confirms they want to leave (discard changes) */
  onConfirm: () => void;
  /** Called when user cancels and wants to stay on the page */
  onCancel: () => void;
}

/**
 * Dialog that warns the user about unsaved changes when trying to navigate away.
 * Uses Radix AlertDialog for accessible, focus-trapped modal behavior.
 */
export function UnsavedChangesDialog({
  open,
  onConfirm,
  onCancel,
}: UnsavedChangesDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <AlertDialogContent data-testid="unsaved-changes-dialog">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            <AlertDialogTitle>Niezapisane zmiany</AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            Masz niezapisane zmiany w formularzu. Czy na pewno chcesz opuscic te
            strone? Wszystkie niezapisane dane zostana utracone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={onCancel}
            data-testid="unsaved-stay-btn"
          >
            Zostac na stronie
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            variant="destructive"
            data-testid="unsaved-leave-btn"
          >
            Opusc strone
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
