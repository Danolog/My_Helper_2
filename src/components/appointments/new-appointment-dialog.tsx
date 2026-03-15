"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { mutationFetch } from "@/lib/api-client";
import { CalendarPlus, User, Scissors, Clock, AlertTriangle } from "lucide-react";

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

interface NewAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAppointmentCreated: () => void;
  defaultDate?: Date | undefined;
  defaultEmployeeId?: string | undefined;
  defaultTime?: string | undefined;
  /** Pre-fill client for follow-up scheduling */
  defaultClientId?: string | undefined;
  /** Pre-fill service for follow-up scheduling */
  defaultServiceId?: string | undefined;
  /** Pre-fill date string (YYYY-MM-DD) for follow-up scheduling */
  defaultDateString?: string | undefined;
  /** Title override for follow-up mode */
  title?: string | undefined;
}

export function NewAppointmentDialog({
  open,
  onOpenChange,
  onAppointmentCreated,
  defaultDate,
  defaultEmployeeId,
  defaultTime,
  defaultClientId,
  defaultServiceId,
  defaultDateString,
  title,
}: NewAppointmentDialogProps) {
  // Form state
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(defaultEmployeeId || "");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState(defaultTime || "");
  const [notes, setNotes] = useState("");

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

  // Field-level validation errors
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Salon ID
  const [salonId, setSalonId] = useState<string | null>(null);

  // Fetch the user's salon
  useEffect(() => {
    if (open && !salonId) {
      async function fetchSalon() {
        try {
          const res = await fetch("/api/salons/mine");
          const data = await res.json();
          if (data.success && data.salon) {
            setSalonId(data.salon.id);
          }
        } catch {
          // Salon fetch failed — dialog cannot load data
        }
      }
      fetchSalon();
    }
  }, [open, salonId]);

  // Today's date string for min constraint on date picker
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Client search
  const [clientSearch, setClientSearch] = useState("");

  // Set default date when dialog opens
  useEffect(() => {
    if (open) {
      // Use defaultDateString (YYYY-MM-DD) if provided (e.g., from schedule-next flow)
      if (defaultDateString) {
        setAppointmentDate(defaultDateString);
      } else {
        const dateToUse = defaultDate || new Date();
        const yyyy = dateToUse.getFullYear();
        const mm = String(dateToUse.getMonth() + 1).padStart(2, "0");
        const dd = String(dateToUse.getDate()).padStart(2, "0");
        setAppointmentDate(`${yyyy}-${mm}-${dd}`);
      }
      if (defaultTime) setAppointmentTime(defaultTime);
      if (defaultEmployeeId) setSelectedEmployeeId(defaultEmployeeId);
      if (defaultClientId) setSelectedClientId(defaultClientId);
      if (defaultServiceId) setSelectedServiceId(defaultServiceId);
    }
  }, [open, defaultDate, defaultTime, defaultEmployeeId, defaultClientId, defaultServiceId, defaultDateString]);

  // Fetch clients
  const fetchClients = useCallback(async () => {
    if (!salonId) return;
    setLoadingClients(true);
    try {
      const res = await fetch(`/api/clients?salonId=${salonId}`);
      const data = await res.json();
      if (data.success) {
        setClients(data.data);
      }
    } catch {
      // Client list unavailable
    } finally {
      setLoadingClients(false);
    }
  }, [salonId]);

  // Fetch services
  const fetchServices = useCallback(async () => {
    if (!salonId) return;
    setLoadingServices(true);
    try {
      const res = await fetch(`/api/services?salonId=${salonId}&activeOnly=true`);
      const data = await res.json();
      if (data.success) {
        setAllServices(data.data);
      }
    } catch {
      // Service list unavailable
    } finally {
      setLoadingServices(false);
    }
  }, [salonId]);

  // Fetch employees
  const fetchEmployees = useCallback(async () => {
    if (!salonId) return;
    setLoadingEmployees(true);
    try {
      const res = await fetch(`/api/employees?salonId=${salonId}&activeOnly=true`);
      const data = await res.json();
      if (data.success) {
        setEmployees(data.data);
      }
    } catch {
      // Employee list unavailable
    } finally {
      setLoadingEmployees(false);
    }
  }, [salonId]);

  // Load data when dialog opens and salonId is available
  useEffect(() => {
    if (open && salonId) {
      fetchClients();
      fetchServices();
      fetchEmployees();
    }
  }, [open, salonId, fetchClients, fetchServices, fetchEmployees]);

  // Fetch variants when service changes
  useEffect(() => {
    if (selectedServiceId) {
      setLoadingVariants(true);
      setSelectedVariantId("");
      fetch(`/api/services/${selectedServiceId}/variants`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setVariants(data.data);
          }
        })
        .catch(() => {
          // Variant fetch failed
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

    if (selectedVariantId) {
      const variant = variants.find((v) => v.id === selectedVariantId);
      if (variant) {
        price += parseFloat(variant.priceModifier || "0");
        duration += (variant.durationModifier || 0);
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

  // Reset form
  const resetForm = () => {
    setSelectedClientId("");
    setSelectedServiceId("");
    setSelectedVariantId("");
    setSelectedEmployeeId(defaultEmployeeId || "");
    setAppointmentTime(defaultTime || "");
    setNotes("");
    setClientSearch("");
    setVariants([]);
    setFormErrors({});
  };

  // Clear individual field error on user interaction
  const clearFieldError = (field: string) => {
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  // Validate all required fields, returning true if valid
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!selectedEmployeeId) {
      errors.employee = "Wybierz pracownika z listy dostepnych";
    }
    if (!appointmentDate) {
      errors.date = "Wybierz date wizyty z kalendarza";
    } else if (appointmentDate < todayStr) {
      errors.date = "Data nie moze byc z przeszlosci. Wybierz dzisiejsza lub przyszla date";
    }
    if (!appointmentTime) {
      errors.time = "Wybierz godzine rozpoczecia wizyty, np. 10:00";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle form submit
  const handleSubmit = async () => {
    // Validate required fields
    if (!validateForm()) {
      toast.error("Wypełnij wszystkie wymagane pola");
      return;
    }

    // Calculate start and end time
    const { duration } = getEffectivePriceAndDuration();
    const effectiveDuration = duration > 0 ? duration : 60; // Default to 60 min if no service selected

    const startTime = new Date(`${appointmentDate}T${appointmentTime}:00`);
    const endTime = new Date(startTime.getTime() + effectiveDuration * 60 * 1000);

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        salonId: salonId!,
        employeeId: selectedEmployeeId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
      };

      if (selectedClientId) body.clientId = selectedClientId;
      if (selectedServiceId) body.serviceId = selectedServiceId;
      if (selectedVariantId) body.variantId = selectedVariantId;
      if (notes.trim()) body.notes = notes.trim();

      const res = await mutationFetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.success) {
        toast.success("Wizyta została utworzona", {
          description: `${appointmentDate} o ${appointmentTime}`,
        });
        resetForm();
        onOpenChange(false);
        onAppointmentCreated();
      } else {
        toast.error("Nie udało się utworzyć wizyty", {
          description: data.error,
        });
      }
    } catch {
      toast.error("Błąd podczas tworzenia wizyty");
    } finally {
      setSubmitting(false);
    }
  };

  const { price, duration } = getEffectivePriceAndDuration();

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="new-appointment-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-primary" />
            {title || "Nowa wizyta"}
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
              placeholder="Szukaj klienta (imię, nazwisko, telefon, email)..."
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              className="mb-2"
              data-testid="client-search-input"
            />
            <Select
              value={selectedClientId}
              onValueChange={setSelectedClientId}
            >
              <SelectTrigger data-testid="client-select">
                <SelectValue placeholder={loadingClients ? "Ładowanie klientów..." : "Wybierz klienta (opcjonalnie)"} />
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
                    Brak klientów
                  </div>
                )}
              </SelectContent>
            </Select>

            {/* Allergy warning */}
            {selectedClient?.allergies && (
              <div className="flex items-start gap-2 mt-2 p-2 rounded-md bg-orange-50 dark:bg-orange-950/30 border border-orange-300 dark:border-orange-700 text-sm" data-testid="client-allergy-warning">
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
              Usługa
            </Label>
            <Select
              value={selectedServiceId}
              onValueChange={setSelectedServiceId}
            >
              <SelectTrigger data-testid="service-select">
                <SelectValue placeholder={loadingServices ? "Ładowanie usług..." : "Wybierz usługę (opcjonalnie)"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Bez usługi</SelectItem>
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
              <Label className="mb-1.5 block">Wariant usługi</Label>
              <Select
                value={selectedVariantId}
                onValueChange={setSelectedVariantId}
              >
                <SelectTrigger data-testid="variant-select">
                  <SelectValue placeholder={loadingVariants ? "Ładowanie wariantów..." : "Wybierz wariant (opcjonalnie)"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Wariant podstawowy</SelectItem>
                  {variants.map((variant) => {
                    const priceMod = parseFloat(variant.priceModifier || "0");
                    const durMod = variant.durationModifier || 0;
                    const modifiers = [];
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
            <div className="p-3 rounded-lg bg-muted/50 border text-sm" data-testid="price-duration-summary">
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
              onValueChange={(v) => { setSelectedEmployeeId(v); clearFieldError("employee"); }}
            >
              <SelectTrigger data-testid="employee-select" aria-invalid={!!formErrors.employee} className={formErrors.employee ? "border-destructive" : ""}>
                <SelectValue placeholder={loadingEmployees ? "Ładowanie pracowników..." : "Wybierz pracownika"} />
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
            {formErrors.employee && (
              <p className="text-sm text-destructive mt-1">{formErrors.employee}</p>
            )}
          </div>

          {/* Date */}
          <div>
            <Label className="flex items-center gap-1.5 mb-1.5">
              <Clock className="h-3.5 w-3.5" />
              Data i godzina *
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Input
                  type="date"
                  value={appointmentDate}
                  min={todayStr}
                  onChange={(e) => { setAppointmentDate(e.target.value); clearFieldError("date"); }}
                  aria-invalid={!!formErrors.date}
                  className={formErrors.date ? "border-destructive" : ""}
                  data-testid="appointment-date-input"
                />
                {formErrors.date && (
                  <p className="text-sm text-destructive mt-1">{formErrors.date}</p>
                )}
              </div>
              <div>
                <Input
                  type="time"
                  value={appointmentTime}
                  onChange={(e) => { setAppointmentTime(e.target.value); clearFieldError("time"); }}
                  step="900"
                  aria-invalid={!!formErrors.time}
                  className={formErrors.time ? "border-destructive" : ""}
                  data-testid="appointment-time-input"
                />
                {formErrors.time && (
                  <p className="text-sm text-destructive mt-1">{formErrors.time}</p>
                )}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label className="mb-1.5 block">Notatki</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Dodatkowe uwagi (opcjonalnie)"
              data-testid="appointment-notes-input"
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={() => { resetForm(); onOpenChange(false); }}
            data-testid="cancel-appointment-btn"
          >
            Anuluj
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !selectedEmployeeId || !appointmentDate || !appointmentTime}
            data-testid="save-appointment-btn"
          >
            {submitting ? "Tworzenie..." : "Utwórz wizytę"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
