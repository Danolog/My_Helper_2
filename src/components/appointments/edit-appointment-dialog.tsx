"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Pencil, User, Scissors, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
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
import { useSalonRole } from "@/components/dashboard/role-provider";
import { Textarea } from "@/components/ui/textarea";
import { useSalonId } from "@/hooks/use-salon-id";
import { mutationFetch } from "@/lib/api-client";
import { APPOINTMENT_ERROR_CODES } from "@/lib/appointment-codes";
import { COMPLETED_STATUS } from "@/lib/appointment-completion";
import { APPOINTMENT_NOTES_MAX_LENGTH } from "@/lib/appointment-limits";
import { notesChange } from "@/lib/appointment-notes";
import { depositsDisabledMessage } from "@/lib/deposit-ui";

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
  /**
   * Wizyty nie ma już w zasięgu wołającego (404 `APPOINTMENT_NOT_FOUND` z PUT
   * albo z ponownego odczytu): okno się zamyka, a strona przechodzi do
   * kalendarza. Bez tej funkcji okno woła `onAppointmentUpdated`.
   */
  onAppointmentGone?: () => void;
}

export const UPDATE_FAILED_TITLE = "Nie udało się zaktualizować wizyty";
export const ASSIGNMENT_CHANGED_TITLE = "Wizyta zmieniła się w międzyczasie";
export const ASSIGNMENT_CHANGED_DESCRIPTION =
  "Wczytaliśmy aktualne dane wizyty. Sprawdź je i zapisz ponownie.";
/** Ponowny odczyt wizyty się nie udał: własny tekst okna, nie `error` z odpowiedzi GET. */
export const RELOAD_FAILED_DESCRIPTION =
  "Nie udało się wczytać aktualnych danych wizyty. Odśwież stronę i spróbuj ponownie.";
export const UPDATED_TITLE = "Wizyta została zaktualizowana";
export const UPDATE_NETWORK_ERROR = "Błąd podczas aktualizacji wizyty";
export const NO_CLIENT_LABEL = "Bez klienta";
export const NO_SERVICE_LABEL = "Bez usługi";

/** Lokalna data (RRRR-MM-DD) i godzina (GG:MM) chwili zapisanej w wizycie. */
function localDateAndTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
}

/** Zapisany czas trwania wizyty w milisekundach. */
function savedDurationMs(appt: { startTime: string; endTime: string }): number {
  return new Date(appt.endTime).getTime() - new Date(appt.startTime).getTime();
}

interface ApiResponse {
  success?: boolean;
  code?: unknown;
  error?: string;
  data?: AppointmentData;
}

/** Odpowiedź błędu (np. strona 500 z proxy) nie musi być JSON-em. */
async function readJson(res: Response): Promise<ApiResponse | null> {
  try {
    return (await res.json()) as ApiResponse;
  } catch {
    return null;
  }
}

export function EditAppointmentDialog({
  open,
  onOpenChange,
  appointment,
  onAppointmentUpdated,
  onAppointmentGone,
}: EditAppointmentDialogProps) {
  const { salonId } = useSalonId();
  const role = useSalonRole();
  // Pracownik zmienia tylko termin i notatkę; pracownika, klienta i usługę
  // zmienia właściciel albo recepcja (serwer odpowiada na inną wartość 403).
  const assignmentLocked = role === "employee";

  // Wizyta z ponownego odczytu po 403 przypisania; null = dane z `appointment`.
  const [reloaded, setReloaded] = useState<AppointmentData | null>(null);
  const current = reloaded ?? appointment;
  // Wizyta zakończona: termin się nie zmienia (serwer odrzuca każdą zmianę
  // terminu), okno zapisuje tylko notatkę.
  const termLocked = current.status === COMPLETED_STATUS;

  // Form state
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [selectedVariantId, setSelectedVariantId] = useState("");
  // Wariant wybrany w oknie na nowo (także „Wariant podstawowy”). Okno nie
  // zna zapisanego wariantu, więc bez tego wyboru czas trwania zostaje z wizyty.
  const [variantChosen, setVariantChosen] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [notes, setNotes] = useState("");

  // Wizyta, dla której formularz jest wypełniony (null = okno zamknięte).
  const populatedFor = useRef<string | null>(null);
  // Trwający ponowny odczyt wizyty; przerywany przy zamknięciu okna.
  const reloadAbort = useRef<AbortController | null>(null);

  // Data lists
  const [clients, setClients] = useState<Client[]>([]);
  const [allServices, setAllServices] = useState<Service[]>([]);
  const [variants, setVariants] = useState<ServiceVariant[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Field validation errors
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Today's date string for min constraint on date picker
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Loading state
  const [loadingClients, setLoadingClients] = useState(false);
  const [loadingServices, setLoadingServices] = useState(false);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Client search
  const [clientSearch, setClientSearch] = useState("");

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  // Formularz wypełnia się przy otwarciu okna albo przy innej wizycie.
  // Nowy obiekt tej samej wizyty przy otwartym oknie (np. synchronizacja kart)
  // nie nadpisuje wpisanego terminu i notatki.
  useEffect(() => {
    if (!open) {
      populatedFor.current = null;
      return;
    }
    if (populatedFor.current === appointment.id) return;
    populatedFor.current = appointment.id;

    setReloaded(null);
    setSelectedClientId(appointment.clientId || "none");
    setSelectedServiceId(appointment.serviceId || "none");
    setSelectedEmployeeId(appointment.employeeId);
    setVariantChosen(false);
    setNotes(appointment.notes || "");
    setFieldErrors({});

    const { date, time } = localDateAndTime(appointment.startTime);
    setAppointmentDate(date);
    setAppointmentTime(time);
  }, [open, appointment]);

  // Zamknięcie okna (także przez stronę) i odmontowanie przerywają ponowny odczyt.
  useEffect(() => {
    if (!open) reloadAbort.current?.abort();
  }, [open]);
  useEffect(() => () => reloadAbort.current?.abort(), []);

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
      // Client list unavailable — select will remain empty
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

  // Load data when dialog opens
  useEffect(() => {
    if (open && salonId) {
      fetchClients();
      fetchServices();
      fetchEmployees();
    }
  }, [open, salonId, fetchClients, fetchServices, fetchEmployees]);

  // Fetch variants when service changes (wybór wariantu zaczyna się od nowa)
  useEffect(() => {
    setVariantChosen(false);
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
        .catch(() => {
          // Variant fetch failed — variants will remain empty
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
    // Usługa nieaktywna nie ma pozycji na liście (activeOnly): dane z wizyty.
    const service =
      allServices.find((s) => s.id === selectedServiceId) ??
      (current.service && current.service.id === selectedServiceId ? current.service : undefined);
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

  // Pola przypisania tylko do odczytu: zapis wysyła przypisanie z wizyty,
  // to samo, które okno pokazuje jako tekst.
  const employeeIdForSave = assignmentLocked ? current.employeeId : selectedEmployeeId;
  const clientIdForSave = assignmentLocked
    ? current.clientId
    : selectedClientId === "none" ? null : selectedClientId || null;
  const serviceIdForSave = assignmentLocked
    ? current.serviceId
    : selectedServiceId === "none" ? null : selectedServiceId || null;

  // Zmiana samego terminu nie zmienia czasu trwania: z usługi i wariantu
  // liczy się tylko po zmianie usługi albo ponownym wyborze wariantu.
  // Pracownik nie zmienia usługi ani wariantu, więc u niego zawsze z wizyty.
  const keepSavedDuration = serviceIdForSave === current.serviceId && !variantChosen;

  // Get selected client (lista albo, u pracownika i przy braku na liście, wizyta)
  const selectedClient =
    clients.find((c) => c.id === selectedClientId) ??
    (current.client && current.client.id === clientIdForSave ? current.client : undefined);

  // Wizyty nie ma (usunięta albo przepisana na innego pracownika): zamknięcie
  // okna i odświeżenie widoku zamiast kolejnych prób zapisu.
  const handleGone = (description: string | undefined) => {
    toast.error(UPDATE_FAILED_TITLE, { description });
    onOpenChange(false);
    (onAppointmentGone ?? onAppointmentUpdated)();
  };

  // Zamknięcie bez zapisu: przerwanie ponownego odczytu, a po udanym odczycie
  // odświeżenie wizyty na stronie (inaczej strona zostaje ze starymi danymi).
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reloadAbort.current?.abort();
      if (reloaded) onAppointmentUpdated();
    }
    onOpenChange(next);
  };

  // Ponowny odczyt wizyty po 403 przypisania: pracownik, klient i usługa
  // z bazy, termin i notatka wpisane w oknie zostają, okno zostaje otwarte.
  const reloadAssignment = async () => {
    reloadAbort.current?.abort();
    const controller = new AbortController();
    reloadAbort.current = controller;

    let data: ApiResponse | null = null;
    try {
      const res = await fetch(`/api/appointments/${appointment.id}`, { signal: controller.signal });
      data = await readJson(res);
    } catch {
      data = null;
    }
    // Okno zamknięte w trakcie odczytu: bez toasta i bez przejścia dalej.
    if (controller.signal.aborted) return;
    reloadAbort.current = null;

    if (data?.code === APPOINTMENT_ERROR_CODES.appointmentNotFound) {
      handleGone(data.error);
      return;
    }
    if (data?.success !== true || !data.data) {
      toast.error(UPDATE_FAILED_TITLE, { description: RELOAD_FAILED_DESCRIPTION });
      return;
    }

    const fresh = data.data;
    setReloaded(fresh);
    setSelectedEmployeeId(fresh.employeeId);
    setSelectedClientId(fresh.clientId || "none");
    setSelectedServiceId(fresh.serviceId || "none");
    if (fresh.status === COMPLETED_STATUS) {
      // Termin wizyty zakończonej się nie zmienia: okno pokazuje zapisany.
      const { date, time } = localDateAndTime(fresh.startTime);
      setAppointmentDate(date);
      setAppointmentTime(time);
    }
    // Listy z otwarcia okna mogą nie mieć nowego klienta albo usługi.
    fetchClients();
    fetchServices();
    fetchEmployees();
    toast.info(ASSIGNMENT_CHANGED_TITLE, { description: ASSIGNMENT_CHANGED_DESCRIPTION });
  };

  // Handle form submit
  const handleSubmit = async () => {
    // Validate required fields
    const errors: Record<string, string> = {};
    if (!employeeIdForSave) {
      errors.employee = "Wybierz pracownika z listy";
    }
    // Wizyta zakończona: termin z zapisu, bez walidacji daty (notatkę wizyty
    // sprzed północy da się zapisać po północy).
    if (!termLocked) {
      if (!appointmentDate) {
        errors.date = "Wybierz datę wizyty z kalendarza";
      } else if (appointmentDate < todayStr) {
        errors.date = "Data nie może być z przeszłości. Wybierz dzisiejszą lub przyszłą datę";
      }
      if (!appointmentTime) {
        errors.time = "Wybierz godzinę rozpoczęcia wizyty";
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Popraw zaznaczone pola formularza");
      return;
    }

    let startIso: string;
    let endIso: string;
    if (termLocked) {
      // Zapisane chwile bez przeliczania: start z sekundami nie zmienia się
      // w „GG:MM:00”, więc serwer nie widzi zmiany terminu.
      startIso = current.startTime;
      endIso = current.endTime;
    } else {
      const startTime = new Date(`${appointmentDate}T${appointmentTime}:00`);
      let durationMs: number;
      if (keepSavedDuration) {
        durationMs = savedDurationMs(current);
      } else {
        const { duration } = getEffectivePriceAndDuration();
        const effectiveDuration = duration > 0 ? duration : 60; // Default to 60 min if no service
        durationMs = effectiveDuration * 60 * 1000;
      }
      startIso = startTime.toISOString();
      endIso = new Date(startTime.getTime() + durationMs).toISOString();
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        employeeId: employeeIdForSave,
        startTime: startIso,
        endTime: endIso,
        clientId: clientIdForSave,
        serviceId: serviceIdForSave,
        // Tylko zmienione notatki (#90): wizyta z notatkami ponad limit
        // sprzed #71 da się przesunąć bez 400 za nietknięte pole.
        ...notesChange(notes, appointment.notes),
      };

      const res = await mutationFetch(`/api/appointments/${appointment.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      // 409 DEPOSITS_DISABLED: komunikat z API zamiast ogólnego błędu.
      const depositsDisabledError = depositsDisabledMessage(data);

      if (data.code === APPOINTMENT_ERROR_CODES.appointmentNotFound) {
        handleGone(data.error);
      } else if (assignmentLocked && data.code === APPOINTMENT_ERROR_CODES.assignmentForbidden) {
        // Pola przypisania są tylko do odczytu, więc ten kod u pracownika
        // znaczy: okno ma nieaktualną wizytę. Wczytujemy ją ponownie.
        await reloadAssignment();
      } else if (data.success) {
        toast.success(UPDATED_TITLE);
        onOpenChange(false);
        onAppointmentUpdated();
      } else if (depositsDisabledError) {
        toast.error(depositsDisabledError);
      } else {
        toast.error(UPDATE_FAILED_TITLE, {
          description: data.error,
        });
      }
    } catch {
      toast.error(UPDATE_NETWORK_ERROR);
    } finally {
      setSubmitting(false);
    }
  };

  const { price, duration: serviceDuration } = getEffectivePriceAndDuration();
  // Podsumowanie pokazuje czas trwania, z którym okno zapisze wizytę.
  const duration = keepSavedDuration
    ? Math.round(savedDurationMs(current) / 60000)
    : serviceDuration;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="edit-appointment-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" />
            Edytuj wizytę
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Client Selection */}
          <div>
            <Label className="flex items-center gap-1.5 mb-1.5">
              <User className="h-3.5 w-3.5" />
              Klient
            </Label>
            {assignmentLocked ? (
              // Pracownik nie dostaje listy klientów (403): tekst z wizyty.
              <p className="text-sm font-medium" data-testid="edit-client-readonly">
                {current.client
                  ? `${current.client.firstName} ${current.client.lastName}`
                  : NO_CLIENT_LABEL}
              </p>
            ) : (
              <>
                <Input
                  placeholder="Szukaj klienta (imię, nazwisko, telefon, email)..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  className="mb-2"
                  data-testid="edit-client-search-input"
                />
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger data-testid="edit-client-select">
                    <SelectValue placeholder={loadingClients ? "Ładowanie klientów..." : "Wybierz klienta (opcjonalnie)"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{NO_CLIENT_LABEL}</SelectItem>
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
              </>
            )}

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
              Usługa
            </Label>
            {assignmentLocked ? (
              // Tekst z wizyty, także dla usługi nieaktywnej (lista ma tylko aktywne).
              <p className="text-sm font-medium" data-testid="edit-service-readonly">
                {current.service ? current.service.name : NO_SERVICE_LABEL}
              </p>
            ) : (
              <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
                <SelectTrigger data-testid="edit-service-select">
                  <SelectValue placeholder={loadingServices ? "Ładowanie usług..." : "Wybierz usługę (opcjonalnie)"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{NO_SERVICE_LABEL}</SelectItem>
                  {allServices.map((service) => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name} - {parseFloat(service.basePrice).toFixed(2)} PLN ({service.baseDuration} min)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Variant Selection (conditional; pracownik nie zmienia wariantu) */}
          {!assignmentLocked && selectedServiceId && selectedServiceId !== "none" && variants.length > 0 && (
            <div>
              <Label className="mb-1.5 block">Wariant usługi</Label>
              <Select
                value={selectedVariantId}
                onValueChange={(val) => {
                  setSelectedVariantId(val);
                  setVariantChosen(true);
                }}
              >
                <SelectTrigger data-testid="edit-variant-select">
                  <SelectValue placeholder={loadingVariants ? "Ładowanie wariantów..." : "Wybierz wariant (opcjonalnie)"} />
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
            {assignmentLocked ? (
              <p className="text-sm font-medium" data-testid="edit-employee-readonly">
                {current.employee ? `${current.employee.firstName} ${current.employee.lastName}` : ""}
              </p>
            ) : (
              <Select
                value={selectedEmployeeId}
                onValueChange={(val) => {
                  setSelectedEmployeeId(val);
                  if (val) clearFieldError("employee");
                }}
              >
                <SelectTrigger
                  data-testid="edit-employee-select"
                  className={fieldErrors.employee ? "border-destructive" : ""}
                >
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
            )}
            {fieldErrors.employee && (
              <p className="text-sm text-destructive mt-1" data-testid="error-edit-employee">
                {fieldErrors.employee}
              </p>
            )}
          </div>

          {/* Date & Time */}
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
                  disabled={termLocked}
                  onChange={(e) => {
                    setAppointmentDate(e.target.value);
                    if (e.target.value) clearFieldError("date");
                  }}
                  aria-invalid={!!fieldErrors.date}
                  className={fieldErrors.date ? "border-destructive" : ""}
                  data-testid="edit-appointment-date-input"
                />
                {fieldErrors.date && (
                  <p className="text-sm text-destructive mt-1" data-testid="error-edit-date">
                    {fieldErrors.date}
                  </p>
                )}
              </div>
              <div>
                <Input
                  type="time"
                  value={appointmentTime}
                  onChange={(e) => {
                    setAppointmentTime(e.target.value);
                    if (e.target.value) clearFieldError("time");
                  }}
                  step="900"
                  disabled={termLocked}
                  aria-invalid={!!fieldErrors.time}
                  className={fieldErrors.time ? "border-destructive" : ""}
                  data-testid="edit-appointment-time-input"
                />
                {fieldErrors.time && (
                  <p className="text-sm text-destructive mt-1" data-testid="error-edit-time">
                    {fieldErrors.time}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label className="mb-1.5 block">Notatki wewnętrzne</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={APPOINTMENT_NOTES_MAX_LENGTH}
              placeholder="Notatki wewnętrzne dla personelu (np. preferencje klienta, uwagi, szczegóły zabiegu)..."
              className="min-h-[80px]"
              data-testid="edit-appointment-notes-input"
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            data-testid="cancel-edit-btn"
          >
            Anuluj
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !employeeIdForSave || !appointmentDate || !appointmentTime}
            data-testid="save-edit-btn"
          >
            {submitting ? "Zapisywanie..." : "Zapisz zmiany"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
