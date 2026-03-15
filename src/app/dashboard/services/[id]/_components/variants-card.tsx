"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Clock, DollarSign, Layers, Edit2, Trash2 } from "lucide-react";
import type { ServiceDetail, ServiceVariant } from "../_types";
import {
  formatPrice,
  formatDuration,
  formatModifier,
} from "../_types";

interface VariantsCardProps {
  service: ServiceDetail;
  variantDialogOpen: boolean;
  setVariantDialogOpen: (open: boolean) => void;
  editingVariant: ServiceVariant | null;
  variantName: string;
  setVariantName: (value: string) => void;
  variantPriceModifier: string;
  setVariantPriceModifier: (value: string) => void;
  variantDurationModifier: string;
  setVariantDurationModifier: (value: string) => void;
  savingVariant: boolean;
  variantErrors: Record<string, string>;
  setVariantErrors: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  clearVariantError: (field: string) => void;
  resetVariantForm: () => void;
  openEditVariant: (variant: ServiceVariant) => void;
  handleSaveVariant: () => Promise<void>;
  handleDeleteVariant: (variant: ServiceVariant) => Promise<void>;
}

export function VariantsCard({
  service,
  variantDialogOpen,
  setVariantDialogOpen,
  editingVariant,
  variantName,
  setVariantName,
  variantPriceModifier,
  setVariantPriceModifier,
  variantDurationModifier,
  setVariantDurationModifier,
  savingVariant,
  variantErrors,
  setVariantErrors,
  clearVariantError,
  resetVariantForm,
  openEditVariant,
  handleSaveVariant,
  handleDeleteVariant,
}: VariantsCardProps) {
  return (
    <Card className="mb-6" data-testid="variants-section">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Warianty uslugi</CardTitle>
          <Badge variant="outline" data-testid="variants-count">
            {service.variants.length}
          </Badge>
        </div>
        <Dialog
          open={variantDialogOpen}
          onOpenChange={(open) => {
            setVariantDialogOpen(open);
            if (!open) resetVariantForm();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" data-testid="add-variant-btn">
              <Plus className="h-4 w-4 mr-2" />
              Dodaj wariant
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[450px]">
            <DialogHeader>
              <DialogTitle>
                {editingVariant ? "Edytuj wariant" : "Dodaj nowy wariant"}
              </DialogTitle>
              <DialogDescription>
                {editingVariant
                  ? "Zmien szczegoly wariantu uslugi."
                  : "Dodaj wariant uslugi, np. 'Krotkie wlosy', 'Dlugie wlosy'."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="variant-name">Nazwa wariantu *</Label>
                <Input
                  id="variant-name"
                  placeholder="np. Krotkie wlosy"
                  value={variantName}
                  onChange={(e) => {
                    setVariantName(e.target.value);
                    if (e.target.value.trim())
                      clearVariantError("variantName");
                  }}
                  aria-invalid={!!variantErrors.variantName}
                  className={
                    variantErrors.variantName ? "border-destructive" : ""
                  }
                  data-testid="variant-name-input"
                />
                {variantErrors.variantName && (
                  <p
                    className="text-sm text-destructive"
                    data-testid="error-variant-name"
                  >
                    {variantErrors.variantName}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="variant-price-modifier">
                    Modyfikator ceny (PLN)
                  </Label>
                  <Input
                    id="variant-price-modifier"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={variantPriceModifier}
                    onChange={(e) => {
                      setVariantPriceModifier(e.target.value);
                      const val = e.target.value;
                      if (val === "" || !isNaN(Number(val))) {
                        setVariantErrors((prev) => {
                          const next = { ...prev };
                          delete next.variantPriceModifier;
                          return next;
                        });
                      } else {
                        setVariantErrors((prev) => ({
                          ...prev,
                          variantPriceModifier:
                            "Modyfikator ceny musi byc liczba",
                        }));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (
                        !/[0-9]/.test(e.key) &&
                        ![
                          "Backspace",
                          "Delete",
                          "Tab",
                          "ArrowLeft",
                          "ArrowRight",
                          "ArrowUp",
                          "ArrowDown",
                          "Home",
                          "End",
                          ".",
                          ",",
                          "-",
                        ].includes(e.key) &&
                        !e.ctrlKey &&
                        !e.metaKey
                      ) {
                        e.preventDefault();
                      }
                    }}
                    aria-invalid={!!variantErrors.variantPriceModifier}
                    className={
                      variantErrors.variantPriceModifier
                        ? "border-destructive"
                        : ""
                    }
                    data-testid="variant-price-modifier-input"
                  />
                  {variantErrors.variantPriceModifier && (
                    <p className="text-sm text-destructive">
                      {variantErrors.variantPriceModifier}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Dodatnia wartosc podwyzsza cene, ujemna obniza
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="variant-duration-modifier">
                    Modyfikator czasu (min)
                  </Label>
                  <Input
                    id="variant-duration-modifier"
                    type="number"
                    step="5"
                    placeholder="0"
                    value={variantDurationModifier}
                    onChange={(e) => {
                      setVariantDurationModifier(e.target.value);
                      const val = e.target.value;
                      if (val === "" || !isNaN(Number(val))) {
                        setVariantErrors((prev) => {
                          const next = { ...prev };
                          delete next.variantDurationModifier;
                          return next;
                        });
                      } else {
                        setVariantErrors((prev) => ({
                          ...prev,
                          variantDurationModifier:
                            "Modyfikator czasu musi byc liczba",
                        }));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (
                        !/[0-9]/.test(e.key) &&
                        ![
                          "Backspace",
                          "Delete",
                          "Tab",
                          "ArrowLeft",
                          "ArrowRight",
                          "ArrowUp",
                          "ArrowDown",
                          "Home",
                          "End",
                          "-",
                        ].includes(e.key) &&
                        !e.ctrlKey &&
                        !e.metaKey
                      ) {
                        e.preventDefault();
                      }
                    }}
                    aria-invalid={!!variantErrors.variantDurationModifier}
                    className={
                      variantErrors.variantDurationModifier
                        ? "border-destructive"
                        : ""
                    }
                    data-testid="variant-duration-modifier-input"
                  />
                  <p className="text-xs text-muted-foreground">
                    Dodatnia wartosc wydluza czas, ujemna skraca
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  resetVariantForm();
                  setVariantDialogOpen(false);
                }}
              >
                Anuluj
              </Button>
              <Button
                onClick={handleSaveVariant}
                disabled={savingVariant}
                data-testid="save-variant-btn"
              >
                {savingVariant
                  ? "Zapisywanie..."
                  : editingVariant
                    ? "Zapisz zmiany"
                    : "Dodaj wariant"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {service.variants.length === 0 ? (
          <div className="text-center py-8">
            <Layers className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p
              className="text-muted-foreground mb-4"
              data-testid="no-variants-message"
            >
              Brak wariantow. Dodaj warianty, np. &quot;Krotkie wlosy&quot;,
              &quot;Srednie wlosy&quot;, &quot;Dlugie wlosy&quot;.
            </p>
            <Button
              variant="outline"
              onClick={() => setVariantDialogOpen(true)}
              data-testid="empty-state-add-variant-btn"
            >
              <Plus className="h-4 w-4 mr-2" />
              Dodaj pierwszy wariant
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {service.variants.map((variant) => {
              const finalPrice =
                parseFloat(service.basePrice) +
                parseFloat(variant.priceModifier);
              const finalDuration =
                service.baseDuration + variant.durationModifier;

              return (
                <div
                  key={variant.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  data-testid={`variant-card-${variant.id}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="font-medium"
                        data-testid={`variant-name-${variant.id}`}
                      >
                        {variant.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <DollarSign className="h-3.5 w-3.5" />
                        <span
                          data-testid={`variant-price-${variant.id}`}
                        >
                          {formatPrice(finalPrice.toString())} PLN
                        </span>
                        <span className="text-xs">
                          (
                          {formatModifier(
                            variant.priceModifier,
                            "",
                            " PLN",
                          )}
                          )
                        </span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        <span
                          data-testid={`variant-duration-${variant.id}`}
                        >
                          {formatDuration(finalDuration)}
                        </span>
                        <span className="text-xs">
                          (
                          {formatModifier(
                            variant.durationModifier,
                            "",
                            " min",
                          )}
                          )
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditVariant(variant)}
                      data-testid={`edit-variant-${variant.id}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteVariant(variant)}
                      data-testid={`delete-variant-${variant.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
