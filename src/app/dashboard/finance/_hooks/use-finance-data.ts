"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import type { CommissionsData, EmployeeRate } from "../_types";

// Ten sam zakres i tekst co commissionRateSchema po stronie serwera.
const RATE_RANGE_MESSAGE = "Prowizja musi być liczbą od 0 do 100.";
const VALIDATION_FALLBACK_MESSAGE =
  "Nie udało się zapisać. Sprawdź wpisane wartości.";

// 400 z validateBody: { error, details: { pole: komunikat } }.
function firstDetail(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  const message = Object.values(details).find(
    (value) => typeof value === "string" && value.length > 0
  );
  return typeof message === "string" ? message : null;
}

export function useFinanceData() {
  const { data: session, isPending } = useSession();
  const [data, setData] = useState<CommissionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState("");

  // Commission rate settings
  const [employeeRates, setEmployeeRates] = useState<EmployeeRate[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [editingRate, setEditingRate] = useState<EmployeeRate | null>(null);
  const [newRate, setNewRate] = useState("");
  const [savingRate, setSavingRate] = useState(false);

  const fetchCommissions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      if (selectedEmployee) params.set("employeeId", selectedEmployee);

      const res = await fetch(`/api/finance/commissions?${params}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        toast.error("Nie udało się pobrać prowizji");
      }
    } catch {
      toast.error("Błąd połączenia z serwerem");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedEmployee]);

  const fetchRates = useCallback(async () => {
    setRatesLoading(true);
    try {
      const res = await fetch("/api/employees/commission-rate");
      const json = await res.json();
      if (json.success) {
        setEmployeeRates(json.data);
      }
    } catch {
    } finally {
      setRatesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      fetchCommissions();
      fetchRates();
    }
  }, [session, fetchCommissions, fetchRates]);

  const handleSaveRate = async () => {
    if (!editingRate) return;
    const rate = parseFloat(newRate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast.error(RATE_RANGE_MESSAGE);
      return;
    }

    setSavingRate(true);
    try {
      const res = await mutationFetch("/api/employees/commission-rate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: editingRate.id,
          commissionRate: rate,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message);
        setEditingRate(null);
        fetchRates();
      } else if (res.status === 400) {
        toast.error(firstDetail(json.details) ?? VALIDATION_FALLBACK_MESSAGE);
      } else {
        toast.error(json.error || "Nie udało się zapisać");
      }
    } catch {
      toast.error("Błąd połączenia z serwerem");
    } finally {
      setSavingRate(false);
    }
  };

  const openRateEditor = (emp: EmployeeRate) => {
    setEditingRate(emp);
    setNewRate(
      emp.commissionRate
        ? parseFloat(emp.commissionRate).toString()
        : "50"
    );
  };

  const closeRateEditor = () => {
    setEditingRate(null);
  };

  return {
    // Session
    session,
    isPending,

    // Commission data
    data,
    loading,

    // Filters
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    selectedEmployee,
    setSelectedEmployee,

    // Actions
    fetchCommissions,

    // Rate settings
    employeeRates,
    ratesLoading,
    editingRate,
    newRate,
    setNewRate,
    savingRate,
    handleSaveRate,
    openRateEditor,
    closeRateEditor,
  };
}
