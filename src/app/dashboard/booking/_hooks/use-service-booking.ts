"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import type {
  Service,
  Employee,
  Client,
  AvailableSlotsData,
  PromotionCheck,
  PromoCodeValidation,
} from "../_types";

interface UseServiceBookingParams {
  salonId: string | null;
}

interface PromoCodeDiscount {
  discountAmount: number;
  finalPrice: number;
  originalPrice: number;
  discountType: string | undefined;
  discountValue: number | undefined;
}

export function useServiceBooking({ salonId }: UseServiceBookingParams) {
  // Service & employee state
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

  // --- Data fetching ---

  const fetchServices = useCallback(async (signal: AbortSignal | null = null) => {
    if (!salonId) return;
    try {
      setLoadingServices(true);
      const res = await fetch(`/api/services?salonId=${salonId}&activeOnly=true`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setServices(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    } finally {
      setLoadingServices(false);
    }
  }, [salonId]);

  const fetchClients = useCallback(async (signal: AbortSignal | null = null) => {
    if (!salonId) return;
    try {
      setLoadingClients(true);
      const res = await fetch(`/api/clients?salonId=${salonId}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setClients(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    } finally {
      setLoadingClients(false);
    }
  }, [salonId]);

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
        const employees: Employee[] = data.data
          .map((assignment: { employee: Employee | null }) => assignment.employee)
          .filter((emp: Employee | null): emp is Employee => emp !== null && emp.isActive);
        setAvailableEmployees(employees);
      }
    } catch {
    } finally {
      setLoadingEmployees(false);
    }
  }, []);

  const fetchAvailableSlots = useCallback(async (employeeId: string, date: string, duration: number, signal: AbortSignal | null = null) => {
    if (!employeeId || !date || !duration) {
      setSlotsData(null);
      return;
    }

    setLoadingSlots(true);
    setSelectedTimeSlot("");
    try {
      const res = await fetch(
        `/api/available-slots?employeeId=${employeeId}&date=${date}&duration=${duration}`,
        { signal }
      );
      if (!res.ok) { setSlotsData(null); return; }
      const data = await res.json();
      if (data.success) {
        setSlotsData(data.data);
      } else {
        toast.error(data.error || "Nie udalo sie zaladowac dostepnych terminow");
        setSlotsData(null);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      toast.error("Blad pobierania dostepnych terminow");
      setSlotsData(null);
    } finally {
      setLoadingSlots(false);
    }
  }, []);

  const checkPromotions = useCallback(async (clientId: string, serviceId: string, signal: AbortSignal | null = null) => {
    if (!clientId || !serviceId || !salonId) {
      setPromoCheck(null);
      return;
    }

    setLoadingPromo(true);
    try {
      const res = await fetch(
        `/api/promotions/check?salonId=${salonId}&clientId=${clientId}&serviceId=${serviceId}`,
        { signal }
      );
      if (!res.ok) { setPromoCheck(null); return; }
      const data = await res.json();
      if (data.success) {
        setPromoCheck(data.data);
      } else {
        setPromoCheck(null);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setPromoCheck(null);
    } finally {
      setLoadingPromo(false);
    }
  }, [salonId]);

  // --- Effects ---

  // Initial data load
  useEffect(() => {
    const controller = new AbortController();
    fetchServices(controller.signal);
    fetchClients(controller.signal);
    return () => controller.abort();
  }, [fetchServices, fetchClients]);

  // Re-check promotions when client or service changes
  useEffect(() => {
    const controller = new AbortController();
    if (selectedClientId && selectedServiceId) {
      checkPromotions(selectedClientId, selectedServiceId, controller.signal);
    } else {
      setPromoCheck(null);
    }
    return () => controller.abort();
  }, [selectedClientId, selectedServiceId, checkPromotions]);

  // Auto-fetch slots when employee or date changes
  useEffect(() => {
    const controller = new AbortController();
    const selectedService = services.find((s) => s.id === selectedServiceId);
    if (selectedEmployeeId && selectedDate && selectedService) {
      fetchAvailableSlots(selectedEmployeeId, selectedDate, selectedService.baseDuration, controller.signal);
    } else {
      setSlotsData(null);
      setSelectedTimeSlot("");
    }
    return () => controller.abort();
  }, [selectedEmployeeId, selectedDate, selectedServiceId, services, fetchAvailableSlots]);

  // --- Handlers ---

  const handleServiceChange = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    setSelectedEmployeeId("");
    setSelectedDate("");
    setSelectedTimeSlot("");
    setSlotsData(null);
    fetchAssignedEmployees(serviceId);
  };

  const handleClientChange = (clientId: string) => {
    setSelectedClientId(clientId);

    // If client has a favorite employee and that employee is available, auto-select them
    if (clientId) {
      const client = clients.find((c) => c.id === clientId);
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

  // --- Promo code ---

  const selectedService = services.find((s) => s.id === selectedServiceId) ?? null;

  const getPromoCodeDiscount = useCallback((): PromoCodeDiscount | null => {
    if (!promoCodeValidation?.valid || !selectedService) return null;

    const basePrice = parseFloat(selectedService.basePrice);
    const discountType = promoCodeValidation.discountType;
    const discountValue = promoCodeValidation.discountValue || 0;

    // Check if service is in the applicable services list (if conditions exist)
    const conditions = promoCodeValidation.conditionsJson as { applicableServiceIds?: string[] } | undefined;
    if (conditions?.applicableServiceIds && conditions.applicableServiceIds.length > 0) {
      if (!conditions.applicableServiceIds.includes(selectedServiceId)) {
        return null;
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
  }, [promoCodeValidation, selectedService, selectedServiceId]);

  const handleValidatePromoCode = async () => {
    const code = promoCodeInput.trim();
    if (!code) {
      toast.error("Wpisz kod promocyjny");
      return;
    }

    setValidatingPromoCode(true);
    try {
      const res = await mutationFetch("/api/promo-codes/validate", {
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
    } catch {
      toast.error("Blad walidacji kodu promocyjnego");
      setPromoCodeValidation(null);
    } finally {
      setValidatingPromoCode(false);
    }
  };

  const handleClearPromoCode = () => {
    setPromoCodeInput("");
    setPromoCodeValidation(null);
  };

  // --- Booking ---

  const handleBookAppointment = async () => {
    if (!selectedService || !selectedEmployeeId || !selectedDate || !selectedTimeSlot) {
      toast.error("Wypelnij wszystkie wymagane pola");
      return;
    }

    setIsBooking(true);
    try {
      const startTime = new Date(`${selectedDate}T${selectedTimeSlot}:00`);
      const endTime = new Date(startTime.getTime() + selectedService.baseDuration * 60000);

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

      const res = await mutationFetch("/api/appointments", {
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
        handleClearPromoCode();
      } else {
        toast.error(data.error || "Nie udalo sie zarezerwowac wizyty");
      }
    } catch {
      toast.error("Blad rezerwacji wizyty");
    } finally {
      setIsBooking(false);
    }
  };

  // Derived state
  const selectedClient = clients.find((c) => c.id === selectedClientId) ?? null;
  const favoriteEmployeeId = selectedClient?.favoriteEmployeeId || null;
  const canBook = !!(selectedServiceId && selectedEmployeeId && selectedDate && selectedTimeSlot && !isBooking);

  return {
    // Services
    services,
    selectedServiceId,
    selectedService,
    loadingServices,
    handleServiceChange,

    // Employees
    availableEmployees,
    selectedEmployeeId,
    loadingEmployees,
    handleEmployeeSelect,
    favoriteEmployeeId,

    // Clients
    clients,
    selectedClientId,
    selectedClient,
    loadingClients,
    handleClientChange,

    // Date & time
    selectedDate,
    slotsData,
    loadingSlots,
    selectedTimeSlot,
    setSelectedTimeSlot,
    handleDateChange,
    navigateDate,

    // Promotions
    promoCheck,
    loadingPromo,

    // Promo code
    promoCodeInput,
    setPromoCodeInput,
    promoCodeValidation,
    validatingPromoCode,
    handleValidatePromoCode,
    handleClearPromoCode,
    getPromoCodeDiscount,

    // Booking
    isBooking,
    canBook,
    handleBookAppointment,
  };
}
