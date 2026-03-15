"use client";

import { useState } from "react";
import Link from "next/link";
import { Package, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
import { mutationFetch } from "@/lib/api-client";
import type { AppointmentDetail, MaterialRecord, Product } from "./types";

interface AppointmentMaterialsProps {
  appointment: AppointmentDetail;
  materials: MaterialRecord[];
  availableProducts: Product[];
  /** Called after a material is added or removed so the parent can refetch. */
  onMaterialsChanged: () => void;
}

export function AppointmentMaterials({
  appointment,
  materials,
  availableProducts,
  onMaterialsChanged,
}: AppointmentMaterialsProps) {
  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [materialQuantity, setMaterialQuantity] = useState("");
  const [materialNotes, setMaterialNotes] = useState("");
  const [addingMaterial, setAddingMaterial] = useState(false);

  const isEditable = appointment.status !== "completed" && appointment.status !== "cancelled";

  // Calculate total material cost
  const totalMaterialCost = materials.reduce((sum, m) => {
    if (m.product?.pricePerUnit) {
      return sum + parseFloat(m.quantityUsed) * parseFloat(m.product.pricePerUnit);
    }
    return sum;
  }, 0);

  const handleAddMaterial = async () => {
    if (!selectedProductId) {
      toast.error("Wybierz produkt");
      return;
    }
    if (!materialQuantity || parseFloat(materialQuantity) <= 0) {
      toast.error("Podaj ilosc wieksza od 0");
      return;
    }

    setAddingMaterial(true);
    try {
      const res = await mutationFetch(`/api/appointments/${appointment.id}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProductId,
          quantityUsed: materialQuantity,
          notes: materialNotes || null,
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Material dodany");
        setAddMaterialOpen(false);
        setSelectedProductId("");
        setMaterialQuantity("");
        setMaterialNotes("");
        onMaterialsChanged();
      } else {
        toast.error(data.error || "Nie udalo sie dodac materialu");
      }
    } catch {
      toast.error("Blad podczas dodawania materialu");
    } finally {
      setAddingMaterial(false);
    }
  };

  const handleRemoveMaterial = async (materialId: string) => {
    try {
      const res = await mutationFetch(
        `/api/appointments/${appointment.id}/materials?materialId=${materialId}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (data.success) {
        toast.success("Material usuniety, stan magazynowy przywrocony");
        onMaterialsChanged();
      } else {
        toast.error(data.error || "Nie udalo sie usunac materialu");
      }
    } catch {
      toast.error("Blad podczas usuwania materialu");
    }
  };

  return (
    <>
      <Card data-testid="materials-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Uzyte materialy</CardTitle>
              <Badge variant="secondary" data-testid="materials-count">
                {materials.length}
              </Badge>
            </div>
            {isEditable && (
              <Button
                size="sm"
                onClick={() => setAddMaterialOpen(true)}
                data-testid="add-material-btn"
              >
                <Plus className="h-4 w-4 mr-1" />
                Dodaj material
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {materials.length === 0 ? (
            <div className="text-center py-8" data-testid="no-materials">
              <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground">Nie dodano jeszcze materialow</p>
              <p className="text-sm text-muted-foreground mt-1">
                Dodaj uzyte produkty, aby sledzic stan magazynowy
              </p>
            </div>
          ) : (
            <div className="space-y-3" data-testid="materials-list">
              {materials.map((material) => (
                <div
                  key={material.id}
                  className="flex items-center justify-between p-3 rounded-lg border"
                  data-testid={`material-item-${material.id}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium" data-testid="material-product-name">
                        {material.product?.name || "Nieznany produkt"}
                      </span>
                      {material.product?.category && (
                        <Badge variant="secondary" className="text-xs">
                          {material.product.category}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                      <span data-testid="material-quantity">
                        Zuzyto: {material.quantityUsed}{" "}
                        {material.product?.unit || "szt."}
                      </span>
                      {material.product?.pricePerUnit && (
                        <span>
                          Koszt:{" "}
                          {(
                            parseFloat(material.quantityUsed) *
                            parseFloat(material.product.pricePerUnit)
                          ).toFixed(2)}{" "}
                          PLN
                        </span>
                      )}
                      {material.product && (
                        <Link
                          href="/dashboard/products"
                          className="text-primary hover:underline text-xs"
                          data-testid="product-link"
                        >
                          &rarr; Magazyn
                        </Link>
                      )}
                    </div>
                    {material.notes && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {material.notes}
                      </p>
                    )}
                  </div>
                  {isEditable && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive shrink-0"
                      onClick={() => handleRemoveMaterial(material.id)}
                      data-testid={`remove-material-${material.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}

              {/* Total cost */}
              {totalMaterialCost > 0 && (
                <>
                  <Separator />
                  <div className="flex justify-between items-center px-3">
                    <span className="font-medium">Laczny koszt materialow:</span>
                    <span className="font-bold" data-testid="total-material-cost">
                      {totalMaterialCost.toFixed(2)} PLN
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Material Dialog */}
      <Dialog open={addMaterialOpen} onOpenChange={setAddMaterialOpen}>
        <DialogContent className="max-w-md" data-testid="add-material-dialog">
          <DialogHeader>
            <DialogTitle>Dodaj zuzyty material</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Produkt *</Label>
              <Select
                value={selectedProductId}
                onValueChange={setSelectedProductId}
              >
                <SelectTrigger data-testid="material-product-select">
                  <SelectValue placeholder="Wybierz produkt z magazynu" />
                </SelectTrigger>
                <SelectContent>
                  {availableProducts.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                      {product.quantity && product.unit
                        ? ` (${product.quantity} ${product.unit})`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedProductId && (() => {
                const selected = availableProducts.find(
                  (p) => p.id === selectedProductId
                );
                if (!selected) return null;
                return (
                  <p className="text-xs text-muted-foreground mt-1">
                    Dostepne w magazynie: {selected.quantity || "0"}{" "}
                    {selected.unit || "szt."}
                    {selected.pricePerUnit &&
                      ` | Cena: ${parseFloat(selected.pricePerUnit).toFixed(2)} PLN/${selected.unit || "szt."}`}
                  </p>
                );
              })()}
            </div>
            <div>
              <Label>Ilosc *</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={materialQuantity}
                onChange={(e) => setMaterialQuantity(e.target.value)}
                placeholder="np. 50"
                data-testid="material-quantity-input"
              />
            </div>
            <div>
              <Label>Notatka (opcjonalnie)</Label>
              <Input
                value={materialNotes}
                onChange={(e) => setMaterialNotes(e.target.value)}
                placeholder="np. Kolor 6/0 + 7/0 mix"
                data-testid="material-notes-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddMaterialOpen(false)}
            >
              Anuluj
            </Button>
            <Button
              onClick={handleAddMaterial}
              disabled={addingMaterial}
              data-testid="confirm-add-material-btn"
            >
              {addingMaterial ? "Dodawanie..." : "Dodaj material"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
