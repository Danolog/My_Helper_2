"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { useSalonId } from "@/hooks/use-salon-id";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Lock, CalendarPlus, Scissors, Users, User, Star, Clock, CalendarDays, Check, AlertCircle, ChevronLeft, ChevronRight, Gift, Package, Tag, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

const NO_CLIENT = "__no_client__";

interface Service {
  id: string;
  name: string;
  basePrice: string;
  baseDuration: number;
  isActive: boolean;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  color: string | null;
}

interface Client {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  favoriteEmployeeId: string | null;
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

interface PromotionCheck {
  eligible: boolean;
  appointmentCount?: number;
  remainingForPromo?: number;
  promotionId?: string;
  promotionName?: string;
  discountPercent?: number;
  originalPrice?: number;
  discountAmount?: number;
  finalPrice?: number;
  reason?: string;
}

interface PackageInfo {
  id: string;
  name: string;
  packagePrice: number;
  totalIndividualPrice: number;
  savings: number;
  totalDuration: number;
  services: Array<{
    id: string;
    name: string;
    basePrice: string;
    baseDuration: number;
  }>;
}

interface PromoCodeValidation {
  valid: boolean;
  reason?: string;
  errorType?: string;
  code?: string;
  promoCodeId?: string;
  promotionId?: string;
  promotionName?: string;
  discountType?: string;
  discountValue?: number;
  usedCount?: number;
  usageLimit?: number | null;
  expiresAt?: string | null;
  conditionsJson?: Record<string, unknown>;
}

export default function BookingPage() {
  const { data: session, isPending } = useSession();
  const { salonId } = useSalonId();
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string>("");
  const [availableEmployees, setAvailableEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [loadingServices, setLoadingServices] = useState(true);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  // Client selection state
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [loadingClients, setLoadingClients] = useState(true);

  // Date and time slot state
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [slotsData, setSlotsData] = useState<AvailableSlotsData | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState<string>("");

  // Promotion check state
  const [promoCheck, setPromoCheck] = useState<PromotionCheck | null>(null);
  const [loadingPromo, setLoadingPromo] = useState(false);

  // Promo code state
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [promoCodeValidation, setPromoCodeValidation] = useState<PromoCodeValidation | null>(null);
  const [validatingPromoCode, setValidatingPromoCode] = useState(false);

  // Booking submission state
  const [isBooking, setIsBooking] = useState(false);

  // Package booking state
  const [availablePackages, setAvailablePackages] = useState<PackageInfo[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string>("");
  const [bookingMode, setBookingMode] = useState<"service" | "package">("service");
  const [packageEmployeeId, setPackageEmployeeId] = useState<string>("");
  const [packageDate, setPackageDate] = useState<string>("");
  const [packageTimeSlot, setPackageTimeSlot] = useState<string>("");
  const [packageSlotsData, setPackageSlotsData] = useState<AvailableSlotsData | null>(null);
  const [loadingPackageSlots, setLoadingPackageSlots] = useState(false);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [loadingAllEmployees, setLoadingAllEmployees] = useState(false);

  const fetchServices = useCallback(async () => {
    if (!salonId) return;
    try {
      setLoadingServices(true);
      const res = await fetch(`/api/services?salonId=${salonId}&activeOnly=true`);
      const data = await res.json();
      if (data.success) {
        setServices(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch services:", error);
    } finally {
      setLoadingServices(false);
    }
  }, [salonId]);

  const fetchClients = useCallback(async () => {
    if (!salonId) return;
    try {
      setLoadingClients(true);
      const res = await fetch(`/api/clients?salonId=${salonId}`);
      const data = await res.json();
      if (data.success) {
        setClients(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch clients:", error);
    } finally {
      setLoadingClients(false);
    }
  }, [salonId]);

  const fetchPackages = useCallback(async () => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/promotions/check-package?salonId=${salonId}`);
      const data = await res.json();
      if (data.success) {
        setAvailablePackages(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch packages:", error);
    }
  }, [salonId]);

  const fetchAllEmployees = useCallback(async () => {
    if (!salonId) return;
    setLoadingAllEmployees(true);
    try {
      const res = await fetch(`/api/employees?salonId=${salonId}`);
      const data = await res.json();
      if (data.success) {
        setAllEmployees(data.data.filter((e: Employee) => e.isActive));
      }
    } catch (error) {
      console.error("Failed to fetch employees:", error);
    } finally {
      setLoadingAllEmployees(false);
    }
  }, [salonId]);

  useEffect(() => {
    fetchServices();
    fetchClients();
    fetchPackages();
  }, [fetchServices, fetchClients, fetchPackages]);

  // When a service is selected, fetch assigned employees
  const fetchAssignedEmployees = useCallback(async (serviceId: string) => {
    if (!serviceId) {
      setAvailableEmployees([]);
      return;
    }

    setLoadingEmployees(true);
    try {
      const res = await fetch(`/api/services/${serviceId}/employee-assignments`);
      const data = await res.json();
      if (data.success) {
        // Extract employee objects from assignments
        const employees: Employee[] = data.data
          .map((assignment: { employee: Employee | null }) => assignment.employee)
          .filter((emp: Employee | null): emp is Employee => emp !== null && emp.isActive);
        setAvailableEmployees(employees);
      }
    } catch (error) {
      console.error("Failed to fetch assigned employees:", error);
    } finally {
      setLoadingEmployees(false);
    }
  }, []);

  // Fetch available slots when employee and date change
  const fetchAvailableSlots = useCallback(async (employeeId: string, date: string, duration: number) => {
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
      const data = await res.json();
      if (data.success) {
        setSlotsData(data.data);
      } else {
        toast.error(data.error || "Nie udalo sie zaladowac dostepnych terminow");
        setSlotsData(null);
      }
    } catch (error) {
      console.error("Failed to fetch available slots:", error);
      toast.error("Blad pobierania dostepnych terminow");
      setSlotsData(null);
    } finally {
      setLoadingSlots(false);
    }
  }, []);

  // Check for applicable promotions when client and service are selected
  const checkPromotions = useCallback(async (clientId: string, serviceId: string) => {
    if (!clientId || !serviceId || !salonId) {
      setPromoCheck(null);
      return;
    }

    setLoadingPromo(true);
    try {
      const res = await fetch(
        `/api/promotions/check?salonId=${salonId}&clientId=${clientId}&serviceId=${serviceId}`
      );
      const data = await res.json();
      if (data.success) {
        setPromoCheck(data.data);
      } else {
        setPromoCheck(null);
      }
    } catch (error) {
      console.error("Failed to check promotions:", error);
      setPromoCheck(null);
    } finally {
      setLoadingPromo(false);
    }
  }, [salonId]);

  // Re-check promotions when client or service changes
  useEffect(() => {
    if (selectedClientId && selectedServiceId) {
      checkPromotions(selectedClientId, selectedServiceId);
    } else {
      setPromoCheck(null);
    }
  }, [selectedClientId, selectedServiceId, checkPromotions]);

  // Validate promo code
  const handleValidatePromoCode = async () => {
    const code = promoCodeInput.trim();
    if (!code) {
      toast.error("Wpisz kod promocyjny");
      return;
    }

    setValidatingPromoCode(true);
    try {
      const res = await fetch("/api/promo-codes/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          salonId: salonId,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setPromoCodeValidation(data.data);
        if (data.data.valid) {
          toast.success(`Kod "${data.data.code}" zastosowany! ${data.data.promotionName || "Znizka aktywna"}`);
        } else {
          toast.error(data.data.reason || "Nieprawidlowy kod promocyjny");
        }
      } else {
        toast.error("Nie udalo sie zwalidowac kodu");
        setPromoCodeValidation(null);
      }
    } catch (error) {
      console.error("Failed to validate promo code:", error);
      toast.error("Blad walidacji kodu promocyjnego");
      setPromoCodeValidation(null);
    } finally {
      setValidatingPromoCode(false);
    }
  };

  // Clear promo code
  const handleClearPromoCode = () => {
    setPromoCodeInput("");
    setPromoCodeValidation(null);
  };

  // Calculate discount from promo code
  const getPromoCodeDiscount = () => {
    if (!promoCodeValidation?.valid || !selectedService) return null;

    const basePrice = parseFloat(selectedService.basePrice);
    const discountType = promoCodeValidation.discountType;
    const discountValue = promoCodeValidation.discountValue || 0;

    // Check if service is in the applicable services list (if conditions exist)
    const conditions = promoCodeValidation.conditionsJson as { applicableServiceIds?: string[] } | undefined;
    if (conditions?.applicableServiceIds && conditions.applicableServiceIds.length > 0) {
      if (!conditions.applicableServiceIds.includes(selectedServiceId)) {
        return null; // Service not eligible for this promo code
      }
    }

    let discountAmount = 0;
    if (discountType === "percentage") {
      discountAmount = basePrice * (discountValue / 100);
    } else if (discountType === "fixed") {
      discountAmount = Math.min(discountValue, basePrice);
    } else {
      // For other types (buy2get1, happy_hours, first_visit, package) - use the value as percentage
      discountAmount = basePrice * (discountValue / 100);
    }

    return {
      discountAmount: Math.round(discountAmount * 100) / 100,
      finalPrice: Math.round((basePrice - discountAmount) * 100) / 100,
      originalPrice: basePrice,
      discountType,
      discountValue,
    };
  };

  // Auto-fetch slots when employee or date changes
  useEffect(() => {
    const selectedService = services.find((s) => s.id === selectedServiceId);
    if (selectedEmployeeId && selectedDate && selectedService) {
      fetchAvailableSlots(selectedEmployeeId, selectedDate, selectedService.baseDuration);
    } else {
      setSlotsData(null);
      setSelectedTimeSlot("");
    }
  }, [selectedEmployeeId, selectedDate, selectedServiceId, services, fetchAvailableSlots]);

  const handleServiceChange = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setSelectedEmployeeId(""); // Reset employee selection
    setSelectedDate("");
    setSelectedTimeSlot("");
    setSlotsData(null);
    fetchAssignedEmployees(serviceId);
  };

  // Get the selected client's favorite employee ID
  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const favoriteEmployeeId = selectedClient?.favoriteEmployeeId || null;

  const handleClientChange = (clientId: string) => {
    const actualClientId = clientId === NO_CLIENT ? "" : clientId;
    setSelectedClientId(actualClientId);

    // If client has a favorite employee and that employee is available, auto-select them
    if (actualClientId) {
      const client = clients.find((c) => c.id === actualClientId);
      if (client?.favoriteEmployeeId) {
        const isFavoriteAvailable = availableEmployees.some(
          (e) => e.id === client.favoriteEmployeeId
        );
        if (isFavoriteAvailable) {
          setSelectedEmployeeId(client.favoriteEmployeeId);
          const favEmp = availableEmployees.find(
            (e) => e.id === client.favoriteEmployeeId
          );
          if (favEmp) {
            toast.info(
              `Automatycznie wybrano ulubionego pracownika: ${favEmp.firstName} ${favEmp.lastName}`,
              { duration: 3000 }
            );
          }
        }
      }
    }
  };

  const handleEmployeeSelect = (empId: string) => {
    setSelectedEmployeeId(empId);
    // Reset time slot when employee changes
    setSelectedTimeSlot("");
  };

  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    setSelectedTimeSlot("");
  };

  const navigateDate = (direction: number) => {
    const current = selectedDate ? new Date(selectedDate) : new Date();
    current.setDate(current.getDate() + direction);
    const yyyy = current.getFullYear();
    const mm = String(current.getMonth() + 1).padStart(2, "0");
    const dd = String(current.getDate()).padStart(2, "0");
    handleDateChange(`${yyyy}-${mm}-${dd}`);
  };

  // Book the appointment
  const handleBookAppointment = async () => {
    const selectedService = services.find((s) => s.id === selectedServiceId);
    if (!selectedService || !selectedEmployeeId || !selectedDate || !selectedTimeSlot) {
      toast.error("Wypelnij wszystkie wymagane pola");
      return;
    }

    setIsBooking(true);
    try {
      const startTime = new Date(`${selectedDate}T${selectedTimeSlot}:00`);
      const endTime = new Date(startTime.getTime() + selectedService.baseDuration * 60000);

      // Calculate promo code discount if applicable
      const promoDiscount = getPromoCodeDiscount();
      const appointmentBody: Record<string, unknown> = {
        salonId: salonId,
        clientId: selectedClientId || null,
        employeeId: selectedEmployeeId,
        serviceId: selectedServiceId,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        notes: `Rezerwacja online: ${selectedService.name}`,
      };

      // Add promo code data if valid
      if (promoCodeValidation?.valid && promoCodeValidation.promoCodeId && promoDiscount) {
        appointmentBody.promoCodeId = promoCodeValidation.promoCodeId;
        appointmentBody.discountAmount = promoDiscount.discountAmount.toFixed(2);
      }

      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(appointmentBody),
      });

      const data = await res.json();
      if (data.success) {
        const discountMsg = promoDiscount
          ? ` Zastosowano znizke: -${promoDiscount.discountAmount.toFixed(2)} PLN`
          : "";
        toast.success(`Wizyta zarezerwowana pomyslnie!${discountMsg}`, { duration: 4000 });
        // Refresh slots to show the newly booked slot as unavailable
        fetchAvailableSlots(selectedEmployeeId, selectedDate, selectedService.baseDuration);
        setSelectedTimeSlot("");
        // Clear promo code after successful booking
        handleClearPromoCode();
      } else {
        toast.error(data.error || "Nie udalo sie zarezerwowac wizyty");
      }
    } catch (error) {
      console.error("Failed to book appointment:", error);
      toast.error("Blad rezerwacji wizyty");
    } finally {
      setIsBooking(false);
    }
  };

  // Package booking: fetch slots when employee and date change
  const fetchPackageSlots = useCallback(async (empId: string, date: string, duration: number) => {
    if (!empId || !date || !duration) {
      setPackageSlotsData(null);
      return;
    }
    setLoadingPackageSlots(true);
    setPackageTimeSlot("");
    try {
      const res = await fetch(
        `/api/available-slots?employeeId=${empId}&date=${date}&duration=${duration}`
      );
      const data = await res.json();
      if (data.success) {
        setPackageSlotsData(data.data);
      } else {
        setPackageSlotsData(null);
      }
    } catch {
      setPackageSlotsData(null);
    } finally {
      setLoadingPackageSlots(false);
    }
  }, []);

  useEffect(() => {
    const selectedPackage = availablePackages.find((p) => p.id === selectedPackageId);
    if (packageEmployeeId && packageDate && selectedPackage) {
      fetchPackageSlots(packageEmployeeId, packageDate, selectedPackage.totalDuration);
    } else {
      setPackageSlotsData(null);
      setPackageTimeSlot("");
    }
  }, [packageEmployeeId, packageDate, selectedPackageId, availablePackages, fetchPackageSlots]);

  const handleSelectPackage = (pkgId: string) => {
    setSelectedPackageId(pkgId);
    setPackageEmployeeId("");
    setPackageDate("");
    setPackageTimeSlot("");
    setPackageSlotsData(null);
    if (!allEmployees.length) {
      fetchAllEmployees();
    }
  };

  const handleBookPackage = async () => {
    const selectedPackage = availablePackages.find((p) => p.id === selectedPackageId);
    if (!selectedPackage || !packageEmployeeId || !packageDate || !packageTimeSlot) {
      toast.error("Wypelnij wszystkie wymagane pola");
      return;
    }

    setIsBooking(true);
    try {
      const startTime = new Date(`${packageDate}T${packageTimeSlot}:00`);

      const res = await fetch("/api/appointments/book-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promotionId: selectedPackageId,
          employeeId: packageEmployeeId,
          clientId: selectedClientId || null,
          date: packageDate,
          startTime: startTime.toISOString(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success(
          `Pakiet "${data.data.packageName}" zarezerwowany! ${data.data.appointments.length} wizyt utworzonych. Cena: ${data.data.packagePrice.toFixed(2)} PLN (oszczednosc: ${data.data.savings.toFixed(2)} PLN)`,
          { duration: 6000 }
        );
        // Refresh slots
        fetchPackageSlots(packageEmployeeId, packageDate, selectedPackage.totalDuration);
        setPackageTimeSlot("");
      } else {
        toast.error(data.error || "Nie udalo sie zarezerwowac pakietu");
      }
    } catch (error) {
      console.error("Failed to book package:", error);
      toast.error("Blad rezerwacji pakietu");
    } finally {
      setIsBooking(false);
    }
  };

  if (isPending) {
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
          <p className="text-muted-foreground mb-6">
            Musisz sie zalogowac, aby zarezerwowac wizyte
          </p>
        </div>
      </div>
    );
  }

  const selectedService = services.find((s) => s.id === selectedServiceId);

  // Get today's date as minimum for date picker
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Format date for display
  const formatDateDisplay = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T12:00:00");
    const dayNames = ["Niedziela", "Poniedzialek", "Wtorek", "Sroda", "Czwartek", "Piatek", "Sobota"];
    const monthNames = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paz", "lis", "gru"];
    return `${dayNames[d.getDay()]}, ${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
  };

  // Check if booking is ready
  const canBook = selectedServiceId && selectedEmployeeId && selectedDate && selectedTimeSlot && !isBooking;

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <CalendarPlus className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Rezerwacja wizyty</h1>
          <p className="text-muted-foreground text-sm">
            Wybierz klienta, usluge, pracownika i dostepny termin
          </p>
        </div>
      </div>

      {/* Booking mode toggle */}
      {availablePackages.length > 0 && (
        <div className="flex gap-2 mb-6" data-testid="booking-mode-toggle">
          <Button
            variant={bookingMode === "service" ? "default" : "outline"}
            onClick={() => { setBookingMode("service"); setSelectedPackageId(""); }}
            className="flex-1"
          >
            <Scissors className="w-4 h-4 mr-2" />
            Pojedyncza usluga
          </Button>
          <Button
            variant={bookingMode === "package" ? "default" : "outline"}
            onClick={() => setBookingMode("package")}
            className="flex-1"
          >
            <Package className="w-4 h-4 mr-2" />
            Pakiet uslug ({availablePackages.length})
          </Button>
        </div>
      )}

      {/* Package Booking Flow */}
      {bookingMode === "package" && (
        <>
          {/* Package Client Selection */}
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center gap-2">
                <User className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">1. Wybierz klienta</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedClientId || NO_CLIENT}
                onValueChange={handleClientChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Wybierz klienta..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLIENT}>Brak klienta (walk-in)</SelectItem>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.firstName} {client.lastName}
                      {client.phone ? ` (${client.phone})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Package Selection */}
          <Card className="mb-6" data-testid="package-selection-section">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">2. Wybierz pakiet</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {availablePackages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                      selectedPackageId === pkg.id
                        ? "bg-primary/10 border-primary"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => handleSelectPackage(pkg.id)}
                    data-testid={`package-option-${pkg.id}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold">{pkg.name}</h3>
                      <div className="text-right">
                        <span className="text-lg font-bold text-green-600">
                          {pkg.packagePrice.toFixed(2)} PLN
                        </span>
                        <span className="text-xs text-muted-foreground line-through ml-2">
                          {pkg.totalIndividualPrice.toFixed(2)} PLN
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {pkg.services.map((svc) => (
                        <Badge key={svc.id} variant="outline" className="text-xs">
                          {svc.name} ({svc.baseDuration} min)
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>Oszczedzasz: {pkg.savings.toFixed(2)} PLN</span>
                      <span>Laczny czas: {pkg.totalDuration} min</span>
                    </div>
                    {selectedPackageId === pkg.id && (
                      <Badge variant="default" className="mt-2">Wybrany</Badge>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Package Employee Selection */}
          {selectedPackageId && (
            <Card className="mb-6" data-testid="package-employee-section">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">3. Wybierz pracownika</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {loadingAllEmployees ? (
                  <div className="flex justify-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                  </div>
                ) : allEmployees.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Brak dostepnych pracownikow.</p>
                ) : (
                  <div className="space-y-2">
                    {allEmployees.map((emp) => (
                      <div
                        key={emp.id}
                        className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                          packageEmployeeId === emp.id
                            ? "bg-primary/10 border-primary"
                            : "hover:bg-muted/50"
                        }`}
                        onClick={() => {
                          setPackageEmployeeId(emp.id);
                          setPackageTimeSlot("");
                        }}
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
                        {packageEmployeeId === emp.id && (
                          <Badge variant="default" className="ml-auto text-xs">Wybrany</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Package Date Selection */}
          {packageEmployeeId && (
            <Card className="mb-6" data-testid="package-date-section">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">4. Wybierz date</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <Input
                  type="date"
                  value={packageDate}
                  min={todayStr}
                  onChange={(e) => { setPackageDate(e.target.value); setPackageTimeSlot(""); }}
                  data-testid="package-date-input"
                />
              </CardContent>
            </Card>
          )}

          {/* Package Time Slot Selection */}
          {packageDate && packageEmployeeId && (
            <Card className="mb-6" data-testid="package-slots-section">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg">5. Wybierz godzine</CardTitle>
                  {packageSlotsData && !packageSlotsData.dayOff && (
                    <Badge variant="outline">
                      {packageSlotsData.slots.length} wolnych terminow
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {loadingPackageSlots ? (
                  <div className="flex justify-center py-6">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                  </div>
                ) : packageSlotsData?.dayOff ? (
                  <div className="text-center py-6">
                    <AlertCircle className="w-10 h-10 text-orange-500 mx-auto mb-3" />
                    <p className="text-muted-foreground font-medium">
                      Pracownik nie pracuje w tym dniu
                    </p>
                  </div>
                ) : packageSlotsData && packageSlotsData.slots.length === 0 ? (
                  <div className="text-center py-6">
                    <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground font-medium">Brak wolnych terminow</p>
                  </div>
                ) : packageSlotsData ? (
                  <div>
                    <div className="grid grid-cols-4 gap-2" data-testid="package-time-slots-grid">
                      {packageSlotsData.slots.map((slot) => (
                        <Button
                          key={slot.time}
                          variant={packageTimeSlot === slot.time ? "default" : "outline"}
                          size="sm"
                          className="text-sm"
                          onClick={() => setPackageTimeSlot(slot.time)}
                          data-testid={`package-slot-${slot.time}`}
                        >
                          {slot.time}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}

          {/* Package Booking Summary */}
          {packageTimeSlot && selectedPackageId && packageEmployeeId && (() => {
            const pkg = availablePackages.find((p) => p.id === selectedPackageId);
            if (!pkg) return null;
            const emp = allEmployees.find((e) => e.id === packageEmployeeId);
            const startParts = packageTimeSlot.split(":").map(Number);
            const startMinutes = (startParts[0] ?? 0) * 60 + (startParts[1] ?? 0);
            const endMinutes = startMinutes + pkg.totalDuration;
            const endH = Math.floor(endMinutes / 60);
            const endM = endMinutes % 60;
            const endTimeStr = `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;

            return (
              <Card className="mb-6 border-primary" data-testid="package-booking-summary">
                <CardHeader>
                  <CardTitle className="text-lg">Podsumowanie pakietu</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 mb-4">
                    {selectedClient && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Klient:</span>
                        <span className="font-medium">{selectedClient.firstName} {selectedClient.lastName}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Pakiet:</span>
                      <span className="font-medium">{pkg.name}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Pracownik:</span>
                      <span className="font-medium">{emp ? `${emp.firstName} ${emp.lastName}` : ""}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Data:</span>
                      <span className="font-medium">{formatDateDisplay(packageDate)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Godzina:</span>
                      <span className="font-medium">{packageTimeSlot} - {endTimeStr}</span>
                    </div>
                    <div className="border-t pt-2 mt-2">
                      <p className="text-xs text-muted-foreground mb-1">Uslugi w pakiecie:</p>
                      {pkg.services.map((svc) => (
                        <div key={svc.id} className="flex justify-between text-xs">
                          <span>{svc.name} ({svc.baseDuration} min)</span>
                          <span className="line-through text-muted-foreground">{parseFloat(svc.basePrice).toFixed(2)} PLN</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between text-sm pt-2 border-t">
                      <span className="text-muted-foreground">Suma indywidualna:</span>
                      <span className="line-through text-muted-foreground">{pkg.totalIndividualPrice.toFixed(2)} PLN</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold">
                      <span>Cena pakietu:</span>
                      <span className="text-green-600" data-testid="package-price">{pkg.packagePrice.toFixed(2)} PLN</span>
                    </div>
                    <div className="flex justify-between text-xs text-green-600">
                      <span>Oszczednosc:</span>
                      <span>{pkg.savings.toFixed(2)} PLN</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Laczny czas:</span>
                      <span className="font-medium">{pkg.totalDuration} min</span>
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handleBookPackage}
                    disabled={isBooking}
                    data-testid="book-package-btn"
                  >
                    {isBooking ? (
                      <div className="flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                        Rezerwowanie pakietu...
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Package className="h-5 w-5" />
                        Zarezerwuj pakiet ({pkg.packagePrice.toFixed(2)} PLN)
                      </div>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })()}
        </>
      )}

      {/* Regular Service Booking Flow */}
      {bookingMode === "service" && (<>
      {/* Step 1: Select Client */}
      <Card className="mb-6" data-testid="booking-client-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">1. Wybierz klienta</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {loadingClients ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : (
            <Select
              value={selectedClientId || NO_CLIENT}
              onValueChange={handleClientChange}
            >
              <SelectTrigger data-testid="booking-client-select">
                <SelectValue placeholder="Wybierz klienta..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLIENT}>Brak klienta (walk-in)</SelectItem>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.firstName} {client.lastName}
                    {client.phone ? ` (${client.phone})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedClient && selectedClient.favoriteEmployeeId && (
            <div
              className="flex items-center gap-2 mt-3 p-2 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800"
              data-testid="favorite-employee-hint"
            >
              <Star className="h-4 w-4 text-yellow-500 fill-yellow-500 shrink-0" />
              <span className="text-sm text-yellow-800 dark:text-yellow-300">
                Ten klient ma ulubionego pracownika
                {(() => {
                  const favEmp = availableEmployees.find(
                    (e) => e.id === selectedClient.favoriteEmployeeId
                  );
                  return favEmp
                    ? `: ${favEmp.firstName} ${favEmp.lastName}`
                    : "";
                })()}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Select Service */}
      <Card className="mb-6" data-testid="booking-service-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Scissors className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">2. Wybierz usluge</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {loadingServices ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : (
            <Select
              value={selectedServiceId}
              onValueChange={handleServiceChange}
            >
              <SelectTrigger data-testid="booking-service-select">
                <SelectValue placeholder="Wybierz usluge..." />
              </SelectTrigger>
              <SelectContent>
                {services.map((svc) => (
                  <SelectItem key={svc.id} value={svc.id}>
                    {svc.name} - {parseFloat(svc.basePrice).toFixed(2)} PLN ({svc.baseDuration} min)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {selectedService && (
            <div className="mt-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{selectedService.name}</span>
              {" "}&bull;{" "}
              {parseFloat(selectedService.basePrice).toFixed(2)} PLN
              {" "}&bull;{" "}
              {selectedService.baseDuration} min
            </div>
          )}
          {/* Promotion indicator */}
          {loadingPromo && selectedClientId && selectedServiceId && (
            <div className="flex items-center gap-2 mt-3 p-3 rounded-md border bg-muted/50">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
              <span className="text-sm text-muted-foreground">Sprawdzanie promocji...</span>
            </div>
          )}
          {promoCheck && !loadingPromo && selectedClientId && selectedServiceId && (
            <div
              className={`flex items-start gap-2 mt-3 p-3 rounded-md border ${
                promoCheck.eligible
                  ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                  : "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
              }`}
              data-testid="promo-check-indicator"
            >
              <Gift className={`h-4 w-4 shrink-0 mt-0.5 ${promoCheck.eligible ? "text-green-600" : "text-blue-500"}`} />
              <div className="text-sm">
                {promoCheck.eligible ? (
                  <>
                    <p className="font-semibold text-green-800 dark:text-green-300">
                      Promocja 2+1: {promoCheck.discountPercent}% znizki!
                    </p>
                    <p className="text-green-700 dark:text-green-400 text-xs mt-0.5">
                      {promoCheck.promotionName} - Cena po rabacie:{" "}
                      <span className="font-bold">{promoCheck.finalPrice?.toFixed(2)} PLN</span>
                      {" "}(zamiast {promoCheck.originalPrice?.toFixed(2)} PLN)
                    </p>
                  </>
                ) : promoCheck.remainingForPromo !== undefined ? (
                  <>
                    <p className="text-blue-800 dark:text-blue-300">
                      Promocja 2+1 dostepna!
                    </p>
                    <p className="text-blue-700 dark:text-blue-400 text-xs mt-0.5">
                      Jeszcze {promoCheck.remainingForPromo} wizyt(y) do darmowej uslugi
                      {promoCheck.promotionName ? ` (${promoCheck.promotionName})` : ""}
                    </p>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Select Employee */}
      <Card className="mb-6" data-testid="booking-employee-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">3. Wybierz pracownika</CardTitle>
            {selectedServiceId && (
              <Badge variant="outline" data-testid="available-employees-count">
                {availableEmployees.length} dostepnych
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!selectedServiceId ? (
            <p className="text-muted-foreground text-sm" data-testid="select-service-first-message">
              Najpierw wybierz usluge, aby zobaczyc dostepnych pracownikow.
            </p>
          ) : loadingEmployees ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : availableEmployees.length === 0 ? (
            <div className="text-center py-6">
              <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm" data-testid="no-employees-for-service-message">
                Brak przypisanych pracownikow do tej uslugi.
                Przypisz pracownikow w ustawieniach uslugi.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {availableEmployees.map((emp) => {
                const isFavorite = favoriteEmployeeId === emp.id;
                return (
                  <div
                    key={emp.id}
                    className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedEmployeeId === emp.id
                        ? "bg-primary/10 border-primary"
                        : isFavorite
                          ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 hover:bg-yellow-100 dark:hover:bg-yellow-900/30"
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
                    {isFavorite && (
                      <Badge
                        variant="secondary"
                        className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"
                        data-testid={`favorite-employee-badge-${emp.id}`}
                      >
                        <Star className="h-3 w-3 mr-1 fill-yellow-500 text-yellow-500" />
                        Ulubiony
                      </Badge>
                    )}
                    {emp.role === "owner" && (
                      <Badge variant="outline" className="text-xs">
                        wlasciciel
                      </Badge>
                    )}
                    {selectedEmployeeId === emp.id && (
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

      {/* Step 4: Select Date */}
      <Card className="mb-6" data-testid="booking-date-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">4. Wybierz date</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {!selectedEmployeeId ? (
            <p className="text-muted-foreground text-sm" data-testid="select-employee-first-message">
              Najpierw wybierz pracownika, aby zobaczyc dostepne daty.
            </p>
          ) : (
            <div>
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
                <p className="text-sm text-muted-foreground mt-2" data-testid="selected-date-display">
                  {formatDateDisplay(selectedDate)}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 5: Select Time Slot */}
      <Card className="mb-6" data-testid="booking-slots-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">5. Wybierz godzine</CardTitle>
            {slotsData && !slotsData.dayOff && (
              <Badge variant="outline" data-testid="available-slots-count">
                {slotsData.slots.length} wolnych terminow
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!selectedDate || !selectedEmployeeId ? (
            <p className="text-muted-foreground text-sm" data-testid="select-date-first-message">
              Wybierz pracownika i date, aby zobaczyc dostepne godziny.
            </p>
          ) : loadingSlots ? (
            <div className="flex justify-center py-6">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : slotsData?.dayOff ? (
            <div className="text-center py-6" data-testid="day-off-message">
              <AlertCircle className="w-10 h-10 text-orange-500 mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">
                {slotsData.message || "Pracownik nie pracuje w tym dniu"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Wybierz inna date
              </p>
            </div>
          ) : slotsData && slotsData.slots.length === 0 ? (
            <div className="text-center py-6" data-testid="no-slots-message">
              <Clock className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground font-medium">
                Brak wolnych terminow w tym dniu
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Wszystkie terminy sa zajete. Wybierz inna date.
              </p>
              {slotsData.blockedRanges && slotsData.blockedRanges.length > 0 && (
                <div className="mt-4 text-left">
                  <p className="text-xs text-muted-foreground mb-2 font-medium">Zajete terminy:</p>
                  {slotsData.blockedRanges.map((range, i) => (
                    <div key={i} className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                      <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                      {range.start} - {range.end} ({range.type === "appointment" ? "wizyta" : range.label})
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : slotsData ? (
            <div>
              {/* Work hours info */}
              <div className="flex items-center gap-2 mb-3 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span>Godziny pracy: {slotsData.workStart} - {slotsData.workEnd}</span>
              </div>

              {/* Blocked ranges info */}
              {slotsData.blockedRanges && slotsData.blockedRanges.length > 0 && (
                <div className="mb-4 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-md border border-orange-200 dark:border-orange-800" data-testid="blocked-ranges-info">
                  <p className="text-xs font-medium text-orange-800 dark:text-orange-300 mb-1">Zajete terminy:</p>
                  {slotsData.blockedRanges.map((range, i) => (
                    <div key={i} className="text-xs text-orange-700 dark:text-orange-400 flex items-center gap-1 mb-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
                      {range.start} - {range.end}
                      <span className="text-orange-500">
                        ({range.type === "appointment" ? "wizyta" : range.type === "vacation" ? "urlop" : range.type === "break" ? "przerwa" : range.label})
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Time slot grid */}
              <div className="grid grid-cols-4 gap-2" data-testid="time-slots-grid">
                {slotsData.slots.map((slot) => (
                  <Button
                    key={slot.time}
                    variant={selectedTimeSlot === slot.time ? "default" : "outline"}
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

              {selectedTimeSlot && selectedService && (
                <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-md border border-green-200 dark:border-green-800" data-testid="selected-slot-summary">
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-green-800 dark:text-green-300">
                      Wybrany termin: {selectedTimeSlot} - {(() => {
                        const parts = selectedTimeSlot.split(":").map(Number);
                        const h = parts[0] ?? 0;
                        const m = parts[1] ?? 0;
                        const endMinutes = h * 60 + m + selectedService.baseDuration;
                        const endH = Math.floor(endMinutes / 60);
                        const endM = endMinutes % 60;
                        return `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;
                      })()}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Step 6: Promo Code */}
      <Card className="mb-6" data-testid="booking-promo-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">6. Kod promocyjny (opcjonalnie)</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="Wpisz kod promocyjny..."
              value={promoCodeInput}
              onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleValidatePromoCode();
                }
              }}
              disabled={validatingPromoCode || (promoCodeValidation?.valid === true)}
              className="flex-1"
              data-testid="promo-code-input"
            />
            {promoCodeValidation?.valid ? (
              <Button
                variant="outline"
                onClick={handleClearPromoCode}
                data-testid="promo-code-clear-btn"
              >
                <X className="h-4 w-4 mr-1" />
                Usun
              </Button>
            ) : (
              <Button
                onClick={handleValidatePromoCode}
                disabled={validatingPromoCode || !promoCodeInput.trim()}
                data-testid="promo-code-apply-btn"
              >
                {validatingPromoCode ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                Zastosuj
              </Button>
            )}
          </div>

          {/* Promo code validation result */}
          {promoCodeValidation && (
            <div
              className={`mt-3 p-3 rounded-md border ${
                promoCodeValidation.valid
                  ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                  : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
              }`}
              data-testid="promo-code-result"
            >
              {promoCodeValidation.valid ? (
                <div className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-green-800 dark:text-green-300">
                      Kod &quot;{promoCodeValidation.code}&quot; zastosowany!
                    </p>
                    {promoCodeValidation.promotionName && (
                      <p className="text-green-700 dark:text-green-400 text-xs mt-0.5">
                        {promoCodeValidation.promotionName}
                        {promoCodeValidation.discountType === "percentage" && promoCodeValidation.discountValue
                          ? ` - ${promoCodeValidation.discountValue}% znizki`
                          : promoCodeValidation.discountType === "fixed" && promoCodeValidation.discountValue
                            ? ` - ${promoCodeValidation.discountValue.toFixed(2)} PLN znizki`
                            : ""}
                      </p>
                    )}
                    {promoCodeValidation.usageLimit != null && (
                      <p className="text-green-600 dark:text-green-500 text-xs mt-0.5">
                        Uzyto: {promoCodeValidation.usedCount || 0}/{promoCodeValidation.usageLimit}
                      </p>
                    )}
                    {/* Show if service is not eligible */}
                    {(() => {
                      const discount = getPromoCodeDiscount();
                      if (!discount && selectedServiceId) {
                        return (
                          <p className="text-orange-600 dark:text-orange-400 text-xs mt-1">
                            <AlertCircle className="h-3 w-3 inline mr-1" />
                            Ta usluga nie kwalifikuje sie do tej promocji
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-red-800 dark:text-red-300" data-testid="promo-error-title">
                      {promoCodeValidation.errorType === "expired"
                        ? "Kod wygasl"
                        : promoCodeValidation.errorType === "usage_limit"
                          ? "Limit uzycia wyczerpany"
                          : promoCodeValidation.errorType === "promotion_inactive"
                            ? "Promocja nieaktywna"
                            : promoCodeValidation.errorType === "promotion_not_started"
                              ? "Promocja jeszcze nie rozpoczeta"
                              : promoCodeValidation.errorType === "promotion_ended"
                                ? "Promocja zakonczona"
                                : "Nieprawidlowy kod"}
                    </p>
                    <p className="text-red-700 dark:text-red-400 text-xs mt-0.5" data-testid="promo-error-reason">
                      {promoCodeValidation.reason || "Kod nie istnieje lub jest niewazny"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Booking Summary & Submit */}
      {canBook && selectedService && (
        <Card className="mb-6 border-primary" data-testid="booking-summary-section">
          <CardHeader>
            <CardTitle className="text-lg">Podsumowanie rezerwacji</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 mb-4">
              {selectedClient && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Klient:</span>
                  <span className="font-medium">{selectedClient.firstName} {selectedClient.lastName}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Usluga:</span>
                <span className="font-medium">{selectedService.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Pracownik:</span>
                <span className="font-medium">
                  {(() => {
                    const emp = availableEmployees.find((e) => e.id === selectedEmployeeId);
                    return emp ? `${emp.firstName} ${emp.lastName}` : "";
                  })()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Data:</span>
                <span className="font-medium">{formatDateDisplay(selectedDate)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Godzina:</span>
                <span className="font-medium">
                  {selectedTimeSlot} - {(() => {
                    const parts = selectedTimeSlot.split(":").map(Number);
                        const h = parts[0] ?? 0;
                        const m = parts[1] ?? 0;
                    const endMinutes = h * 60 + m + selectedService.baseDuration;
                    const endH = Math.floor(endMinutes / 60);
                    const endM = endMinutes % 60;
                    return `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`;
                  })()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Cena:</span>
                {(() => {
                  const promoDiscount = getPromoCodeDiscount();
                  if (promoDiscount) {
                    return (
                      <div className="text-right">
                        <span className="font-medium line-through text-muted-foreground mr-2">
                          {promoDiscount.originalPrice.toFixed(2)} PLN
                        </span>
                        <span className="font-bold text-green-600" data-testid="discounted-price">
                          {promoDiscount.finalPrice.toFixed(2)} PLN
                        </span>
                      </div>
                    );
                  }
                  if (promoCheck?.eligible) {
                    return (
                      <div className="text-right">
                        <span className="font-medium line-through text-muted-foreground mr-2">
                          {parseFloat(selectedService.basePrice).toFixed(2)} PLN
                        </span>
                        <span className="font-bold text-green-600" data-testid="discounted-price">
                          {promoCheck.finalPrice?.toFixed(2)} PLN
                        </span>
                      </div>
                    );
                  }
                  return (
                    <span className="font-medium">{parseFloat(selectedService.basePrice).toFixed(2)} PLN</span>
                  );
                })()}
              </div>
              {(() => {
                const promoDiscount = getPromoCodeDiscount();
                if (promoDiscount) {
                  return (
                    <div className="flex justify-between text-sm" data-testid="promo-code-discount-row">
                      <span className="text-green-600 flex items-center gap-1">
                        <Tag className="h-3 w-3" />
                        Kod: {promoCodeValidation?.code}
                      </span>
                      <span className="font-medium text-green-600">
                        -{promoDiscount.discountAmount.toFixed(2)} PLN
                        {promoDiscount.discountType === "percentage" ? ` (${promoDiscount.discountValue}%)` : ""}
                      </span>
                    </div>
                  );
                }
                return null;
              })()}
              {promoCheck?.eligible && !getPromoCodeDiscount() && (
                <div className="flex justify-between text-sm" data-testid="promo-discount-row">
                  <span className="text-green-600 flex items-center gap-1">
                    <Gift className="h-3 w-3" />
                    Promocja 2+1:
                  </span>
                  <span className="font-medium text-green-600">
                    -{promoCheck.discountAmount?.toFixed(2)} PLN ({promoCheck.discountPercent}%)
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Czas trwania:</span>
                <span className="font-medium">{selectedService.baseDuration} min</span>
              </div>
            </div>
            <Button
              className="w-full"
              size="lg"
              onClick={handleBookAppointment}
              disabled={isBooking}
              data-testid="book-appointment-btn"
            >
              {isBooking ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Rezerwowanie...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <CalendarPlus className="h-5 w-5" />
                  Zarezerwuj wizyte
                </div>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
      </>)}
    </div>
  );
}
