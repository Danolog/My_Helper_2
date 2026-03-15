"use client";

import { useState } from "react";
import Image from "next/image";
import { Loader2, Check, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { GalleryPhoto, Employee, Service } from "./gallery-types";

interface PhotoEditDialogProps {
  photo: GalleryPhoto | null;
  employees: Employee[];
  services: Service[];
  onClose: () => void;
  onSave: (updatedPhoto: GalleryPhoto) => void;
}

export function PhotoEditDialog({
  photo,
  employees,
  services,
  onClose,
  onSave,
}: PhotoEditDialogProps) {
  const [editDescription, setEditDescription] = useState(photo?.description || "");
  const [editTechniques, setEditTechniques] = useState(photo?.techniques || "");
  const [editProductsUsed, setEditProductsUsed] = useState(photo?.productsUsed || "");
  const [editEmployeeId, setEditEmployeeId] = useState(photo?.employeeId || "");
  const [editServiceId, setEditServiceId] = useState(photo?.serviceId || "");
  const [editDuration, setEditDuration] = useState(photo?.duration ? String(photo.duration) : "");
  const [editShowProductsToClients, setEditShowProductsToClients] = useState(photo?.showProductsToClients ?? true);
  const [editSaving, setEditSaving] = useState(false);

  const handleSaveEdit = async () => {
    if (!photo) return;
    setEditSaving(true);

    try {
      const res = await fetch(`/api/gallery/${photo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: editDescription,
          techniques: editTechniques,
          productsUsed: editProductsUsed,
          employeeId: editEmployeeId && editEmployeeId !== "none" ? editEmployeeId : null,
          serviceId: editServiceId && editServiceId !== "none" ? editServiceId : null,
          duration: editDuration ? parseInt(editDuration, 10) : null,
          showProductsToClients: editShowProductsToClients,
        }),
      });

      const data = await res.json();
      if (data.success) {
        onSave(data.data);
      } else {
        toast.error("Nie udalo sie zapisac zmian. Sprobuj ponownie.");
      }
    } catch {
      toast.error("Nie udalo sie zapisac zmian. Sprawdz polaczenie i sprobuj ponownie.");
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <Dialog open={!!photo} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edytuj zdjecie</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          {/* Photo preview */}
          {photo && (
            <div className="relative h-40 rounded-lg overflow-hidden border">
              <Image
                src={photo.afterPhotoUrl || photo.beforePhotoUrl || ""}
                alt="Edytowane zdjecie"
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 448px"
              />
            </div>
          )}

          {/* Description */}
          <div>
            <Label className="mb-2 block">Opis</Label>
            <Textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Opis zabiegu, efektu..."
              rows={2}
            />
          </div>

          {/* Techniques */}
          <div>
            <Label className="mb-2 block">Techniki</Label>
            <Input
              value={editTechniques}
              onChange={(e) => setEditTechniques(e.target.value)}
              placeholder="Uzyte techniki"
            />
          </div>

          {/* Products used */}
          <div>
            <Label className="mb-2 block">Uzyte produkty</Label>
            <Input
              value={editProductsUsed}
              onChange={(e) => setEditProductsUsed(e.target.value)}
              placeholder="Produkty uzyte podczas zabiegu"
            />
          </div>

          {/* Duration */}
          <div>
            <Label className="mb-2 block">Czas trwania (minuty)</Label>
            <Input
              type="number"
              min="1"
              value={editDuration}
              onChange={(e) => setEditDuration(e.target.value)}
              placeholder="np. 60"
            />
          </div>

          {/* Product visibility toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30" data-testid="product-visibility-toggle">
            <div className="flex items-center gap-2">
              {editShowProductsToClients ? (
                <Eye className="w-4 h-4 text-green-600" />
              ) : (
                <EyeOff className="w-4 h-4 text-muted-foreground" />
              )}
              <div>
                <Label className="text-sm font-medium cursor-pointer">
                  Pokaz produkty klientom
                </Label>
                <p className="text-xs text-muted-foreground">
                  {editShowProductsToClients
                    ? "Klienci widza uzyte produkty"
                    : "Produkty ukryte przed klientami"}
                </p>
              </div>
            </div>
            <Switch
              checked={editShowProductsToClients}
              onCheckedChange={setEditShowProductsToClients}
              data-testid="product-visibility-switch"
            />
          </div>

          {/* Employee selection */}
          <div>
            <Label className="mb-2 block">Pracownik</Label>
            <Select value={editEmployeeId} onValueChange={setEditEmployeeId}>
              <SelectTrigger>
                <SelectValue placeholder="Wybierz pracownika" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Brak</SelectItem>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Service selection */}
          <div>
            <Label className="mb-2 block">Usluga</Label>
            <Select value={editServiceId} onValueChange={setEditServiceId}>
              <SelectTrigger>
                <SelectValue placeholder="Wybierz usluge" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Brak</SelectItem>
                {services.map((svc) => (
                  <SelectItem key={svc.id} value={svc.id}>
                    {svc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>
              Anuluj
            </Button>
            <Button onClick={handleSaveEdit} disabled={editSaving}>
              {editSaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Zapisywanie...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Zapisz zmiany
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
