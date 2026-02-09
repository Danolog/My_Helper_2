"use client";

import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  Scissors,
  Package,
  DollarSign,
  ClipboardList,
  CalendarPlus,
  CalendarClock,
} from "lucide-react";
import { toast } from "sonner";

interface MaterialRecord {
  id: string;
  product: {
    name: string;
    pricePerUnit: string | null;
    unit: string | null;
  } | null;
  quantityUsed: string;
}

interface AppointmentData {
  id: string;
  employeeId: string;
  status: string;
  service: {
    id: string;
    name: string;
    basePrice: string;
    baseDuration: number;
    suggestedNextVisitDays?: number | null;
  } | null;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  client: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
}

interface ScheduleNextData {
  clientId: string;
  clientName: string;
  serviceId: string;
  serviceName: string;
  employeeId: string;
  suggestedDate: string; // YYYY-MM-DD
}

interface CompleteAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: AppointmentData;
  materials: MaterialRecord[];
  onCompleted: () => void;
  onScheduleNext?: (data: ScheduleNextData) => void;
}

export function CompleteAppointmentDialog({
  open,
  onOpenChange,
  appointment,
  materials,
  onCompleted,
  onScheduleNext,
}: CompleteAppointmentDialogProps) {
  const [recipe, setRecipe] = useState("");
  const [techniques, setTechniques] = useState("");
  const [notes, setNotes] = useState("");
  const [commissionPercentage, setCommissionPercentage] = useState("50");
  const [completing, setCompleting] = useState(false);
  const [completedSuccessfully, setCompletedSuccessfully] = useState(false);

  // Calculate material cost
  const totalMaterialCost = materials.reduce((sum, m) => {
    if (m.product?.pricePerUnit) {
      return (
        sum +
        parseFloat(m.quantityUsed) * parseFloat(m.product.pricePerUnit)
      );
    }
    return sum;
  }, 0);

  // Calculate commission
  const servicePrice = appointment.service
    ? parseFloat(appointment.service.basePrice)
    : 0;
  const commPct = parseFloat(commissionPercentage) || 0;
  const commissionAmount = (servicePrice * commPct) / 100;

  // Calculate suggested next visit date
  const getSuggestedDate = (): string => {
    const days = appointment.service?.suggestedNextVisitDays;
    const suggestedDays = days && days > 0 ? days : 30; // Default 30 days
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + suggestedDays);
    const yyyy = nextDate.getFullYear();
    const mm = String(nextDate.getMonth() + 1).padStart(2, "0");
    const dd = String(nextDate.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const getSuggestedDaysLabel = (): string => {
    const days = appointment.service?.suggestedNextVisitDays;
    const suggestedDays = days && days > 0 ? days : 30;
    if (suggestedDays % 7 === 0) {
      const weeks = suggestedDays / 7;
      return weeks === 1 ? "1 tydzien" : `${weeks} tygodni`;
    }
    return `${suggestedDays} dni`;
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      const res = await fetch(
        `/api/appointments/${appointment.id}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipe: recipe || null,
            techniques: techniques || null,
            notes: notes || null,
            commissionPercentage: commPct,
          }),
        }
      );

      const data = await res.json();
      if (data.success) {
        toast.success("Wizyta zakonczona pomyslnie");
        setCompletedSuccessfully(true);
        onCompleted();
      } else {
        toast.error(data.error || "Nie udalo sie zakonczyc wizyty");
      }
    } catch (error) {
      console.error("Failed to complete appointment:", error);
      toast.error("Blad podczas konczenia wizyty");
    } finally {
      setCompleting(false);
    }
  };

  const handleScheduleNext = () => {
    if (!onScheduleNext) return;

    const data: ScheduleNextData = {
      clientId: appointment.client?.id || "",
      clientName: appointment.client
        ? `${appointment.client.firstName} ${appointment.client.lastName}`
        : "",
      serviceId: appointment.service?.id || "",
      serviceName: appointment.service?.name || "",
      employeeId: appointment.employeeId,
      suggestedDate: getSuggestedDate(),
    };

    onOpenChange(false);
    // Reset state after closing
    setTimeout(() => {
      setCompletedSuccessfully(false);
      setRecipe("");
      setTechniques("");
      setNotes("");
      setCommissionPercentage("50");
    }, 300);

    onScheduleNext(data);
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset state after closing
    setTimeout(() => {
      setCompletedSuccessfully(false);
      setRecipe("");
      setTechniques("");
      setNotes("");
      setCommissionPercentage("50");
    }, 300);
  };

  // Show success state with "Schedule Next" prompt
  if (completedSuccessfully) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent
          className="max-w-md"
          data-testid="complete-appointment-dialog"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Wizyta zakonczona
            </DialogTitle>
            <DialogDescription>
              Wizyta zostala pomyslnie zakonczona
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Summary of completed appointment */}
            <div className="rounded-lg border p-4 bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2 text-sm mb-2">
                <Scissors className="h-4 w-4 text-green-700 dark:text-green-400" />
                <span className="font-medium text-green-800 dark:text-green-300">
                  {appointment.service?.name || "Wizyta"}
                </span>
              </div>
              {appointment.client && (
                <p className="text-sm text-green-700 dark:text-green-400">
                  Klient: {appointment.client.firstName} {appointment.client.lastName}
                </p>
              )}
              {appointment.employee && (
                <p className="text-sm text-green-700 dark:text-green-400">
                  Pracownik: {appointment.employee.firstName} {appointment.employee.lastName}
                </p>
              )}
            </div>

            <Separator />

            {/* Schedule next appointment prompt */}
            <div className="space-y-3" data-testid="schedule-next-prompt">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Umow nastepna wizyte?</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Sugerowany termin nastepnej wizyty: za{" "}
                <span className="font-medium text-foreground">
                  {getSuggestedDaysLabel()}
                </span>{" "}
                ({new Date(getSuggestedDate()).toLocaleDateString("pl-PL", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })})
              </p>

              {appointment.client && appointment.service && (
                <div className="rounded-lg border p-3 bg-muted/30 text-sm space-y-1">
                  <p>
                    <span className="text-muted-foreground">Klient:</span>{" "}
                    <span className="font-medium">
                      {appointment.client.firstName} {appointment.client.lastName}
                    </span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Usluga:</span>{" "}
                    <span className="font-medium">{appointment.service.name}</span>
                  </p>
                  {appointment.employee && (
                    <p>
                      <span className="text-muted-foreground">Pracownik:</span>{" "}
                      <span className="font-medium">
                        {appointment.employee.firstName} {appointment.employee.lastName}
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-4 flex gap-2">
            <Button
              variant="outline"
              onClick={handleClose}
              data-testid="skip-schedule-next-btn"
            >
              Nie teraz
            </Button>
            <Button
              onClick={handleScheduleNext}
              disabled={!onScheduleNext}
              data-testid="schedule-next-btn"
            >
              <CalendarPlus className="h-4 w-4 mr-2" />
              Umow nastepna wizyte
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[90vh] overflow-y-auto"
        data-testid="complete-appointment-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Zakoncz wizyte
          </DialogTitle>
          <DialogDescription>
            Wypelnij notatki z zabiegu i potwierdz zakonczenie wizyty
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Appointment summary */}
          <div className="rounded-lg border p-3 bg-muted/30">
            <div className="flex items-center gap-2 text-sm mb-1">
              <Scissors className="h-4 w-4 text-primary" />
              <span className="font-medium">
                {appointment.service?.name || "Wizyta"}
              </span>
              <Badge variant="secondary">
                {servicePrice.toFixed(2)} PLN
              </Badge>
            </div>
            {appointment.client && (
              <p className="text-sm text-muted-foreground">
                Klient: {appointment.client.firstName}{" "}
                {appointment.client.lastName}
              </p>
            )}
            {appointment.employee && (
              <p className="text-sm text-muted-foreground">
                Pracownik: {appointment.employee.firstName}{" "}
                {appointment.employee.lastName}
              </p>
            )}
          </div>

          <Separator />

          {/* Treatment notes section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Notatki z zabiegu</h3>
            </div>

            <div>
              <Label htmlFor="recipe">Receptura</Label>
              <Textarea
                id="recipe"
                value={recipe}
                onChange={(e) => setRecipe(e.target.value)}
                placeholder="np. Kolor 6/0 + 7/0 w proporcji 1:1, utleniacz 6%"
                rows={2}
                data-testid="treatment-recipe-input"
              />
            </div>

            <div>
              <Label htmlFor="techniques">Techniki</Label>
              <Textarea
                id="techniques"
                value={techniques}
                onChange={(e) => setTechniques(e.target.value)}
                placeholder="np. Baleyage, cieniowanie"
                rows={2}
                data-testid="treatment-techniques-input"
              />
            </div>

            <div>
              <Label htmlFor="treatment-notes">Notatki dodatkowe</Label>
              <Textarea
                id="treatment-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="np. Klientka preferuje cieplejsze odcienie, nastepna wizyta za 6 tygodni"
                rows={2}
                data-testid="treatment-notes-input"
              />
            </div>
          </div>

          <Separator />

          {/* Materials summary */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">
                Uzyte materialy ({materials.length})
              </h3>
            </div>
            {materials.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                Brak dodanych materialow
              </p>
            ) : (
              <div className="space-y-1">
                {materials.map((m) => (
                  <div
                    key={m.id}
                    className="flex justify-between text-sm"
                  >
                    <span>
                      {m.product?.name || "Nieznany"} ({m.quantityUsed}{" "}
                      {m.product?.unit || "szt."})
                    </span>
                    {m.product?.pricePerUnit && (
                      <span className="text-muted-foreground">
                        {(
                          parseFloat(m.quantityUsed) *
                          parseFloat(m.product.pricePerUnit)
                        ).toFixed(2)}{" "}
                        PLN
                      </span>
                    )}
                  </div>
                ))}
                {totalMaterialCost > 0 && (
                  <div className="flex justify-between text-sm font-medium pt-1 border-t">
                    <span>Laczny koszt materialow:</span>
                    <span>{totalMaterialCost.toFixed(2)} PLN</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <Separator />

          {/* Commission section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Prowizja pracownika</h3>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <Label htmlFor="commission-pct">Procent prowizji (%)</Label>
                <Input
                  id="commission-pct"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={commissionPercentage}
                  onChange={(e) => setCommissionPercentage(e.target.value)}
                  data-testid="commission-percentage-input"
                />
              </div>
              <div className="flex-1">
                <Label>Kwota prowizji</Label>
                <div
                  className="h-9 flex items-center px-3 rounded-md border bg-muted text-sm font-medium"
                  data-testid="commission-amount-display"
                >
                  {commissionAmount.toFixed(2)} PLN
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Cena uslugi: {servicePrice.toFixed(2)} PLN x{" "}
              {commPct.toFixed(0)}% = {commissionAmount.toFixed(2)} PLN
            </p>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button
            onClick={handleComplete}
            disabled={completing}
            data-testid="confirm-complete-btn"
          >
            {completing ? (
              "Konczenie..."
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Potwierdz zakonczenie
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
