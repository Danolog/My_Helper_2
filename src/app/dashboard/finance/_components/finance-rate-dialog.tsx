"use client";

import { Percent, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EmployeeRate } from "../_types";

interface FinanceRateDialogProps {
  editingRate: EmployeeRate | null;
  newRate: string;
  savingRate: boolean;
  onNewRateChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function FinanceRateDialog({
  editingRate,
  newRate,
  savingRate,
  onNewRateChange,
  onSave,
  onClose,
}: FinanceRateDialogProps) {
  return (
    <Dialog
      open={!!editingRate}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="max-w-sm" data-testid="edit-rate-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5" />
            Zmien stawke prowizji
          </DialogTitle>
          <DialogDescription>
            {editingRate &&
              `Ustaw domyslna prowizje dla ${editingRate.firstName} ${editingRate.lastName}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="new-rate">Procent prowizji (%)</Label>
            <Input
              id="new-rate"
              type="number"
              min="0"
              max="100"
              step="1"
              value={newRate}
              onChange={(e) => onNewRateChange(e.target.value)}
              data-testid="new-rate-input"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Wartosc od 0% do 100%. Ta stawka bedzie domyslnie stosowana
              przy konczeniu wizyt.
            </p>
          </div>

          {editingRate && (
            <div className="rounded-md border p-3 bg-muted/30 text-sm">
              <p className="text-muted-foreground">
                Aktualna stawka:{" "}
                <span className="font-semibold text-foreground">
                  {editingRate.commissionRate
                    ? `${parseFloat(editingRate.commissionRate).toFixed(0)}%`
                    : "50%"}
                </span>
              </p>
              <p className="text-muted-foreground">
                Nowa stawka:{" "}
                <span className="font-semibold text-foreground">
                  {newRate}%
                </span>
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
          >
            Anuluj
          </Button>
          <Button
            onClick={onSave}
            disabled={savingRate}
            data-testid="save-rate-btn"
          >
            {savingRate ? (
              "Zapisywanie..."
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Zapisz
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
