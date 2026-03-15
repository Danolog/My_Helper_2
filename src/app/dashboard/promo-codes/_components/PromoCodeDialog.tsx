"use client";

import { RefreshCw } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TYPE_LABELS, formatPromotionValue } from "../_types";
import type { PromoCode, Promotion } from "../_types";

interface PromoCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingCode: PromoCode | null;
  formCode: string;
  onFormCodeChange: (code: string) => void;
  formAutoGenerate: boolean;
  onFormAutoGenerateChange: (auto: boolean) => void;
  formPromotionId: string;
  onFormPromotionIdChange: (id: string) => void;
  formUsageLimit: string;
  onFormUsageLimitChange: (limit: string) => void;
  formExpiresAt: string;
  onFormExpiresAtChange: (date: string) => void;
  promotionsList: Promotion[];
  saving: boolean;
  onSave: () => void;
}

export function PromoCodeDialog({
  open,
  onOpenChange,
  editingCode,
  formCode,
  onFormCodeChange,
  formAutoGenerate,
  onFormAutoGenerateChange,
  formPromotionId,
  onFormPromotionIdChange,
  formUsageLimit,
  onFormUsageLimitChange,
  formExpiresAt,
  onFormExpiresAtChange,
  promotionsList,
  saving,
  onSave,
}: PromoCodeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editingCode ? "Edytuj kod promocyjny" : "Generuj kod promocyjny"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Code field */}
          <div>
            <Label htmlFor="promo-code">Kod</Label>
            {!editingCode && (
              <div className="flex items-center gap-2 mb-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formAutoGenerate}
                    onChange={(e) => onFormAutoGenerateChange(e.target.checked)}
                    className="rounded"
                  />
                  Wygeneruj automatycznie
                </label>
              </div>
            )}
            {(editingCode || !formAutoGenerate) ? (
              <div className="flex gap-2">
                <Input
                  id="promo-code"
                  placeholder="np. LATO2026"
                  value={formCode}
                  onChange={(e) =>
                    onFormCodeChange(e.target.value.toUpperCase())
                  }
                  className="font-mono tracking-wider"
                />
                {!editingCode && (
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    onClick={() => {
                      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
                      const bytes = new Uint8Array(8);
                      crypto.getRandomValues(bytes);
                      const code = Array.from(
                        bytes,
                        (byte) => chars[byte % chars.length]
                      ).join("");
                      onFormCodeChange(code);
                    }}
                    title="Wygeneruj losowy kod"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Kod zostanie wygenerowany automatycznie (8 znakow)
              </p>
            )}
          </div>

          {/* Link to promotion */}
          <div>
            <Label htmlFor="promotion-link">Powiazana promocja</Label>
            <Select
              value={formPromotionId}
              onValueChange={onFormPromotionIdChange}
            >
              <SelectTrigger id="promotion-link">
                <SelectValue placeholder="Wybierz promocje" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Brak (kod bez promocji)</SelectItem>
                {promotionsList.map((promo) => (
                  <SelectItem key={promo.id} value={promo.id}>
                    {promo.name} ({TYPE_LABELS[promo.type] || promo.type}{" "}
                    {formatPromotionValue(promo.type, promo.value)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Powiaz kod z istniejaca promocja, aby zastosowac rabat
            </p>
          </div>

          {/* Usage limit */}
          <div>
            <Label htmlFor="usage-limit">Limit uzyc</Label>
            <Input
              id="usage-limit"
              type="number"
              min="1"
              placeholder="Bez limitu"
              value={formUsageLimit}
              onChange={(e) => onFormUsageLimitChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Pozostaw puste dla nieograniczonej liczby uzyc
            </p>
          </div>

          {/* Expiry date */}
          <div>
            <Label htmlFor="expires-at">Data wygasniecia</Label>
            <Input
              id="expires-at"
              type="date"
              value={formExpiresAt}
              onChange={(e) => onFormExpiresAtChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Pozostaw puste dla kodu bez terminu wygasniecia
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Anuluj
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving
              ? "Zapisywanie..."
              : editingCode
                ? "Zapisz zmiany"
                : "Generuj kod"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DeletePromoCodeDialogProps {
  deleteTarget: PromoCode | null;
  onOpenChange: (open: boolean) => void;
  deleting: boolean;
  onDelete: () => void;
}

export function DeletePromoCodeDialog({
  deleteTarget,
  onOpenChange,
  deleting,
  onDelete,
}: DeletePromoCodeDialogProps) {
  return (
    <AlertDialog
      open={!!deleteTarget}
      onOpenChange={(open) => !open && onOpenChange(false)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Usunac kod promocyjny?</AlertDialogTitle>
          <AlertDialogDescription>
            Czy na pewno chcesz usunac kod{" "}
            <strong className="font-mono">{deleteTarget?.code}</strong>? Ta
            operacja jest nieodwracalna.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Anuluj</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Usuwanie..." : "Usun"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
