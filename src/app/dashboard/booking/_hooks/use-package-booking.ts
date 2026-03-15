"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import type {
  Employee,
  PackageInfo,
  AvailableSlotsData,
} from "../_types";

interface UsePackageBookingParams {
  salonId: string | null;
  selectedClientId: string;
}

export function usePackageBooking({ salonId, selectedClientId }: UsePackageBookingParams) {
  const [availablePackages, setAvailablePackages] = useState<PackageInfo[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string>("");
  const [packageEmployeeId, setPackageEmployeeId] = useState<string>("");
  const [packageDate, setPackageDate] = useState<string>("");
  const [packageTimeSlot, setPackageTimeSlot] = useState<string>("");
  const [packageSlotsData, setPackageSlotsData] = useState<AvailableSlotsData | null>(null);
  const [loadingPackageSlots, setLoadingPackageSlots] = useState(false);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [loadingAllEmployees, setLoadingAllEmployees] = useState(false);
  const [isBooking, setIsBooking] = useState(false);

  // --- Data fetching ---

  const fetchPackages = useCallback(async (signal: AbortSignal | null = null) => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/promotions/check-package?salonId=${salonId}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setAvailablePackages(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
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
    } catch {
    } finally {
      setLoadingAllEmployees(false);
    }
  }, [salonId]);

  const fetchPackageSlots = useCallback(async (empId: string, date: string, duration: number, signal: AbortSignal | null = null) => {
    if (!empId || !date || !duration) {
      setPackageSlotsData(null);
      return;
    }
    setLoadingPackageSlots(true);
    setPackageTimeSlot("");
    try {
      const res = await fetch(
        `/api/available-slots?employeeId=${empId}&date=${date}&duration=${duration}`,
        { signal }
      );
      if (!res.ok) { setPackageSlotsData(null); return; }
      const data = await res.json();
      if (data.success) {
        setPackageSlotsData(data.data);
      } else {
        setPackageSlotsData(null);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setPackageSlotsData(null);
    } finally {
      setLoadingPackageSlots(false);
    }
  }, []);

  // --- Effects ---

  // Initial packages fetch
  useEffect(() => {
    const controller = new AbortController();
    fetchPackages(controller.signal);
    return () => controller.abort();
  }, [fetchPackages]);

  // Auto-fetch slots when package employee and date change
  useEffect(() => {
    const controller = new AbortController();
    const selectedPackage = availablePackages.find((p) => p.id === selectedPackageId);
    if (packageEmployeeId && packageDate && selectedPackage) {
      fetchPackageSlots(packageEmployeeId, packageDate, selectedPackage.totalDuration, controller.signal);
    } else {
      setPackageSlotsData(null);
      setPackageTimeSlot("");
    }
    return () => controller.abort();
  }, [packageEmployeeId, packageDate, selectedPackageId, availablePackages, fetchPackageSlots]);

  // --- Handlers ---

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

  const handlePackageEmployeeSelect = (empId: string) => {
    setPackageEmployeeId(empId);
    setPackageTimeSlot("");
  };

  const handlePackageDateChange = (date: string) => {
    setPackageDate(date);
    setPackageTimeSlot("");
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

      const res = await mutationFetch("/api/appointments/book-package", {
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
    } catch {
      toast.error("Blad rezerwacji pakietu");
    } finally {
      setIsBooking(false);
    }
  };

  const resetPackageState = () => {
    setSelectedPackageId("");
  };

  // Derived state
  const selectedPackage = availablePackages.find((p) => p.id === selectedPackageId) ?? null;

  return {
    availablePackages,
    selectedPackageId,
    selectedPackage,
    packageEmployeeId,
    packageDate,
    packageTimeSlot,
    setPackageTimeSlot,
    packageSlotsData,
    loadingPackageSlots,
    allEmployees,
    loadingAllEmployees,
    isBooking,
    handleSelectPackage,
    handlePackageEmployeeSelect,
    handlePackageDateChange,
    handleBookPackage,
    resetPackageState,
  };
}
