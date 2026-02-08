"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
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
import { toast } from "sonner";
import { Pencil, User, Scissors, Clock, AlertTriangle, Bell } from "lucide-react";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

interface Client {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  allergies: string | null;
}

interface Service {
  id: string;
  name: string;
  basePrice: string;
  baseDuration: number;
  isActive: boolean;
  category: { id: string; name: string } | null;
}

interface ServiceVariant {
  id: string;
  serviceId: string;
  name: string;
  priceModifier: string | null;
  durationModifier: number | null;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  color: string | null;
  isActive: boolean;
}

interface AppointmentData {
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

interface EditAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: AppointmentData;
  onAppointmentUpdated: () => void;
}

export function EditAppointmentDialog({
  open,
  onOpenChange,
  appointment,
  onAppointmentUpdated,
}: EditAppointmentDialogProps) {
  // Form state
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [notes, setNotes] = useState("");
  const [notifyClient, setNotifyClient] = useState(false);

  // Data lists
  const [clients, setClients] = useState<Client[]>([]);
  const [allServices, setAllServices] = useState<Service[]>([]);
  const [variants, setVariants] = useState<ServiceVariant[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Loading state
  const [loadingClients, setLoadingClients] = useState(false);
  const [loadingServices, setLoadingServices] = useState(false);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Client search
  const [clientSearch, setClientSearch] = useState("");

  // Populate form with appointment data when dialog opens
  useEffect(() => {
    if (open && appointment) {
      setSelectedClientId(appointment.clientId || "none");
      setSelectedServiceId(appointment.serviceId || "none");
      setSelectedEmployeeId(appointment.employeeId);
      setNotes(appointment.notes || "");
      setNotifyClient(false);

      const start = new Date(appointment.startTime);
      const yyyy = start.getFullYear();
      const mm = String(start.getMonth() + 1).padStart(2, "0");
      const dd = String(start.getDate()).padStart(2, "0");
      setAppointmentDate(`${yyyy}-${mm}-${dd}`);

      const hh = String(start.getHours()).padStart(2, "0");
      const min = String(start.getMinutes()).padStart(2, "0");
      setAppointmentTime(`${hh}:${min}`);
    }
  }, [open, appointment]);

  // Fetch clients
  const fetchClients = useCallback(async () => {
    setLoadingClients(true);
    try {
      const res = await fetch(`/api/clients?salonId=${DEMO_SALON_ID}`);
      const data = await res.json();
      if (data.success) {
        setClients(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch clients:", error);
    } finally {
      setLoadingClients(false);
    }
  }, []);

  // Fetch services
  const fetchServices = useCallback(async () => {
    setLoadingServices(true);
    try {
      const res = await fetch(`/api/services?salonId=${DEMO_SALON_ID}&activeOnly=true`);
      const data = await res.json();
      if (data.success) {
        setAllServices(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch services:", error);
    } finally {
      setLoadingServices(false);
    }
  }, []);

  // Fetch employees
  const fetchEmployees = useCallback(async () => {
    setLoadingEmployees(true);
    try {
      const res = await fetch(`/api/employees?salonId=${DEMO_SALON_ID}&activeOnly=true`);
      const data = await res.json();
      if (data.success) {
        setEmployees(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch employees:", error);
    } finally {
      setLoadingEmployees(false);
    }
  }, []);

  // Load data when dialog opens
  useEffect(() => {
    if (open) {
      fetchClients();
      fetchServices();
      fetchEmployees();
    }
  }, [open, fetchClients, fetchServices, fetchEmployees]);

  // Fetch variants when service changes
  useEffect(() => {
    if (selectedServiceId && selectedServiceId !== "none") {
      setLoadingVariants(true);
      setSelectedVariantId("");
      fetch(`/api/services/${selectedServiceId}/variants`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setVariants(data.data);
          }
        })
        .catch((error) => {
          console.error("Failed to fetch variants:", error);
        })
        .finally(() => {
          setLoadingVariants(false);
        });
    } else {
      setVariants([]);
      setSelectedVariantId("");
    }
  }, [selectedServiceId]);

  // Calculate effective price and duration
  const getEffectivePriceAndDuration = () => {
    const service = allServices.find((s) => s.id === selectedServiceId);
    if (!service) return { price: 0, duration: 0 };

    let price = parseFloat(service.basePrice);
    let duration = service.baseDuration;

    if (selectedVariantId && selectedVariantId !== "none") {
      const variant = variants.find((v) => v.id === selectedVariantId);
      if (variant) {
        price += parseFloat(variant.priceModifier || "0");
        duration += variant.durationModifier || 0;
      }
    }

    return { price, duration };
  };

  // Filter clients based on search
  const filteredClients = clients.filter((client) => {
    if (!clientSearch) return true;
    const search = clientSearch.toLowerCase();
    const fullName = `${client.firstName} ${client.lastName}`.toLowerCase();
    return (
      fullName.includes(search) ||
      (client.phone && client.phone.includes(search)) ||
      (client.email && client.email.toLowerCase().includes(search))
    );
  });

  // Get selected client
  const selectedClient = clients.find((c) => c.id === selectedClientId);

  // Handle form submit
  const handleSubmit = async () => {
    // Validate required fields
    if (!selectedEmployeeId) {
      toast.error("Wybierz pracownika");
      return;
    }
    if (!appointmentDate) {
      toast.error("Wybierz date wizyty");
      return;
    }
    if (!appointmentTime) {
      toast.error("Wybierz godzine wizyty");
      return;
    }

    // Calculate start and end time
    const { duration } = getEffectivePriceAndDuration();
    const effectiveDuration = duration > 0 ? duration : 60; // Default to 60 min if no service

    const startTime = new Date(`${appointmentDate}T${appointmentTime}:00`);
    const endTime = new Date(startTime.getTime() + effectiveDuration * 60 * 1000);

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        employeeId: selectedEmployeeId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        clientId: selectedClientId === "none" ? null : selectedClientId || null,
        serviceId: selectedServiceId === "none" ? null : selectedServiceId || null,
        notes: notes.trim() || null,
      };

      const res = await fetch(`/api/appointments/${appointment.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.success) {
        const notificationMsg = notifyClient && appointment.client
          ? "Klient zostanie powiadomiony o zmianie"
          : undefined;
        toast.success("Wizyta zostala zaktualizowana", {
          description: notificationMsg,
        });
        onOpenChange(false);
        onAppointmentUpdated();
      } else {
        toast.error("Nie udalo sie zaktualizowac wizyty", {
          description: data.error,
        });
      }
    } catch (error) {
      console.error("Failed to update appointment:", error);
      toast.error("Blad podczas aktualizacji wizyty");
    } finally {
      setSubmitting(false);
    }
  };

  const { price, duration } = getEffectivePriceAndDuration();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="edit-appointment-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" />
            Edytuj wizyte
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Client Selection */}
          <div>
            <Label className="flex items-center gap-1.5 mb-1.5">
              <User className="h-3.5 w-3.5" />
              Klient
            </Label>
            <Input
              placeholder="Szukaj klienta (imie, nazwisko, telefon, email)..."
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              className="mb-2"
              data-testid="edit-client-search-input"
            />
            <Select
              value={selectedClientId}
              onValueChange={setSelectedClientId}
            >
              <SelectTrigger data-testid="edit-client-select">
                <SelectValue placeholder={loadingClients ? "Ladowanie klientow..." : "Wybierz klienta (opcjonalnie)"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Bez klienta</SelectItem>
                {filteredClients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.firstName} {client.lastName}
                    {client.phone ? ` (${client.phone})` : ""}
                  </SelectItem>
                ))}
                {filteredClients.length === 0 && !loadingClients && (
                  <div className="py-2 px-3 text-sm text-muted-foreground">
                    Brak klientow
                  </div>
                )}
              </SelectContent>
            </Select>

            {/* Allergy warning */}
            {selectedClient?.allergies && (
              <div className="flex items-start gap-2 mt-2 p-2 rounded-md bg-orange-50 dark:bg-orange-950/30 border border-orange-300 dark:border-orange-700 text-sm" data-testid="edit-client-allergy-warning">
                <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium text-orange-800 dark:text-orange-300">Alergie: </span>
                  <span className="text-orange-700 dark:text-orange-400">{selectedClient.allergies}</span>
                </div>
              </div>
            )}
          </div>

          {/* Service Selection */}
          <div>
            <Label className="flex items-center gap-1.5 mb-1.5">
              <Scissors className="h-3.5 w-3.5" />
              Usluga
            </Label>
            <Select
              value={selectedServiceId}
              onValueChange={setSelectedServiceId}
            >
              <SelectTrigger data-testid="edit-service-select">
                <SelectValue placeholder={loadingServices ? "Ladowanie uslug..." : "Wybierz usluge (opcjonalnie)"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Bez uslugi</SelectItem>
                {allServices.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name} - {parseFloat(service.basePrice).toFixed(2)} PLN ({service.baseDuration} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Variant Selection (conditional) */}
          {selectedServiceId && selectedServiceId !== "none" && variants.length > 0 && (
            <div>
              <Label className="mb-1.5 block">Wariant uslugi</Label>
              <Select
                value={selectedVariantId}
                onValueChange={setSelectedVariantId}
              >
                <SelectTrigger data-testid="edit-variant-select">
                  <SelectValue placeholder={loadingVariants ? "Ladowanie wariantow..." : "Wybierz wariant (opcjonalnie)"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Wariant podstawowy</SelectItem>
                  {variants.map((variant) => {
                    const priceMod = parseFloat(variant.priceModifier || "0");
                    const durMod = variant.durationModifier || 0;
                    const modifiers: string[] = [];
                    if (priceMod !== 0) modifiers.push(`${priceMod > 0 ? "+" : ""}${priceMod.toFixed(2)} PLN`);
                    if (durMod !== 0) modifiers.push(`${durMod > 0 ? "+" : ""}${durMod} min`);
                    return (
                      <SelectItem key={variant.id} value={variant.id}>
                        {variant.name}{modifiers.length > 0 ? ` (${modifiers.join(", ")})` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Price & duration summary */}
          {selectedServiceId && selectedServiceId !== "none" && (
            <div className="p-3 rounded-lg bg-muted/50 border text-sm" data-testid="edit-price-duration-summary">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cena:</span>
                <span className="font-medium">{price.toFixed(2)} PLN</span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-muted-foreground">Czas trwania:</span>
                <span className="font-medium">
                  {duration >= 60 ? `${Math.floor(duration / 60)}h ` : ""}{duration % 60 > 0 ? `${duration % 60} min` : duration >= 60 ? "" : "0 min"}
                </span>
              </div>
            </div>
          )}

          {/* Employee Selection */}
          <div>
            <Label className="flex items-center gap-1.5 mb-1.5">
              <User className="h-3.5 w-3.5" />
              Pracownik *
            </Label>
            <Select
              value={selectedEmployeeId}
              onValueChange={setSelectedEmployeeId}
            >
              <SelectTrigger data-testid="edit-employee-select">
                <SelectValue placeholder={loadingEmployees ? "Ladowanie pracownikow..." : "Wybierz pracownika"} />
              </SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    <span className="flex items-center gap-2">
                      {emp.color && (
                        <span
                          className="inline-block w-3 h-3 rounded-full border"
                          style={{ backgroundColor: emp.color }}
                        />
                      )}
                      {emp.firstName} {emp.lastName}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date & Time */}
          <div>
            <Label className="flex items-center gap-1.5 mb-1.5">
              <Clock className="h-3.5 w-3.5" />
              Data i godzina *
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="date"
                value={appointmentDate}
                onChange={(e) => setAppointmentDate(e.target.value)}
                data-testid="edit-appointment-date-input"
              />
              <Input
                type="time"
                value={appointmentTime}
                onChange={(e) => setAppointmentTime(e.target.value)}
                step="900"
                data-testid="edit-appointment-time-input"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label className="mb-1.5 block">Notatki wewnetrzne</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notatki wewnetrzne dla personelu (np. preferencje klienta, uwagi, szczegoly zabiegu)..."
              className="min-h-[80px]"
              data-testid="edit-appointment-notes-input"
            />
          </div>

          {/* Notify client option */}
          {appointment.client && (
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30" data-testid="notify-client-section">
              <Checkbox
                id="notify-client"
                checked={notifyClient}
                onCheckedChange={(checked) => setNotifyClient(checked === true)}
                data-testid="notify-client-checkbox"
              />
              <div className="flex-1">
                <label
                  htmlFor="notify-client"
                  className="text-sm font-medium flex items-center gap-1.5 cursor-pointer"
                >
                  <Bell className="h-3.5 w-3.5 text-primary" />
                  Powiadom klienta o zmianach
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {appointment.client.firstName} {appointment.client.lastName}
                  {appointment.client.phone ? ` - ${appointment.client.phone}` : ""}
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="cancel-edit-btn"
          >
            Anuluj
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !selectedEmployeeId || !appointmentDate || !appointmentTime}
            data-testid="save-edit-btn"
          >
            {submitting ? "Zapisywanie..." : "Zapisz zmiany"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
