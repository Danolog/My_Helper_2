"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  CalendarPlus,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";

import { BookingConfirmation } from "@/components/booking/booking-confirmation";
import { BookingProgressBar } from "@/components/booking/booking-progress-bar";
import { BookingSummary } from "@/components/booking/booking-summary";
import { EmployeeSelector } from "@/components/booking/employee-selector";
import { VariantSelector } from "@/components/booking/promo-code-input";
import { ServiceSelector } from "@/components/booking/service-selector";
import { TimeSlotPicker } from "@/components/booking/time-slot-picker";
import type {
  SalonDetail,
  AssignedEmployee,
  AvailableSlotsData,
} from "@/components/booking/types";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { DEFAULT_DEPOSIT_PERCENTAGE } from "@/lib/constants";

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
  const [blikPhoneNumber, setBlikPhoneNumber] = useState<string>("");
  const [blikPhoneError, setBlikPhoneError] = useState<string>("");
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [_depositPaymentId, setDepositPaymentId] = useState<string>("");
  const [_depositSessionId, setDepositSessionId] = useState<string>("");

  // Guest booking info (when not logged in)
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");

  // Client-specific deposit settings (fetched from salon's client record)
  const [clientDepositSettings, setClientDepositSettings] = useState<{
    found: boolean;
    clientId?: string;
    requireDeposit: boolean;
    depositType: string | null;
    depositValue: string | null;
  } | null>(null);

  // Happy hours promotion state
  const [happyHoursPromo, setHappyHoursPromo] = useState<{
    eligible: boolean;
    promotionId?: string;
    promotionName?: string;
    discountPercent?: number;
    startTime?: string;
    endTime?: string;
    reason?: string;
  } | null>(null);

  // First visit promotion state
  const [firstVisitPromo, setFirstVisitPromo] = useState<{
    eligible: boolean;
    promotionId?: string;
    promotionName?: string;
    discountPercent?: number;
    reason?: string;
  } | null>(null);

  // Step card refs for auto-scroll on progressive disclosure
  const variantStepRef = useRef<HTMLDivElement>(null);
  const employeeStepRef = useRef<HTMLDivElement>(null);
  const dateStepRef = useRef<HTMLDivElement>(null);
  const summaryStepRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const selectedService = salon?.services.find((s) => s.id === selectedServiceId) ?? null;
  const selectedVariant = selectedService?.variants.find((v) => v.id === selectedVariantId) ?? null;

  const hasVariants = (selectedService?.variants.length ?? 0) > 0;

  // Effective price and duration accounting for variant modifiers
  const baseEffectivePrice = selectedService
    ? parseFloat(selectedService.basePrice) +
      (selectedVariant?.priceModifier ? parseFloat(selectedVariant.priceModifier) : 0)
    : 0;

  // Apply happy hours discount if applicable
  const happyHoursDiscountAmount = happyHoursPromo?.eligible && happyHoursPromo.discountPercent
    ? Math.round(baseEffectivePrice * happyHoursPromo.discountPercent) / 100
    : 0;

  // Apply first visit discount if applicable
  const firstVisitDiscountAmount = firstVisitPromo?.eligible && firstVisitPromo.discountPercent
    ? Math.round(baseEffectivePrice * firstVisitPromo.discountPercent) / 100
    : 0;

  // Use the highest applicable discount (don't stack)
  const bestDiscountAmount = Math.max(happyHoursDiscountAmount, firstVisitDiscountAmount);
  const activePromoType: "happy_hours" | "first_visit" | "none" =
    bestDiscountAmount === 0
      ? "none"
      : firstVisitDiscountAmount >= happyHoursDiscountAmount
        ? "first_visit"
        : "happy_hours";
  const effectivePrice = baseEffectivePrice - bestDiscountAmount;

  const effectiveDuration = selectedService
    ? selectedService.baseDuration + (selectedVariant?.durationModifier ?? 0)
    : 0;

  // Deposit calculation - client-level settings override service-level
  const serviceDepositRequired = selectedService?.depositRequired ?? false;
  const serviceDepositPercentage = selectedService?.depositPercentage ?? DEFAULT_DEPOSIT_PERCENTAGE;

  // Client deposit settings take priority over service settings
  const clientRequiresDeposit = clientDepositSettings?.requireDeposit ?? false;
  const clientDepositType = clientDepositSettings?.depositType ?? "percentage";
  const clientDepositValue = clientDepositSettings?.depositValue
    ? parseFloat(clientDepositSettings.depositValue)
    : 0;

  // Deposit is required if either the service or the client requires it
  const depositRequired = serviceDepositRequired || clientRequiresDeposit;

  // Calculate deposit amount based on source (client settings have priority)
  let depositAmount = 0;
  let depositPercentage = serviceDepositPercentage;
  let depositSource: "service" | "client" = "service";

  if (clientRequiresDeposit && clientDepositValue > 0) {
    depositSource = "client";
    if (clientDepositType === "fixed") {
      depositAmount = clientDepositValue;
      depositPercentage = 0; // Not percentage-based
    } else {
      depositPercentage = clientDepositValue;
      depositAmount = Math.ceil(effectivePrice * (clientDepositValue / 100));
    }
  } else if (serviceDepositRequired) {
    depositSource = "service";
    depositPercentage = serviceDepositPercentage;
    depositAmount = Math.ceil(effectivePrice * (serviceDepositPercentage / 100));
  }

  // Suppress unused variable warning
  void depositSource;

  // Whether variant step is required and satisfied
  const variantStepRequired = hasVariants;
  const variantStepSatisfied = !variantStepRequired || selectedVariantId !== "";

  // Determine which step is currently active for progressive disclosure
  const canShowVariantStep = selectedServiceId !== "" && hasVariants;
  const canShowEmployeeStep = selectedServiceId !== "" && variantStepSatisfied;
  const canShowDateStep = canShowEmployeeStep && selectedEmployeeId !== "";
  const canShowSummaryStep =
    canShowDateStep && selectedDate !== "" && selectedTimeSlot !== "";

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchSalon = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/salons/${salonId}`, signal ? { signal } : {});
      const json = await res.json();
      if (json.success) {
        setSalon(json.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    } finally {
      setLoadingSalon(false);
    }
  }, [salonId]);

  useEffect(() => {
    const abortController = new AbortController();
    fetchSalon(abortController.signal);
    return () => abortController.abort();
  }, [fetchSalon]);

  // Fetch client-specific deposit settings when session and salon are available
  useEffect(() => {
    if (!session?.user?.email || !salonId) return;

    const abortController = new AbortController();

    async function fetchClientDepositSettings() {
      try {
        const res = await fetch(
          `/api/clients/deposit-settings?salonId=${salonId}&email=${encodeURIComponent(session!.user!.email!)}`,
          { signal: abortController.signal }
        );
        const json = await res.json();
        if (json.success) {
          setClientDepositSettings(json.data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    fetchClientDepositSettings();

    return () => abortController.abort();
  }, [session?.user?.email, salonId]);

  const fetchAssignedEmployees = useCallback(
    async (serviceId: string, signal?: AbortSignal) => {
      if (!serviceId || !salonId) {
        setAssignedEmployees([]);
        return;
      }
      setLoadingEmployees(true);
      try {
        const res = await fetch(`/api/salons/${salonId}/services/${serviceId}`, signal ? { signal } : {});
        const json = await res.json();
        if (json.success && json.data.employees) {
          const emps: AssignedEmployee[] = json.data.employees.map(
            (emp: { id: string; firstName: string; lastName: string; role: string; color: string | null }) => ({
              id: emp.id,
              firstName: emp.firstName,
              lastName: emp.lastName,
              role: emp.role,
              isActive: true,
              color: emp.color,
            })
          );
          setAssignedEmployees(emps);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      } finally {
        setLoadingEmployees(false);
      }
    },
    [salonId]
  );

  const fetchAvailableSlots = useCallback(
    async (employeeId: string, date: string, duration: number, signal?: AbortSignal) => {
      if (!employeeId || !date || !duration) {
        setSlotsData(null);
        return;
      }
      setLoadingSlots(true);
      setSelectedTimeSlot("");
      try {
        const res = await fetch(
          `/api/available-slots?employeeId=${employeeId}&date=${date}&duration=${duration}`,
          signal ? { signal } : {}
        );
        const json = await res.json();
        if (json.success) {
          setSlotsData(json.data);
        } else {
          toast.error(json.error || "Nie udalo sie zaladowac dostepnych terminow");
          setSlotsData(null);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
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
      const abortController = new AbortController();
      fetchAvailableSlots(selectedEmployeeId, selectedDate, effectiveDuration, abortController.signal);
      return () => abortController.abort();
    }

    setSlotsData(null);
    setSelectedTimeSlot("");
    return undefined;
  }, [selectedEmployeeId, selectedDate, effectiveDuration, fetchAvailableSlots]);

  // Check first visit promotion when service is selected
  useEffect(() => {
    const emailForCheck = session?.user?.email || guestEmail;
    if (!salonId || !selectedServiceId || !emailForCheck) {
      setFirstVisitPromo(null);
      return;
    }

    const abortController = new AbortController();

    async function checkFirstVisit() {
      try {
        const res = await fetch(
          `/api/promotions/check-first-visit?salonId=${salonId}&email=${encodeURIComponent(emailForCheck!)}&serviceId=${selectedServiceId}`,
          { signal: abortController.signal }
        );
        const json = await res.json();
        if (json.success) {
          setFirstVisitPromo(json.data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setFirstVisitPromo(null);
      }
    }
    checkFirstVisit();

    return () => abortController.abort();
  }, [salonId, session?.user?.email, guestEmail, selectedServiceId]);

  // Check happy hours promotion when time slot is selected
  useEffect(() => {
    if (!selectedDate || !selectedTimeSlot || !salonId) {
      setHappyHoursPromo(null);
      return;
    }

    const abortController = new AbortController();

    async function checkHappyHours() {
      try {
        const res = await fetch(
          `/api/promotions/check-happy-hours?salonId=${salonId}&date=${selectedDate}&time=${selectedTimeSlot}`,
          { signal: abortController.signal }
        );
        const json = await res.json();
        if (json.success) {
          setHappyHoursPromo(json.data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setHappyHoursPromo(null);
      }
    }
    checkHappyHours();

    return () => abortController.abort();
  }, [selectedDate, selectedTimeSlot, salonId]);

  // ---------------------------------------------------------------------------
  // Auto-scroll to next step when a selection is made
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!selectedServiceId) return;
    const service = salon?.services.find((s) => s.id === selectedServiceId);
    if (!service) return;

    const hasServiceVariants = service.variants.length > 0;
    const targetRef = hasServiceVariants ? variantStepRef : employeeStepRef;
    const timer = setTimeout(() => {
      targetRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
    return () => clearTimeout(timer);
  }, [selectedServiceId, salon?.services]);

  useEffect(() => {
    if (!selectedVariantId) return;
    const timer = setTimeout(() => {
      employeeStepRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
    return () => clearTimeout(timer);
  }, [selectedVariantId]);

  useEffect(() => {
    if (!selectedEmployeeId) return;
    const timer = setTimeout(() => {
      dateStepRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
    return () => clearTimeout(timer);
  }, [selectedEmployeeId]);

  useEffect(() => {
    if (!selectedTimeSlot) return;
    const timer = setTimeout(() => {
      summaryStepRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
    return () => clearTimeout(timer);
  }, [selectedTimeSlot]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleServiceSelect(serviceId: string) {
    setSelectedServiceId(serviceId);
    setSelectedVariantId("");
    setSelectedEmployeeId("");
    setSelectedDate("");
    setSelectedTimeSlot("");
    setSlotsData(null);
    setAssignedEmployees([]);

    const service = salon?.services.find((s) => s.id === serviceId);
    if (service && service.variants.length === 0) {
      fetchAssignedEmployees(serviceId);
    }
  }

  function handleVariantSelect(variantId: string) {
    setSelectedVariantId(variantId);
    setSelectedEmployeeId("");
    setSelectedDate("");
    setSelectedTimeSlot("");
    setSlotsData(null);

    if (selectedServiceId) {
      fetchAssignedEmployees(selectedServiceId);
    }
  }

  function handleEmployeeSelect(empId: string) {
    setSelectedEmployeeId(empId);
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

  function handleBackToService() {
    setSelectedServiceId("");
    setSelectedVariantId("");
    setSelectedEmployeeId("");
    setSelectedDate("");
    setSelectedTimeSlot("");
    setSlotsData(null);
    setAssignedEmployees([]);
  }

  function handleBackToEmployee() {
    setSelectedEmployeeId("");
    setSelectedDate("");
    setSelectedTimeSlot("");
    setSlotsData(null);
  }

  function handleBackToDateTime() {
    setSelectedDate("");
    setSelectedTimeSlot("");
    setSlotsData(null);
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

    if (!session) {
      if (!guestName.trim() || !guestPhone.trim()) {
        toast.error("Podaj imie i numer telefonu");
        return;
      }
    }

    const startTime = new Date(`${selectedDate}T${selectedTimeSlot}:00`);
    const endTime = new Date(startTime.getTime() + effectiveDuration * 60000);
    const variantName = selectedVariant?.name ?? "";
    const notesText = `Rezerwacja online: ${selectedService.name}${variantName ? ` - ${variantName}` : ""}`;

    // If deposit is required, use the deposit flow
    if (depositRequired && depositAmount > 0) {
      // Validate Blik phone number if Blik P2P selected
      if (selectedPaymentMethod === "blik") {
        const cleanedPhone = blikPhoneNumber.replace(/[\s\-()]/g, "");
        const phoneRegex = /^(\+48)?[0-9]{9}$/;
        if (!cleanedPhone || !phoneRegex.test(cleanedPhone)) {
          setBlikPhoneError("Podaj prawidlowy 9-cyfrowy numer telefonu");
          toast.error("Podaj prawidlowy numer telefonu dla platnosci BLIK");
          return;
        }
        setBlikPhoneError("");
      }

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
          ...(selectedPaymentMethod === "blik" ? { blikPhoneNumber: blikPhoneNumber.replace(/[\s\-()]/g, "") } : {}),
          ...((!session) ? { guestName: guestName.trim(), guestPhone: guestPhone.trim(), guestEmail: guestEmail.trim() || null } : {}),
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

        // Step 2: Simulate processing the payment
        if (selectedPaymentMethod === "blik") {
          toast.info(`Wysylanie zadania platnosci BLIK na numer ${blikPhoneNumber}...`, { duration: 2000 });
        } else {
          toast.info("Przetwarzanie platnosci zadatku...", { duration: 2000 });
        }
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
      } catch {
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
        ...((!session) ? { guestName: guestName.trim(), guestPhone: guestPhone.trim(), guestEmail: guestEmail.trim() || null } : {}),
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
    } catch {
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
    setBlikPhoneNumber("");
    setBlikPhoneError("");
    setIsProcessingPayment(false);
    setDepositPaymentId("");
    setDepositSessionId("");
    setHappyHoursPromo(null);
    setFirstVisitPromo(null);
    setGuestName("");
    setGuestPhone("");
    setGuestEmail("");
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
    return (
      <BookingConfirmation
        salonId={salonId}
        salonName={salon.name}
        selectedService={selectedService}
        selectedVariant={selectedVariant}
        assignedEmployees={assignedEmployees}
        selectedEmployeeId={selectedEmployeeId}
        selectedDate={selectedDate}
        selectedTimeSlot={selectedTimeSlot}
        effectiveDuration={effectiveDuration}
        baseEffectivePrice={baseEffectivePrice}
        effectivePrice={effectivePrice}
        bestDiscountAmount={bestDiscountAmount}
        activePromoType={activePromoType}
        happyHoursPromo={happyHoursPromo}
        firstVisitPromo={firstVisitPromo}
        depositRequired={depositRequired}
        depositAmount={depositAmount}
        selectedPaymentMethod={selectedPaymentMethod}
        blikPhoneNumber={blikPhoneNumber}
        onReset={resetBooking}
      />
    );
  }

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

      {/* Progress bar */}
      <BookingProgressBar
        steps={[
          {
            label: "Usluga",
            completed: selectedServiceId !== "" && variantStepSatisfied,
            active: selectedServiceId === "" || !variantStepSatisfied,
          },
          {
            label: "Pracownik",
            completed: selectedEmployeeId !== "",
            active: canShowEmployeeStep && selectedEmployeeId === "",
          },
          {
            label: "Termin",
            completed: selectedDate !== "" && selectedTimeSlot !== "",
            active: canShowDateStep && (selectedDate === "" || selectedTimeSlot === ""),
          },
          {
            label: "Potwierdzenie",
            completed: bookingSuccess,
            active: canShowSummaryStep && !bookingSuccess,
          },
        ]}
      />

      {/* Step 1: Select Service */}
      <ServiceSelector
        services={salon.services}
        categories={salon.categories}
        selectedServiceId={selectedServiceId}
        expandedServices={expandedServices}
        onServiceSelect={handleServiceSelect}
        onToggleExpanded={toggleServiceExpanded}
      />

      {/* Step 2: Select Variant (only if service has variants) */}
      <VariantSelector
        ref={variantStepRef}
        canShow={canShowVariantStep}
        selectedService={selectedService}
        selectedVariantId={selectedVariantId}
        onVariantSelect={handleVariantSelect}
      />

      {/* Step 3: Select Employee */}
      <EmployeeSelector
        ref={employeeStepRef}
        canShow={canShowEmployeeStep}
        hasSelectedService={selectedServiceId !== ""}
        hasVariants={hasVariants}
        stepNumber={hasVariants ? 3 : 2}
        assignedEmployees={assignedEmployees}
        loadingEmployees={loadingEmployees}
        selectedEmployeeId={selectedEmployeeId}
        onEmployeeSelect={handleEmployeeSelect}
        onBackToService={handleBackToService}
      />

      {/* Step 4: Select Date & Time */}
      <TimeSlotPicker
        ref={dateStepRef}
        canShow={canShowDateStep}
        hasVariants={hasVariants}
        stepNumber={hasVariants ? 4 : 3}
        selectedDate={selectedDate}
        selectedTimeSlot={selectedTimeSlot}
        slotsData={slotsData}
        loadingSlots={loadingSlots}
        effectiveDuration={effectiveDuration}
        onDateChange={handleDateChange}
        onNavigateDate={navigateDate}
        onTimeSlotSelect={setSelectedTimeSlot}
        onBackToEmployee={handleBackToEmployee}
      />

      {/* Step 5: Review & Confirm */}
      <BookingSummary
        ref={summaryStepRef}
        canShow={canShowSummaryStep}
        hasVariants={hasVariants}
        stepNumber={hasVariants ? 5 : 4}
        salon={{ name: salon.name }}
        selectedService={selectedService}
        selectedVariant={selectedVariant}
        assignedEmployees={assignedEmployees}
        selectedEmployeeId={selectedEmployeeId}
        selectedDate={selectedDate}
        selectedTimeSlot={selectedTimeSlot}
        effectiveDuration={effectiveDuration}
        isLoggedIn={!!session}
        isBooking={isBooking}
        isProcessingPayment={isProcessingPayment}
        promotion={{
          activePromoType,
          bestDiscountAmount,
          baseEffectivePrice,
          effectivePrice,
          happyHoursPromo,
          firstVisitPromo,
        }}
        deposit={{
          depositRequired,
          depositAmount,
          depositPercentage,
        }}
        guest={{
          guestName,
          guestPhone,
          guestEmail,
          onGuestNameChange: setGuestName,
          onGuestPhoneChange: setGuestPhone,
          onGuestEmailChange: setGuestEmail,
        }}
        payment={{
          selectedPaymentMethod,
          blikPhoneNumber,
          blikPhoneError,
          onPaymentMethodChange: setSelectedPaymentMethod,
          onBlikPhoneChange: setBlikPhoneNumber,
          onBlikPhoneErrorClear: () => setBlikPhoneError(""),
        }}
        onBackToDateTime={handleBackToDateTime}
        onBook={handleBookAppointment}
      />
    </div>
  );
}
