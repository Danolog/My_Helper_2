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

  const resetEmpPriceForm = () => {
    setEmpPriceEmployeeId("");
    setEmpPriceCustomPrice("");
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
      toast.error("Cena musi byc liczba");
      return;
    }
    if (parseFloat(empPriceCustomPrice) < 0) {
      toast.error("Cena nie moze byc ujemna");
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
        toast.error(data.error || "Nie udalo sie zapisac ceny");
      }
    } catch {
      toast.error("Blad podczas zapisywania ceny pracownika");
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
        `Czy na pewno chcesz usunac indywidualna cene dla ${empName}?`,
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
        toast.success(`Indywidualna cena dla ${empName} usunieta`);
        await onSuccess();
      } else {
        toast.error(data.error || "Nie udalo sie usunac ceny");
      }
    } catch {
      toast.error("Blad podczas usuwania ceny pracownika");
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
    resetEmpPriceForm,
    handleSaveEmployeePrice,
    handleDeleteEmployeePrice,
  };
}
