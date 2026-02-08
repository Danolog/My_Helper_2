"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Lock,
  ArrowLeft,
  Calendar,
  Clock,
  User,
  Scissors,
  Package,
  Plus,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { EditAppointmentDialog } from "@/components/appointments/edit-appointment-dialog";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

interface AppointmentDetail {
  id: string;
  salonId: string;
  clientId: string | null;
  employeeId: string;
  serviceId: string | null;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  depositAmount: string | null;
  depositPaid: boolean;
  createdAt: string;
  updatedAt: string;
  client: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
    allergies: string | null;
  } | null;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    color: string | null;
  } | null;
  service: {
    id: string;
    name: string;
    basePrice: string;
    baseDuration: number;
  } | null;
}

interface MaterialRecord {
  id: string;
  appointmentId: string;
  productId: string;
  quantityUsed: string;
  notes: string | null;
  createdAt: string;
  product: {
    id: string;
    name: string;
    category: string | null;
    quantity: string | null;
    unit: string | null;
    pricePerUnit: string | null;
  } | null;
}

interface Product {
  id: string;
  name: string;
  category: string | null;
  quantity: string | null;
  unit: string | null;
  pricePerUnit: string | null;
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    scheduled: "Zaplanowana",
    confirmed: "Potwierdzona",
    completed: "Zakończona",
    cancelled: "Anulowana",
    no_show: "Nieobecność",
  };
  return labels[status] || status;
}

function getStatusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "confirmed":
      return "secondary";
    case "cancelled":
    case "no_show":
      return "destructive";
    default:
      return "outline";
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
}

export default function AppointmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const appointmentId = params.id as string;
  const { data: session, isPending } = useSession();

  const [appointment, setAppointment] = useState<AppointmentDetail | null>(null);
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [availableProducts, setAvailableProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Add material dialog
  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [materialQuantity, setMaterialQuantity] = useState("");
  const [materialNotes, setMaterialNotes] = useState("");
  const [addingMaterial, setAddingMaterial] = useState(false);

  // Complete appointment state
  const [completing, setCompleting] = useState(false);

  // Edit appointment dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const fetchAppointment = useCallback(async () => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`);
      const data = await res.json();
      if (data.success) {
        setAppointment(data.data);
      } else {
        toast.error("Nie znaleziono wizyty");
        router.push("/dashboard/calendar");
      }
    } catch (error) {
      console.error("Failed to fetch appointment:", error);
      toast.error("Błąd podczas ładowania wizyty");
    } finally {
      setLoading(false);
    }
  }, [appointmentId, router]);

  const fetchMaterials = useCallback(async () => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/materials`);
      const data = await res.json();
      if (data.success) {
        setMaterials(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch materials:", error);
    }
  }, [appointmentId]);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch(`/api/products?salonId=${DEMO_SALON_ID}`);
      const data = await res.json();
      if (data.success) {
        setAvailableProducts(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch products:", error);
    }
  }, []);

  useEffect(() => {
    fetchAppointment();
    fetchMaterials();
    fetchProducts();
  }, [fetchAppointment, fetchMaterials, fetchProducts]);

  const handleAddMaterial = async () => {
    if (!selectedProductId) {
      toast.error("Wybierz produkt");
      return;
    }
    if (!materialQuantity || parseFloat(materialQuantity) <= 0) {
      toast.error("Podaj ilość większą od 0");
      return;
    }

    setAddingMaterial(true);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/materials`, {
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
        toast.success(data.message || "Materiał dodany");
        setAddMaterialOpen(false);
        setSelectedProductId("");
        setMaterialQuantity("");
        setMaterialNotes("");
        fetchMaterials();
        fetchProducts(); // Refresh product quantities
      } else {
        toast.error(data.error || "Nie udało się dodać materiału");
      }
    } catch (error) {
      console.error("Failed to add material:", error);
      toast.error("Błąd podczas dodawania materiału");
    } finally {
      setAddingMaterial(false);
    }
  };

  const handleRemoveMaterial = async (materialId: string) => {
    try {
      const res = await fetch(
        `/api/appointments/${appointmentId}/materials?materialId=${materialId}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (data.success) {
        toast.success("Materiał usunięty, stan magazynowy przywrócony");
        fetchMaterials();
        fetchProducts();
      } else {
        toast.error(data.error || "Nie udało się usunąć materiału");
      }
    } catch (error) {
      console.error("Failed to remove material:", error);
      toast.error("Błąd podczas usuwania materiału");
    }
  };

  const handleCompleteAppointment = async () => {
    setCompleting(true);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Wizyta zakończona pomyślnie");
        fetchAppointment();
      } else {
        toast.error(data.error || "Nie udało się zakończyć wizyty");
      }
    } catch (error) {
      console.error("Failed to complete appointment:", error);
      toast.error("Błąd podczas kończenia wizyty");
    } finally {
      setCompleting(false);
    }
  };

  // Calculate total material cost
  const totalMaterialCost = materials.reduce((sum, m) => {
    if (m.product?.pricePerUnit) {
      return sum + parseFloat(m.quantityUsed) * parseFloat(m.product.pricePerUnit);
    }
    return sum;
  }, 0);

  if (isPending || loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Wymagane logowanie</h1>
        </div>
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <p className="text-muted-foreground">Nie znaleziono wizyty</p>
      </div>
    );
  }

  const startDate = new Date(appointment.startTime);
  const endDate = new Date(appointment.endTime);
  const durationMin = Math.round(
    (endDate.getTime() - startDate.getTime()) / 60000
  );

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.back()}
          data-testid="back-btn"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold" data-testid="appointment-title">
            Szczegóły wizyty
          </h1>
          <p className="text-muted-foreground text-sm">
            {appointment.service?.name || "Wizyta"} -{" "}
            {startDate.toLocaleDateString("pl-PL", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        {appointment.status !== "completed" && appointment.status !== "cancelled" && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(true)}
              data-testid="edit-appointment-btn"
            >
              <Pencil className="h-4 w-4 mr-2" />
              Edytuj
            </Button>
            <Button
              onClick={handleCompleteAppointment}
              disabled={completing}
              data-testid="complete-appointment-btn"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {completing ? "Kończenie..." : "Zakończ wizytę"}
            </Button>
          </div>
        )}
      </div>

      {/* Allergy warning */}
      {appointment.client?.allergies && (
        <div
          className="flex items-start gap-3 p-4 mb-6 rounded-lg border border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30"
          data-testid="allergy-warning"
        >
          <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-orange-800 dark:text-orange-300">
              Uwaga - alergie klienta
            </p>
            <p className="text-sm text-orange-700 dark:text-orange-400 mt-1">
              {appointment.client.allergies}
            </p>
          </div>
        </div>
      )}

      {/* Appointment info */}
      <Card className="mb-6" data-testid="appointment-info-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Informacje o wizycie</CardTitle>
            <Badge variant={getStatusVariant(appointment.status)} data-testid="appointment-status">
              {getStatusLabel(appointment.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Data i godzina
              </p>
              <p className="text-sm flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-primary" />
                {startDate.toLocaleDateString("pl-PL", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
              <p className="text-sm flex items-center gap-1.5 mt-1">
                <Clock className="h-4 w-4 text-primary" />
                {startDate.toLocaleTimeString("pl-PL", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {" - "}
                {endDate.toLocaleTimeString("pl-PL", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                <span className="text-muted-foreground">
                  ({formatDuration(durationMin)})
                </span>
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Usługa
              </p>
              {appointment.service ? (
                <div>
                  <p className="text-sm flex items-center gap-1.5">
                    <Scissors className="h-4 w-4 text-primary" />
                    {appointment.service.name}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {parseFloat(appointment.service.basePrice).toFixed(2)} PLN |{" "}
                    {formatDuration(appointment.service.baseDuration)}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">Brak usługi</p>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Klient
              </p>
              {appointment.client ? (
                <p className="text-sm flex items-center gap-1.5">
                  <User className="h-4 w-4 text-primary" />
                  <a
                    href={`/dashboard/clients/${appointment.client.id}`}
                    className="text-primary hover:underline"
                    data-testid="client-link"
                  >
                    {appointment.client.firstName} {appointment.client.lastName}
                  </a>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">Brak klienta</p>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Pracownik
              </p>
              {appointment.employee ? (
                <p className="text-sm flex items-center gap-1.5">
                  <User className="h-4 w-4 text-primary" />
                  {appointment.employee.firstName} {appointment.employee.lastName}
                  {appointment.employee.color && (
                    <span
                      className="inline-block w-3 h-3 rounded-full border"
                      style={{ backgroundColor: appointment.employee.color }}
                    />
                  )}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">Brak pracownika</p>
              )}
            </div>

            {appointment.notes && (
              <div className="sm:col-span-2">
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                  Notatki
                </p>
                <p className="text-sm">{appointment.notes}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Materials section */}
      <Card data-testid="materials-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Użyte materiały</CardTitle>
              <Badge variant="secondary" data-testid="materials-count">
                {materials.length}
              </Badge>
            </div>
            <Button
              size="sm"
              onClick={() => setAddMaterialOpen(true)}
              data-testid="add-material-btn"
            >
              <Plus className="h-4 w-4 mr-1" />
              Dodaj materiał
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {materials.length === 0 ? (
            <div className="text-center py-8" data-testid="no-materials">
              <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground">Nie dodano jeszcze materiałów</p>
              <p className="text-sm text-muted-foreground mt-1">
                Dodaj zużyte produkty, aby śledzić stan magazynowy
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
                        Zużyto: {material.quantityUsed}{" "}
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
                        <a
                          href="/dashboard/products"
                          className="text-primary hover:underline text-xs"
                          data-testid="product-link"
                        >
                          → Magazyn
                        </a>
                      )}
                    </div>
                    {material.notes && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {material.notes}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive shrink-0"
                    onClick={() => handleRemoveMaterial(material.id)}
                    data-testid={`remove-material-${material.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              {/* Total cost */}
              {totalMaterialCost > 0 && (
                <>
                  <Separator />
                  <div className="flex justify-between items-center px-3">
                    <span className="font-medium">Łączny koszt materiałów:</span>
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

      {/* Edit Appointment Dialog */}
      {appointment && (
        <EditAppointmentDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          appointment={appointment}
          onAppointmentUpdated={fetchAppointment}
        />
      )}

      {/* Add Material Dialog */}
      <Dialog open={addMaterialOpen} onOpenChange={setAddMaterialOpen}>
        <DialogContent className="max-w-md" data-testid="add-material-dialog">
          <DialogHeader>
            <DialogTitle>Dodaj zużyty materiał</DialogTitle>
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
                    Dostępne w magazynie: {selected.quantity || "0"}{" "}
                    {selected.unit || "szt."}
                    {selected.pricePerUnit &&
                      ` | Cena: ${parseFloat(selected.pricePerUnit).toFixed(2)} PLN/${selected.unit || "szt."}`}
                  </p>
                );
              })()}
            </div>
            <div>
              <Label>Ilość *</Label>
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
              {addingMaterial ? "Dodawanie..." : "Dodaj materiał"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
