"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Scissors, ArrowLeft, Trash2, Edit2 } from "lucide-react";
import type { ServiceDetail } from "../_types";

interface ServiceHeaderProps {
  service: ServiceDetail;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  deletingService: boolean;
  deleteDialogOpen: boolean;
  setDeleteDialogOpen: (open: boolean) => void;
}

export function ServiceHeader({
  service,
  onEdit,
  onDelete,
  deletingService,
  deleteDialogOpen,
  setDeleteDialogOpen,
}: ServiceHeaderProps) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-4 mb-6">
      <Button
        variant="outline"
        size="icon"
        onClick={() => router.push("/dashboard/services")}
        data-testid="back-to-services-btn"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div className="flex items-center gap-3 flex-1">
        <Scissors className="w-8 h-8 text-primary" />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold" data-testid="service-name">
              {service.name}
            </h1>
            <Badge variant={service.isActive ? "default" : "secondary"}>
              {service.isActive ? "Aktywna" : "Nieaktywna"}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              onClick={onEdit}
              data-testid="edit-service-btn"
            >
              <Edit2 className="h-4 w-4" />
            </Button>
            <AlertDialog
              open={deleteDialogOpen}
              onOpenChange={setDeleteDialogOpen}
            >
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid="delete-service-btn"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Usunac usluge?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Czy na pewno chcesz usunac usluge &quot;{service.name}
                    &quot;? Ta operacja jest nieodwracalna. Zostan rowniez
                    usuniete wszystkie warianty, przypisania pracownikow i
                    indywidualne ceny powiazane z ta usluga. Istniejace wizyty
                    zachowaja swoja historie.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="cancel-delete-btn">
                    Anuluj
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={onDelete}
                    disabled={deletingService}
                    className="bg-destructive text-white hover:bg-destructive/90"
                    data-testid="confirm-delete-btn"
                  >
                    {deletingService ? "Usuwanie..." : "Usun usluge"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          {service.category && (
            <Badge variant="outline" className="mt-1">
              {service.category.name}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
