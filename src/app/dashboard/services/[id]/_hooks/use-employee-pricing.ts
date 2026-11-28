"use client";

import { useState } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import type { Employee, EmployeePrice } from "../_types";

interface UseEmployeePricingParams {
  serviceId: string;
  allEmployees: Employee[];
  onSuccess: () => Promise<void>;
}

export function useEmployeePricing({
  serviceId,
  allEmployees,
  onSuccess,
}: UseEmployeePricingParams) {
  const [empPriceDialogOpen, setEmpPriceDialogOpen] = useState(false);
  const [empPriceEmployeeId, setEmpPriceEmployeeId] = useState("");
  const [empPriceCustomPrice, setEmpPriceCustomPrice] = useState("");
  const [savingEmpPrice, setSavingEmpPrice] = useState(false);
  // Cena otwarta do zmiany; null = dialog dodawania nowej ceny.
  const [editingEmpPrice, setEditingEmpPrice] = useState<EmployeePrice | null>(
    null,
  );

  const resetEmpPriceForm = () => {
    setEmpPriceEmployeeId("");
    setEmpPriceCustomPrice("");
    setEditingEmpPrice(null);
  };

  // Zmiana istniejącej ceny (bez wariantu): ten sam dialog i ten sam POST,
  // który dla istniejącej pary pracownik + usługa aktualizuje wiersz.
  const openEditEmployeePrice = (price: EmployeePrice) => {
    setEditingEmpPrice(price);
    setEmpPriceEmployeeId(price.employeeId);
    setEmpPriceCustomPrice(price.customPrice);
    setEmpPriceDialogOpen(true);
  };

  const handleSaveEmployeePrice = async () => {
    if (!empPriceEmployeeId) {
      toast.error("Wybierz pracownika");
      return;
    }
    if (!empPriceCustomPrice) {
      toast.error("Cena jest wymagana");
      return;
    }
    if (
      isNaN(Number(empPriceCustomPrice)) ||
      isNaN(parseFloat(empPriceCustomPrice))
    ) {
      toast.error("Cena musi być liczbą.");
      return;
    }
    if (parseFloat(empPriceCustomPrice) < 0) {
      toast.error("Cena nie może być ujemna.");
      return;
    }

    setSavingEmpPrice(true);
    try {
      const res = await mutationFetch(
        `/api/services/${serviceId}/employee-prices`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: empPriceEmployeeId,
            customPrice: empPriceCustomPrice,
          }),
        },
      );

      const data = await res.json();

      if (data.success) {
        const employee = allEmployees.find((e) => e.id === empPriceEmployeeId);
        const empName = employee
          ? `${employee.firstName} ${employee.lastName}`
          : "pracownika";
        toast.success(
          data.updated
            ? `Cena dla ${empName} zaktualizowana`
            : `Cena dla ${empName} ustawiona`,
        );
        resetEmpPriceForm();
        setEmpPriceDialogOpen(false);
        await onSuccess();
      } else {
        toast.error(data.error || "Nie udało się zapisać ceny");
      }
    } catch {
      toast.error("Błąd podczas zapisywania ceny pracownika");
    } finally {
      setSavingEmpPrice(false);
    }
  };

  const handleDeleteEmployeePrice = async (price: EmployeePrice) => {
    const empName = price.employee
      ? `${price.employee.firstName} ${price.employee.lastName}`
      : "tego pracownika";

    if (
      !confirm(
        `Czy na pewno chcesz usunąć indywidualną cenę dla ${empName}?`,
      )
    ) {
      return;
    }

    try {
      const res = await mutationFetch(
        `/api/services/${serviceId}/employee-prices?priceId=${price.id}`,
        { method: "DELETE" },
      );

      const data = await res.json();

      if (data.success) {
        toast.success(`Indywidualna cena dla ${empName} usunięta`);
        await onSuccess();
      } else {
        toast.error(data.error || "Nie udało się usunąć ceny");
      }
    } catch {
      toast.error("Błąd podczas usuwania ceny pracownika");
    }
  };

  return {
    empPriceDialogOpen,
    setEmpPriceDialogOpen,
    empPriceEmployeeId,
    setEmpPriceEmployeeId,
    empPriceCustomPrice,
    setEmpPriceCustomPrice,
    savingEmpPrice,
    editingEmpPrice,
    openEditEmployeePrice,
    resetEmpPriceForm,
    handleSaveEmployeePrice,
    handleDeleteEmployeePrice,
  };
}
