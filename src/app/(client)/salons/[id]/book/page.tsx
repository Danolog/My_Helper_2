"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  CalendarPlus,
  Scissors,
  Users,
  Clock,
  CalendarDays,
  Check,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Lock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Wallet,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceVariant {
  id: string;
  serviceId: string;
  name: string;
  priceModifier: string | null;
  durationModifier: number | null;
}

interface ServiceItem {
  id: string;
  name: string;
  basePrice: string;
  baseDuration: number;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  depositRequired: boolean;
  depositPercentage: number | null;
  variants: ServiceVariant[];
}

interface ServiceCategory {
  id: string;
  name: string;
  sortOrder: number | null;
}

interface EmployeeProfile {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  photoUrl: string | null;
  color: string | null;
  specialties: string[];
  averageRating: number | null;
  reviewCount: number;
  galleryCount: number;
}

interface SalonDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  industryType: string | null;
  services: ServiceItem[];
  categories: ServiceCategory[];
  employees: EmployeeProfile[];
  averageRating: number | null;
}

interface AssignedEmployee {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  color: string | null;
}

interface TimeSlot {
  time: string;
  available: boolean;
}

interface BlockedRange {
  start: string;
  end: string;
  type: string;
  label: string;
}

interface AvailableSlotsData {
  date: string;
  employeeId: string;
  duration: number;
  dayOff: boolean;
  workStart: string | null;
  workEnd: string | null;
  slots: TimeSlot[];
  allSlots?: TimeSlot[];
  blockedRanges?: BlockedRange[];
  message?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_NAMES = [
  "Niedziela",
  "Poniedzialek",
  "Wtorek",
  "Sroda",
  "Czwartek",
  "Piatek",
  "Sobota",
];

const MONTH_ABBRS = [
  "sty",
  "lut",
  "mar",
  "kwi",
  "maj",
  "cze",
  "lip",
  "sie",
  "wrz",
  "paz",
  "lis",
  "gru",
];

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) return `${hours}h`;
  return `${hours}h ${remaining}min`;
}

function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_ABBRS[d.getMonth()]} ${d.getFullYear()}`;
}

function getTodayStr(): string {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Calculate end time string from start time + duration in minutes. */
function calcEndTime(startTime: string, durationMinutes: number): string {
  const parts = startTime.split(":").map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const total = h * 60 + m + durationMinutes;
  const endH = Math.floor(total / 60);
  const endM = total % 60;
  return `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClientBookingPage() {
  const params = useParams();
  const salonId = params.id as string;
  const { data: session, isPending: sessionPending } = useSession();

  // Salon data
  const [salon, setSalon] = useState<SalonDetail | null>(null);
  const [loadingSalon, setLoadingSalon] = useState(true);

  // Step 1: Service selection
  const [selectedServiceId, setSelectedServiceId] = useState<string>("");
  const [expandedServices, setExpandedServices] = useState<Set<string>>(new Set());

  // Step 2: Variant selection (only if service has variants)
  const [selectedVariantId, setSelectedVariantId] = useState<string>("");

  // Step 3: Employee selection
  const [assignedEmployees, setAssignedEmployees] = useState<AssignedEmployee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");

  // Step 4: Date & time
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [slotsData, setSlotsData] = useState<AvailableSlotsData | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>("");

  // Booking state
  const [isBooking, setIsBooking] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);

  // Deposit payment state
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>("stripe");
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [_depositPaymentId, setDepositPaymentId] = useState<string>("");
  const [_depositSessionId, setDepositSessionId] = useState<string>("");

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const selectedService = salon?.services.find((s) => s.id === selectedServiceId) ?? null;
  const selectedVariant = selectedService?.variants.find((v) => v.id === selectedVariantId) ?? null;

  const hasVariants = (selectedService?.variants.length ?? 0) > 0;

  // Effective price and duration accounting for variant modifiers
  const effectivePrice = selectedService
    ? parseFloat(selectedService.basePrice) +
      (selectedVariant?.priceModifier ? parseFloat(selectedVariant.priceModifier) : 0)
    : 0;

  const effectiveDuration = selectedService
    ? selectedService.baseDuration + (selectedVariant?.durationModifier ?? 0)
    : 0;

  // Deposit calculation
  const depositRequired = selectedService?.depositRequired ?? false;
  const depositPercentage = selectedService?.depositPercentage ?? 30;
  const depositAmount = depositRequired
    ? Math.ceil(effectivePrice * (depositPercentage / 100))
    : 0;

  // Whether variant step is required and satisfied
  const variantStepRequired = hasVariants;
  const variantStepSatisfied = !variantStepRequired || selectedVariantId !== "";

  // Determine which step is currently active for progressive disclosure
  const canShowVariantStep = selectedServiceId !== "" && hasVariants;
  const canShowEmployeeStep = selectedServiceId !== "" && variantStepSatisfied;
  const canShowDateStep = canShowEmployeeStep && selectedEmployeeId !== "";
  const canShowSummaryStep =
    canShowDateStep && selectedDate !== "" && selectedTimeSlot !== "";

  const todayStr = getTodayStr();

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchSalon = useCallback(async () => {
    try {
      const res = await fetch(`/api/salons/${salonId}`);
      const json = await res.json();
      if (json.success) {
        setSalon(json.data);
      }
    } catch (error) {
      console.error("Failed to fetch salon:", error);
    } finally {
      setLoadingSalon(false);
    }
  }, [salonId]);

  useEffect(() => {
    fetchSalon();
  }, [fetchSalon]);

  const fetchAssignedEmployees = useCallback(
    async (serviceId: string) => {
      if (!serviceId) {
        setAssignedEmployees([]);
        return;
      }
      setLoadingEmployees(true);
      try {
        const res = await fetch(`/api/services/${serviceId}/employee-assignments`);
        const json = await res.json();
        if (json.success) {
          const emps: AssignedEmployee[] = json.data
            .map(
              (assignment: { employee: AssignedEmployee | null }) =>
                assignment.employee
            )
            .filter(
              (emp: AssignedEmployee | null): emp is AssignedEmployee =>
                emp !== null && emp.isActive
            );
          setAssignedEmployees(emps);
        }
      } catch (error) {
        console.error("Failed to fetch assigned employees:", error);
      } finally {
        setLoadingEmployees(false);
      }
    },
    []
  );

  const fetchAvailableSlots = useCallback(
    async (employeeId: string, date: string, duration: number) => {
      if (!employeeId || !date || !duration) {
        setSlotsData(null);
        return;
      }
      setLoadingSlots(true);
      setSelectedTimeSlot("");
      try {
        const res = await fetch(
          `/api/available-slots?employeeId=${employeeId}&date=${date}&duration=${duration}`
        );
        const json = await res.json();
        if (json.success) {
          setSlotsData(json.data);
        } else {
          toast.error(json.error || "Nie udalo sie zaladowac dostepnych terminow");
          setSlotsData(null);
        }
      } catch (error) {
        console.error("Failed to fetch available slots:", error);
        toast.error("Blad pobierania dostepnych terminow");
        setSlotsData(null);
      } finally {
        setLoadingSlots(false);
      }
    },
    []
  );

  // Auto-fetch slots when employee, date or effective duration changes
  useEffect(() => {
    if (selectedEmployeeId && selectedDate && effectiveDuration > 0) {
      fetchAvailableSlots(selectedEmployeeId, selectedDate, effectiveDuration);
    } else {
      setSlotsData(null);
      setSelectedTimeSlot("");
    }
  }, [selectedEmployeeId, selectedDate, effectiveDuration, fetchAvailableSlots]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleServiceSelect(serviceId: string) {
    setSelectedServiceId(serviceId);
    // Reset downstream selections
    setSelectedVariantId("");
    setSelectedEmployeeId("");
    setSelectedDate("");
    setSelectedTimeSlot("");
    setSlotsData(null);
    setAssignedEmployees([]);

    // If the service has no variants, immediately fetch employees
    const service = salon?.services.find((s) => s.id === serviceId);
    if (service && service.variants.length === 0) {
      fetchAssignedEmployees(serviceId);
    }
  }

  function handleVariantSelect(variantId: string) {
    setSelectedVariantId(variantId);
    // Reset downstream selections
    setSelectedEmployeeId("");
    setSelectedDate("");
    setSelectedTimeSlot("");
    setSlotsData(null);

    // Fetch employees now that a variant is chosen
    if (selectedServiceId) {
      fetchAssignedEmployees(selectedServiceId);
    }
  }

  function handleEmployeeSelect(empId: string) {
    setSelectedEmployeeId(empId);
    // Reset date & time selections
    setSelectedDate("");
    setSelectedTimeSlot("");
    setSlotsData(null);
  }

  function handleDateChange(newDate: string) {
    setSelectedDate(newDate);
    setSelectedTimeSlot("");
  }

  function navigateDate(direction: number) {
    const current = selectedDate ? new Date(selectedDate) : new Date();
    current.setDate(current.getDate() + direction);
    const yyyy = current.getFullYear();
    const mm = String(current.getMonth() + 1).padStart(2, "0");
    const dd = String(current.getDate()).padStart(2, "0");
    handleDateChange(`${yyyy}-${mm}-${dd}`);
  }

  function toggleServiceExpanded(serviceId: string) {
    setExpandedServices((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) {
        next.delete(serviceId);
      } else {
        next.add(serviceId);
      }
      return next;
    });
  }

  async function handleBookAppointment() {
    if (!selectedService || !selectedEmployeeId || !selectedDate || !selectedTimeSlot) {
      toast.error("Wypelnij wszystkie wymagane pola");
      return;
    }

    const startTime = new Date(`${selectedDate}T${selectedTimeSlot}:00`);
    const endTime = new Date(startTime.getTime() + effectiveDuration * 60000);
    const variantName = selectedVariant?.name ?? "";
    const notesText = `Rezerwacja online: ${selectedService.name}${variantName ? ` - ${variantName}` : ""}`;

    // If deposit is required, use the deposit flow
    if (depositRequired && depositAmount > 0) {
      setIsProcessingPayment(true);
      try {
        const depositBody = {
          salonId,
          clientId: null,
          employeeId: selectedEmployeeId,
          serviceId: selectedServiceId,
          variantId: selectedVariantId || null,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          notes: notesText,
          depositAmount,
          paymentMethod: selectedPaymentMethod,
        };

        // Step 1: Create deposit session (which also creates the appointment)
        const sessionRes = await fetch("/api/deposits/create-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(depositBody),
        });

        const sessionJson = await sessionRes.json();
        if (!sessionJson.success) {
          if (sessionRes.status === 409) {
            toast.error("Wybrany termin jest juz zajety. Wybierz inny termin.");
          } else {
            toast.error(sessionJson.error || "Nie udalo sie utworzyc sesji platnosci");
          }
          setIsProcessingPayment(false);
          return;
        }

        const { depositPaymentId: payId, sessionId: sessId } = sessionJson.data;
        setDepositPaymentId(payId);
        setDepositSessionId(sessId);

        // Step 2: Simulate processing the payment (in production this would redirect to Stripe Checkout)
        toast.info("Przetwarzanie platnosci zadatku...", { duration: 2000 });
        await new Promise((resolve) => setTimeout(resolve, 1500));

        // Step 3: Confirm the payment
        const confirmRes = await fetch("/api/deposits/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ depositPaymentId: payId, sessionId: sessId }),
        });

        const confirmJson = await confirmRes.json();
        if (confirmJson.success) {
          toast.success("Zadatek oplacony! Wizyta potwierdzona.", { duration: 4000 });
          setBookingSuccess(true);
        } else {
          toast.error(confirmJson.error || "Nie udalo sie potwierdzic platnosci");
        }
      } catch (error) {
        console.error("Failed to process deposit payment:", error);
        toast.error("Blad przetwarzania platnosci");
      } finally {
        setIsProcessingPayment(false);
      }
      return;
    }

    // Standard booking without deposit
    setIsBooking(true);
    try {
      const body: Record<string, unknown> = {
        salonId,
        clientId: null,
        employeeId: selectedEmployeeId,
        serviceId: selectedServiceId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        notes: notesText,
      };

      if (selectedVariantId) {
        body.variantId = selectedVariantId;
      }

      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (json.success) {
        toast.success("Wizyta zarezerwowana pomyslnie!", { duration: 4000 });
        setBookingSuccess(true);
      } else {
        if (res.status === 409) {
          toast.error("Wybrany termin jest juz zajety. Wybierz inny termin.");
        } else {
          toast.error(json.error || "Nie udalo sie zarezerwowac wizyty");
        }
      }
    } catch (error) {
      console.error("Failed to book appointment:", error);
      toast.error("Blad rezerwacji wizyty");
    } finally {
      setIsBooking(false);
    }
  }

  function resetBooking() {
    setSelectedServiceId("");
    setSelectedVariantId("");
    setSelectedEmployeeId("");
    setSelectedDate("");
    setSelectedTimeSlot("");
    setSlotsData(null);
    setAssignedEmployees([]);
    setExpandedServices(new Set());
    setBookingSuccess(false);
    setSelectedPaymentMethod("stripe");
    setIsProcessingPayment(false);
    setDepositPaymentId("");
    setDepositSessionId("");
  }

  // ---------------------------------------------------------------------------
  // Grouped services by category (mirrors salon detail page pattern)
  // ---------------------------------------------------------------------------

  function buildCategorizedServices() {
    if (!salon) return [];

    const categoryMap = new Map<string, string>();
    if (salon.categories) {
      for (const cat of salon.categories) {
        categoryMap.set(cat.id, cat.name);
      }
    }

    const servicesByCategory = new Map<string | null, ServiceItem[]>();
    for (const service of salon.services) {
      const catId = service.categoryId;
      if (!servicesByCategory.has(catId)) {
        servicesByCategory.set(catId, []);
      }
      servicesByCategory.get(catId)!.push(service);
    }

    const sortedCategoryIds = Array.from(servicesByCategory.keys()).sort(
      (a, b) => {
        if (a === null) return 1;
        if (b === null) return -1;
        const catA = salon.categories?.find((c) => c.id === a);
        const catB = salon.categories?.find((c) => c.id === b);
        return (catA?.sortOrder ?? 999) - (catB?.sortOrder ?? 999);
      }
    );

    return sortedCategoryIds.map((catId) => ({
      categoryId: catId,
      categoryName: catId ? categoryMap.get(catId) || "Inne" : "Inne uslugi",
      services: servicesByCategory.get(catId) || [],
    }));
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  // Loading state
  if (sessionPending || loadingSalon) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  // Auth required
  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-md mx-auto text-center">
          <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Wymagane logowanie</h1>
          <p className="text-muted-foreground mb-6">
            Musisz sie zalogowac, aby zarezerwowac wizyte.
          </p>
          <div className="flex flex-col gap-3">
            <Button asChild size="lg">
              <Link href="/login">Zaloguj sie</Link>
            </Button>
            <p className="text-sm text-muted-foreground">
              Nie masz konta?{" "}
              <Link
                href="/portal/register"
                className="text-primary hover:underline font-medium"
              >
                Zarejestruj sie
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Salon not found
  if (!salon) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold mb-2">Salon nie znaleziony</h2>
          <Button asChild>
            <Link href="/salons">Powrot do listy salonow</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Booking success view
  if (bookingSuccess && selectedService) {
    const employee = assignedEmployees.find((e) => e.id === selectedEmployeeId);
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <Card className="text-center py-8">
          <CardContent className="space-y-4">
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto" />
            <h2 className="text-2xl font-bold">Wizyta zarezerwowana!</h2>
            <div className="space-y-2 text-sm max-w-sm mx-auto">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Salon:</span>
                <span className="font-medium">{salon.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Usluga:</span>
                <span className="font-medium">
                  {selectedService.name}
                  {selectedVariant ? ` - ${selectedVariant.name}` : ""}
                </span>
              </div>
              {employee && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pracownik:</span>
                  <span className="font-medium">
                    {employee.firstName} {employee.lastName}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Data:</span>
                <span className="font-medium">
                  {formatDateDisplay(selectedDate)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Godzina:</span>
                <span className="font-medium">
                  {selectedTimeSlot} - {calcEndTime(selectedTimeSlot, effectiveDuration)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cena:</span>
                <span className="font-medium">{effectivePrice.toFixed(0)} PLN</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Czas trwania:</span>
                <span className="font-medium">{formatDuration(effectiveDuration)}</span>
              </div>
              {depositRequired && depositAmount > 0 && (
                <>
                  <Separator className="my-2" />
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Zadatek:</span>
                    <span className="font-medium text-green-600">{depositAmount} PLN (oplacony)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pozostalo do zaplaty:</span>
                    <span className="font-medium">{(effectivePrice - depositAmount).toFixed(0)} PLN</span>
                  </div>
                </>
              )}
            </div>
            <Separator className="my-4" />
            {depositRequired && depositAmount > 0 && (
              <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-md border border-green-200 dark:border-green-800 mb-4">
                <ShieldCheck className="w-5 h-5 text-green-600" />
                <span className="text-sm text-green-800 dark:text-green-300">
                  Zadatek {depositAmount} PLN zostal pomyslnie oplacony. Wizyta jest potwierdzona.
                </span>
              </div>
            )}
            <div className="flex flex-col gap-3">
              <Button onClick={resetBooking} size="lg">
                <CalendarPlus className="w-5 h-5 mr-2" />
                Zarezerwuj kolejna wizyte
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/salons/${salonId}`}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Powrot do salonu
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Build categorized services for step 1
  const categorizedServices = buildCategorizedServices();
  const hasMultipleCategories = categorizedServices.length > 1;

  // ---------------------------------------------------------------------------
  // Main booking flow
  // ---------------------------------------------------------------------------

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      {/* Back to salon link */}
      <div className="mb-6">
        <Button variant="ghost" asChild>
          <Link href={`/salons/${salonId}`}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Powrot do salonu
          </Link>
        </Button>
      </div>

      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <CalendarPlus className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Rezerwacja wizyty</h1>
          <p className="text-muted-foreground text-sm">
            {salon.name}
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Step 1: Select Service                                              */}
      {/* ------------------------------------------------------------------ */}
      <Card className="mb-6" data-testid="booking-step-service">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge
              variant={selectedServiceId ? "default" : "outline"}
              className="w-6 h-6 rounded-full p-0 flex items-center justify-center text-xs"
            >
              1
            </Badge>
            <Scissors className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Wybierz usluge</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {salon.services.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Brak dostepnych uslug w tym salonie.
            </p>
          ) : hasMultipleCategories ? (
            <div className="space-y-5">
              {categorizedServices.map((group) => (
                <div key={group.categoryId || "uncategorized"}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    {group.categoryName}
                  </p>
                  <div className="space-y-2">
                    {group.services.map((service) =>
                      renderServiceOption(service)
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {salon.services.map((service) =>
                renderServiceOption(service)
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Step 2: Select Variant (only if service has variants)               */}
      {/* ------------------------------------------------------------------ */}
      {canShowVariantStep && (
        <Card className="mb-6" data-testid="booking-step-variant">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge
                variant={selectedVariantId ? "default" : "outline"}
                className="w-6 h-6 rounded-full p-0 flex items-center justify-center text-xs"
              >
                2
              </Badge>
              <Scissors className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Wybierz wariant</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {selectedService && selectedService.variants.length > 0 ? (
              <div className="space-y-2">
                {selectedService.variants.map((variant) => {
                  const priceModifier = variant.priceModifier
                    ? parseFloat(variant.priceModifier)
                    : 0;
                  const durationModifier = variant.durationModifier || 0;
                  const totalPrice =
                    parseFloat(selectedService.basePrice) + priceModifier;
                  const totalDuration =
                    selectedService.baseDuration + durationModifier;
                  const isSelected = selectedVariantId === variant.id;

                  return (
                    <div
                      key={variant.id}
                      className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-primary/10 border-primary"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => handleVariantSelect(variant.id)}
                      data-testid={`booking-variant-option-${variant.id}`}
                    >
                      <div>
                        <p className="font-medium">{variant.name}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-sm text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(totalDuration)}
                          </span>
                          {priceModifier !== 0 && (
                            <span
                              className={`text-sm ${priceModifier > 0 ? "text-red-500" : "text-green-600"}`}
                            >
                              ({priceModifier > 0 ? "+" : ""}
                              {priceModifier.toFixed(0)} PLN)
                            </span>
                          )}
                          {durationModifier !== 0 && (
                            <span className="text-sm text-muted-foreground">
                              ({durationModifier > 0 ? "+" : ""}
                              {durationModifier} min)
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-semibold">
                          {totalPrice.toFixed(0)} PLN
                        </Badge>
                        {isSelected && (
                          <Check className="w-5 h-5 text-primary" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 3: Select Employee                                             */}
      {/* ------------------------------------------------------------------ */}
      <Card className="mb-6" data-testid="booking-step-employee">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge
              variant={selectedEmployeeId ? "default" : "outline"}
              className="w-6 h-6 rounded-full p-0 flex items-center justify-center text-xs"
            >
              {hasVariants ? 3 : 2}
            </Badge>
            <Users className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Wybierz pracownika</CardTitle>
            {canShowEmployeeStep && assignedEmployees.length > 0 && (
              <Badge variant="outline">
                {assignedEmployees.length} dostepnych
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!canShowEmployeeStep ? (
            <p className="text-muted-foreground text-sm">
              {!selectedServiceId
                ? "Najpierw wybierz usluge."
                : "Najpierw wybierz wariant uslugi."}
            </p>
          ) : loadingEmployees ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : assignedEmployees.length === 0 ? (
            <div className="text-center py-6">
              <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">
                Brak przypisanych pracownikow do tej uslugi.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {assignedEmployees.map((emp) => {
                const isSelected = selectedEmployeeId === emp.id;
                return (
                  <div
                    key={emp.id}
                    className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-primary/10 border-primary"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => handleEmployeeSelect(emp.id)}
                    data-testid={`booking-employee-option-${emp.id}`}
                  >
                    {emp.color && (
                      <span
                        className="inline-block w-4 h-4 rounded-full shrink-0"
                        style={{ backgroundColor: emp.color }}
                      />
                    )}
                    <span className="font-medium">
                      {emp.firstName} {emp.lastName}
                    </span>
                    {emp.role === "owner" && (
                      <Badge variant="outline" className="text-xs">
                        wlasciciel
                      </Badge>
                    )}
                    {isSelected && (
                      <Badge variant="default" className="ml-auto text-xs">
                        Wybrany
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Step 4: Select Date & Time                                          */}
      {/* ------------------------------------------------------------------ */}
      <Card className="mb-6" data-testid="booking-step-datetime">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge
              variant={selectedDate && selectedTimeSlot ? "default" : "outline"}
              className="w-6 h-6 rounded-full p-0 flex items-center justify-center text-xs"
            >
              {hasVariants ? 4 : 3}
            </Badge>
            <CalendarDays className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Wybierz date i godzine</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {!canShowDateStep ? (
            <p className="text-muted-foreground text-sm">
              Najpierw wybierz pracownika.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Date picker */}
              <div>
                <p className="text-sm font-medium mb-2">Data</p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => navigateDate(-1)}
                    disabled={!selectedDate || selectedDate <= todayStr}
                    data-testid="date-prev-btn"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Input
                    type="date"
                    value={selectedDate}
                    min={todayStr}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className="flex-1"
                    data-testid="booking-date-input"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => navigateDate(1)}
                    disabled={!selectedDate}
                    data-testid="date-next-btn"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                {selectedDate && (
                  <p
                    className="text-sm text-muted-foreground mt-2"
                    data-testid="selected-date-display"
                  >
                    {formatDateDisplay(selectedDate)}
                  </p>
                )}
              </div>

              {/* Time slots */}
              {selectedDate && (
                <div>
                  <Separator className="my-2" />
                  <p className="text-sm font-medium mb-2">Godzina</p>

                  {loadingSlots ? (
                    <div className="flex justify-center py-6">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                    </div>
                  ) : slotsData?.dayOff ? (
                    <div
                      className="text-center py-6"
                      data-testid="day-off-message"
                    >
                      <AlertCircle className="w-10 h-10 text-orange-500 mx-auto mb-3" />
                      <p className="text-muted-foreground font-medium">
                        {slotsData.message ||
                          "Pracownik nie pracuje w tym dniu"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Wybierz inna date.
                      </p>
                    </div>
                  ) : slotsData && slotsData.slots.length === 0 ? (
                    <div
                      className="text-center py-6"
                      data-testid="no-slots-message"
                    >
                      <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                      <p className="text-muted-foreground font-medium">
                        Brak wolnych terminow w tym dniu
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Wszystkie terminy sa zajete. Wybierz inna date.
                      </p>
                    </div>
                  ) : slotsData ? (
                    <div>
                      {/* Work hours info */}
                      <div className="flex items-center gap-2 mb-3 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>
                          Godziny pracy: {slotsData.workStart} -{" "}
                          {slotsData.workEnd}
                        </span>
                      </div>

                      {/* Blocked ranges */}
                      {slotsData.blockedRanges &&
                        slotsData.blockedRanges.length > 0 && (
                          <div
                            className="mb-4 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-md border border-orange-200 dark:border-orange-800"
                            data-testid="blocked-ranges-info"
                          >
                            <p className="text-xs font-medium text-orange-800 dark:text-orange-300 mb-1">
                              Zajete terminy:
                            </p>
                            {slotsData.blockedRanges.map((range, i) => (
                              <div
                                key={i}
                                className="text-xs text-orange-700 dark:text-orange-400 flex items-center gap-1 mb-0.5"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
                                {range.start} - {range.end}
                                <span className="text-orange-500">
                                  (
                                  {range.type === "appointment"
                                    ? "wizyta"
                                    : range.type === "vacation"
                                      ? "urlop"
                                      : range.type === "break"
                                        ? "przerwa"
                                        : range.label}
                                  )
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                      {/* Time slot grid */}
                      <div
                        className="grid grid-cols-4 gap-2"
                        data-testid="time-slots-grid"
                      >
                        {slotsData.slots.map((slot) => (
                          <Button
                            key={slot.time}
                            variant={
                              selectedTimeSlot === slot.time
                                ? "default"
                                : "outline"
                            }
                            size="sm"
                            className={`text-sm ${
                              selectedTimeSlot === slot.time
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-primary/10"
                            }`}
                            onClick={() => setSelectedTimeSlot(slot.time)}
                            data-testid={`time-slot-${slot.time}`}
                          >
                            {slot.time}
                          </Button>
                        ))}
                      </div>

                      {/* Selected slot summary */}
                      {selectedTimeSlot && (
                        <div
                          className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-md border border-green-200 dark:border-green-800"
                          data-testid="selected-slot-summary"
                        >
                          <div className="flex items-center gap-2">
                            <Check className="h-4 w-4 text-green-600" />
                            <span className="text-sm font-medium text-green-800 dark:text-green-300">
                              Wybrany termin: {selectedTimeSlot} -{" "}
                              {calcEndTime(selectedTimeSlot, effectiveDuration)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Step 5: Review & Confirm                                            */}
      {/* ------------------------------------------------------------------ */}
      <Card
        className={`mb-6 ${canShowSummaryStep ? "border-primary" : ""}`}
        data-testid="booking-step-summary"
      >
        <CardHeader>
          <div className="flex items-center gap-2">
            <Badge
              variant={canShowSummaryStep ? "default" : "outline"}
              className="w-6 h-6 rounded-full p-0 flex items-center justify-center text-xs"
            >
              {hasVariants ? 5 : 4}
            </Badge>
            <Check className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Podsumowanie i potwierdzenie</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {!canShowSummaryStep ? (
            <p className="text-muted-foreground text-sm">
              Wypelnij wszystkie poprzednie kroki, aby zobaczyc podsumowanie.
            </p>
          ) : selectedService ? (
            <div>
              <div className="space-y-2 mb-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Salon:</span>
                  <span className="font-medium">{salon.name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Usluga:</span>
                  <span className="font-medium">
                    {selectedService.name}
                    {selectedVariant ? ` - ${selectedVariant.name}` : ""}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Pracownik:</span>
                  <span className="font-medium">
                    {(() => {
                      const emp = assignedEmployees.find(
                        (e) => e.id === selectedEmployeeId
                      );
                      return emp
                        ? `${emp.firstName} ${emp.lastName}`
                        : "";
                    })()}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Data:</span>
                  <span className="font-medium">
                    {formatDateDisplay(selectedDate)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Godzina:</span>
                  <span className="font-medium">
                    {selectedTimeSlot} -{" "}
                    {calcEndTime(selectedTimeSlot, effectiveDuration)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Cena:</span>
                  <span className="font-medium">
                    {effectivePrice.toFixed(0)} PLN
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Czas trwania:</span>
                  <span className="font-medium">
                    {formatDuration(effectiveDuration)}
                  </span>
                </div>
              </div>

              {/* Deposit payment section */}
              {depositRequired && depositAmount > 0 && (
                <>
                  <Separator className="my-3" />
                  <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800" data-testid="deposit-info-section">
                    <div className="flex items-center gap-2 mb-3">
                      <Wallet className="w-5 h-5 text-amber-600" />
                      <span className="font-semibold text-amber-800 dark:text-amber-300">
                        Wymagany zadatek
                      </span>
                    </div>
                    <div className="space-y-2 mb-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-amber-700 dark:text-amber-400">Kwota zadatku ({depositPercentage}%):</span>
                        <span className="font-bold text-amber-800 dark:text-amber-200" data-testid="deposit-amount-display">
                          {depositAmount} PLN
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-amber-700 dark:text-amber-400">Pozostalo do zaplaty w salonie:</span>
                        <span className="font-medium text-amber-800 dark:text-amber-200">
                          {(effectivePrice - depositAmount).toFixed(0)} PLN
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
                      Zadatek jest wymagany do potwierdzenia rezerwacji. Pozostala kwota platna w salonie.
                    </p>

                    {/* Payment method selection */}
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Metoda platnosci:</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div
                          className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                            selectedPaymentMethod === "stripe"
                              ? "bg-primary/10 border-primary"
                              : "bg-white dark:bg-background hover:bg-muted/50"
                          }`}
                          onClick={() => setSelectedPaymentMethod("stripe")}
                          data-testid="payment-method-stripe"
                        >
                          <CreditCard className="w-5 h-5 text-primary" />
                          <div>
                            <p className="text-sm font-medium">Karta</p>
                            <p className="text-xs text-muted-foreground">Visa, Mastercard</p>
                          </div>
                          {selectedPaymentMethod === "stripe" && (
                            <Check className="w-4 h-4 text-primary ml-auto" />
                          )}
                        </div>
                        <div
                          className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                            selectedPaymentMethod === "blik"
                              ? "bg-primary/10 border-primary"
                              : "bg-white dark:bg-background hover:bg-muted/50"
                          }`}
                          onClick={() => setSelectedPaymentMethod("blik")}
                          data-testid="payment-method-blik"
                        >
                          <Wallet className="w-5 h-5 text-pink-600" />
                          <div>
                            <p className="text-sm font-medium">BLIK</p>
                            <p className="text-xs text-muted-foreground">Platnosc BLIK</p>
                          </div>
                          {selectedPaymentMethod === "blik" && (
                            <Check className="w-4 h-4 text-primary ml-auto" />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <Button
                className="w-full"
                size="lg"
                onClick={handleBookAppointment}
                disabled={isBooking || isProcessingPayment}
                data-testid="book-appointment-btn"
              >
                {isBooking || isProcessingPayment ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isProcessingPayment ? "Przetwarzanie platnosci..." : "Rezerwowanie..."}
                  </div>
                ) : depositRequired && depositAmount > 0 ? (
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5" />
                    Zaplac zadatek {depositAmount} PLN i zarezerwuj
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <CalendarPlus className="h-5 w-5" />
                    Potwierdz rezerwacje
                  </div>
                )}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Inline render function for service options in Step 1
  // ---------------------------------------------------------------------------

  function renderServiceOption(service: ServiceItem) {
    const isSelected = selectedServiceId === service.id;
    const isExpanded = expandedServices.has(service.id);
    const hasServiceVariants = service.variants.length > 0;

    return (
      <div
        key={service.id}
        className={`border rounded-lg transition-all ${
          isSelected
            ? "bg-primary/10 border-primary"
            : "hover:bg-muted/50 cursor-pointer"
        }`}
        data-testid={`booking-service-option-${service.id}`}
      >
        <div
          className="flex items-center justify-between p-3 cursor-pointer"
          onClick={() => {
            handleServiceSelect(service.id);
          }}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-sm">{service.name}</p>
              {hasServiceVariants && (
                <Badge variant="secondary" className="text-xs px-1.5 py-0">
                  {service.variants.length}{" "}
                  {service.variants.length === 1
                    ? "wariant"
                    : service.variants.length < 5
                      ? "warianty"
                      : "wariantow"}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {formatDuration(service.baseDuration)}
                </span>
              </div>
              {service.depositRequired && (
                <div className="flex items-center gap-1">
                  <CreditCard className="w-3 h-3 text-amber-500" />
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                    Zadatek {service.depositPercentage ?? 30}%
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-semibold whitespace-nowrap">
              {parseFloat(service.basePrice).toFixed(0)} PLN
            </Badge>
            {isSelected && <Check className="w-5 h-5 text-primary" />}
            {hasServiceVariants && (
              <button
                type="button"
                className="text-muted-foreground p-1"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleServiceExpanded(service.id);
                }}
              >
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Show variants preview when expanded */}
        {isExpanded && hasServiceVariants && (
          <div className="px-3 pb-3 border-t bg-muted/30">
            <p className="text-xs font-medium text-muted-foreground mt-2 mb-1.5 uppercase tracking-wider">
              Warianty (wybierzesz w nastepnym kroku)
            </p>
            <div className="space-y-1.5">
              {service.variants.map((variant) => {
                const priceModifier = variant.priceModifier
                  ? parseFloat(variant.priceModifier)
                  : 0;
                const durationModifier = variant.durationModifier || 0;
                const totalPrice =
                  parseFloat(service.basePrice) + priceModifier;
                const totalDuration =
                  service.baseDuration + durationModifier;

                return (
                  <div
                    key={variant.id}
                    className="flex items-center justify-between py-1.5 px-2 rounded bg-background text-sm"
                  >
                    <div>
                      <span className="font-medium">{variant.name}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDuration(totalDuration)}
                        </span>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {totalPrice.toFixed(0)} PLN
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }
}
