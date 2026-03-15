"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sparkles, Loader2 } from "lucide-react";

interface EditServiceDialogProps {
  editServiceDialogOpen: boolean;
  setEditServiceDialogOpen: (open: boolean) => void;
  editServiceName: string;
  setEditServiceName: (value: string) => void;
  editServiceDescription: string;
  setEditServiceDescription: (value: string) => void;
  editServicePrice: string;
  setEditServicePrice: (value: string) => void;
  editServiceDuration: string;
  setEditServiceDuration: (value: string) => void;
  editServiceIsActive: boolean;
  setEditServiceIsActive: (value: boolean) => void;
  savingService: boolean;
  editServiceErrors: Record<string, string>;
  clearEditServiceError: (field: string) => void;
  generatingDescription: boolean;
  handleSaveService: () => Promise<void>;
  handleGenerateDescription: () => Promise<void>;
}

export function EditServiceDialog({
  editServiceDialogOpen,
  setEditServiceDialogOpen,
  editServiceName,
  setEditServiceName,
  editServiceDescription,
  setEditServiceDescription,
  editServicePrice,
  setEditServicePrice,
  editServiceDuration,
  setEditServiceDuration,
  editServiceIsActive,
  setEditServiceIsActive,
  savingService,
  editServiceErrors,
  clearEditServiceError,
  generatingDescription,
  handleSaveService,
  handleGenerateDescription,
}: EditServiceDialogProps) {
  return (
    <Dialog
      open={editServiceDialogOpen}
      onOpenChange={(open) => {
        setEditServiceDialogOpen(open);
      }}
    >
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edytuj usluge</DialogTitle>
          <DialogDescription>
            Zmien szczegoly uslugi. Pola oznaczone * sa wymagane.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-service-name">Nazwa uslugi *</Label>
            <Input
              id="edit-service-name"
              placeholder="np. Strzyzenie meskie"
              value={editServiceName}
              onChange={(e) => {
                setEditServiceName(e.target.value);
                if (e.target.value.trim()) clearEditServiceError("name");
              }}
              aria-invalid={!!editServiceErrors.name}
              className={editServiceErrors.name ? "border-destructive" : ""}
              data-testid="edit-service-name-input"
            />
            {editServiceErrors.name && (
              <p
                className="text-sm text-destructive"
                data-testid="error-edit-service-name"
              >
                {editServiceErrors.name}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="edit-service-description">Opis</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGenerateDescription}
                disabled={generatingDescription || !editServiceName.trim()}
                data-testid="generate-description-btn"
                className="text-xs gap-1.5"
              >
                {generatingDescription ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Generowanie...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    Generuj opis AI
                  </>
                )}
              </Button>
            </div>
            <Textarea
              id="edit-service-description"
              placeholder="Opis uslugi (opcjonalny) - uzyj AI, aby wygenerowac profesjonalny opis"
              value={editServiceDescription}
              onChange={(e) => setEditServiceDescription(e.target.value)}
              data-testid="edit-service-description-input"
              rows={4}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-service-price">Cena bazowa (PLN) *</Label>
              <Input
                id="edit-service-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={editServicePrice}
                onChange={(e) => {
                  setEditServicePrice(e.target.value);
                  if (e.target.value && parseFloat(e.target.value) >= 0)
                    clearEditServiceError("price");
                }}
                aria-invalid={!!editServiceErrors.price}
                className={
                  editServiceErrors.price ? "border-destructive" : ""
                }
                data-testid="edit-service-price-input"
              />
              {editServiceErrors.price && (
                <p
                  className="text-sm text-destructive"
                  data-testid="error-edit-service-price"
                >
                  {editServiceErrors.price}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-service-duration">
                Czas trwania (min) *
              </Label>
              <Input
                id="edit-service-duration"
                type="number"
                min="1"
                step="5"
                placeholder="30"
                value={editServiceDuration}
                onChange={(e) => {
                  setEditServiceDuration(e.target.value);
                  if (e.target.value && parseInt(e.target.value, 10) > 0)
                    clearEditServiceError("duration");
                }}
                aria-invalid={!!editServiceErrors.duration}
                className={
                  editServiceErrors.duration ? "border-destructive" : ""
                }
                data-testid="edit-service-duration-input"
              />
              {editServiceErrors.duration && (
                <p
                  className="text-sm text-destructive"
                  data-testid="error-edit-service-duration"
                >
                  {editServiceErrors.duration}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="edit-service-active"
              checked={editServiceIsActive}
              onCheckedChange={(checked) => setEditServiceIsActive(checked as boolean)}
            />
            <Label htmlFor="edit-service-active" className="cursor-pointer">
              Usluga aktywna
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setEditServiceDialogOpen(false)}
          >
            Anuluj
          </Button>
          <Button
            onClick={handleSaveService}
            disabled={savingService}
            data-testid="save-service-edit-btn"
          >
            {savingService ? "Zapisywanie..." : "Zapisz zmiany"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
