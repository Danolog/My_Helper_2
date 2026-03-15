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
import type { Service } from "../_types";

interface DeleteServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: Service | null;
  deletingService: boolean;
  onConfirm: () => Promise<void>;
}

export function DeleteServiceDialog({
  open,
  onOpenChange,
  service,
  deletingService,
  onConfirm,
}: DeleteServiceDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Usunac usluge?</AlertDialogTitle>
          <AlertDialogDescription>
            Czy na pewno chcesz usunac usluge &quot;{service?.name}
            &quot;? Ta operacja jest nieodwracalna. Zostan rowniez usuniete
            wszystkie warianty, przypisania pracownikow i indywidualne ceny
            powiazane z ta usluga. Istniejace wizyty zachowaja swoja historie.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="cancel-delete-service-btn">
            Anuluj
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={deletingService}
            className="bg-destructive text-white hover:bg-destructive/90"
            data-testid="confirm-delete-service-btn"
          >
            {deletingService ? "Usuwanie..." : "Usun usluge"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
