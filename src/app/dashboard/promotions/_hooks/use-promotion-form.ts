"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useFormRecovery } from "@/hooks/use-form-recovery";
import { mutationFetch } from "@/lib/api-client";
import type { Promotion } from "../_types";
import { validateValueField } from "../_types";

type PromotionFormState = {
  name: string;
  type: string;
  value: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  selectedServiceIds: string[];
  happyHoursStart: string;
  happyHoursEnd: string;
  happyHoursDays: number[];
}

interface UsePromotionFormReturn {
  dialogOpen: boolean;
  editingPromotion: Promotion | null;
  formName: string;
  formType: string;
  formValue: string;
  formStartDate: string;
  formEndDate: string;
  formIsActive: boolean;
  formSelectedServiceIds: string[];
  formHappyHoursStart: string;
  formHappyHoursEnd: string;
  formHappyHoursDays: number[];
  formValueError: string;
  saving: boolean;
  promoWasRecovered: boolean;
  setDialogOpen: (open: boolean) => void;
  setFormName: (name: string) => void;
  setFormStartDate: (date: string) => void;
  setFormEndDate: (date: string) => void;
  setFormIsActive: (active: boolean) => void;
  setFormHappyHoursStart: (time: string) => void;
  setFormHappyHoursEnd: (time: string) => void;
  openCreateDialog: () => void;
  openEditDialog: (promo: Promotion) => void;
  handleTypeChange: (newType: string) => void;
  handleValueChange: (newValue: string) => void;
  toggleHappyHoursDay: (day: number) => void;
  toggleServiceSelection: (serviceId: string) => void;
  handleSave: (salonId: string | null, onSuccess: () => void) => Promise<void>;
  handleRestorePromoForm: () => void;
  clearPromoSavedForm: () => void;
}

export function usePromotionForm(): UsePromotionFormReturn {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("percentage");
  const [formValue, setFormValue] = useState("");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);
  const [formSelectedServiceIds, setFormSelectedServiceIds] = useState<string[]>([]);
  const [formHappyHoursStart, setFormHappyHoursStart] = useState("14:00");
  const [formHappyHoursEnd, setFormHappyHoursEnd] = useState("16:00");
  const [formHappyHoursDays, setFormHappyHoursDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [saving, setSaving] = useState(false);
  const [formValueError, setFormValueError] = useState("");

  // Form recovery for promotion creation dialog
  const {
    wasRecovered: promoWasRecovered,
    getRecoveredState: getPromoRecoveredState,
    saveFormState: savePromoFormState,
    clearSavedForm: clearPromoSavedForm,
    setDirty: setPromoDirty,
  } = useFormRecovery<PromotionFormState>({
    storageKey: "add-promotion-form",
    warnOnUnload: true,
  });

  // Auto-open dialog when recovered data is found
  useEffect(() => {
    if (promoWasRecovered) {
      setDialogOpen(true);
    }
  }, [promoWasRecovered]);

  // Save promotion form state on changes (debounced inside hook)
  useEffect(() => {
    if (dialogOpen && !editingPromotion) {
      const hasData = !!formName || !!formValue || !!formStartDate || !!formEndDate;
      if (hasData) {
        savePromoFormState({
          name: formName,
          type: formType,
          value: formValue,
          startDate: formStartDate,
          endDate: formEndDate,
          isActive: formIsActive,
          selectedServiceIds: formSelectedServiceIds,
          happyHoursStart: formHappyHoursStart,
          happyHoursEnd: formHappyHoursEnd,
          happyHoursDays: formHappyHoursDays,
        });
      }
      setPromoDirty(hasData);
    }
  }, [formName, formType, formValue, formStartDate, formEndDate, formIsActive, formSelectedServiceIds, formHappyHoursStart, formHappyHoursEnd, formHappyHoursDays, dialogOpen, editingPromotion, savePromoFormState, setPromoDirty]);

  const handleRestorePromoForm = () => {
    const saved = getPromoRecoveredState();
    if (saved) {
      setFormName(saved.name || "");
      setFormType(saved.type || "percentage");
      setFormValue(saved.value || "");
      setFormStartDate(saved.startDate || "");
      setFormEndDate(saved.endDate || "");
      setFormIsActive(saved.isActive !== undefined ? saved.isActive : true);
      setFormSelectedServiceIds(saved.selectedServiceIds || []);
      setFormHappyHoursStart(saved.happyHoursStart || "14:00");
      setFormHappyHoursEnd(saved.happyHoursEnd || "16:00");
      setFormHappyHoursDays(saved.happyHoursDays || [1, 2, 3, 4, 5]);
    }
  };

  const openCreateDialog = () => {
    setEditingPromotion(null);
    setFormName("");
    setFormType("percentage");
    setFormValue("");
    setFormValueError("");
    setFormStartDate("");
    setFormEndDate("");
    setFormIsActive(true);
    setFormSelectedServiceIds([]);
    setFormHappyHoursStart("14:00");
    setFormHappyHoursEnd("16:00");
    setFormHappyHoursDays([1, 2, 3, 4, 5]);
    setDialogOpen(true);
  };

  const openEditDialog = (promo: Promotion) => {
    setEditingPromotion(promo);
    setFormName(promo.name);
    setFormType(promo.type);
    setFormValue(promo.value);
    setFormValueError("");
    setFormStartDate(promo.startDate ? promo.startDate.slice(0, 10) : "");
    setFormEndDate(promo.endDate ? promo.endDate.slice(0, 10) : "");
    setFormIsActive(promo.isActive);
    // Restore selected service IDs from conditionsJson
    const conditions = promo.conditionsJson || {};
    if (promo.type === "package") {
      const packageIds = (conditions.packageServiceIds as string[]) || [];
      setFormSelectedServiceIds(packageIds);
    } else {
      const serviceIds = (conditions.applicableServiceIds as string[]) || [];
      setFormSelectedServiceIds(serviceIds);
    }
    // Restore happy hours fields
    if (promo.type === "happy_hours") {
      setFormHappyHoursStart((conditions.startTime as string) || "14:00");
      setFormHappyHoursEnd((conditions.endTime as string) || "16:00");
      setFormHappyHoursDays((conditions.daysOfWeek as number[]) || [1, 2, 3, 4, 5]);
    } else {
      setFormHappyHoursStart("14:00");
      setFormHappyHoursEnd("16:00");
      setFormHappyHoursDays([1, 2, 3, 4, 5]);
    }
    setDialogOpen(true);
  };

  const handleTypeChange = (newType: string) => {
    setFormType(newType);
    // When switching to buy2get1, default value to 100 (100% discount = free)
    if (newType === "buy2get1" && !formValue) {
      setFormValue("100");
    }
    // When switching to happy_hours, default value to 20%
    if (newType === "happy_hours" && !formValue) {
      setFormValue("20");
    }
    // When switching to first_visit, default value to 15%
    if (newType === "first_visit" && !formValue) {
      setFormValue("15");
    }
    // When switching to package, clear value so user enters package price
    if (newType === "package") {
      setFormValue("");
      setFormSelectedServiceIds([]);
    }
    // Re-validate current value with new type (max constraint may change)
    if (formValue) {
      setFormValueError(validateValueField(formValue, newType));
    } else {
      setFormValueError("");
    }
  };

  const toggleHappyHoursDay = (day: number) => {
    setFormHappyHoursDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const toggleServiceSelection = (serviceId: string) => {
    setFormSelectedServiceIds((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  const handleValueChange = (newValue: string) => {
    setFormValue(newValue);
    if (newValue) {
      const error = validateValueField(newValue, formType);
      setFormValueError(error);
    } else {
      setFormValueError("");
    }
  };

  const handleSave = async (salonId: string | null, onSuccess: () => void) => {
    if (!formName.trim()) {
      toast.error("Wpisz nazwe promocji, np. Rabat letni");
      return;
    }
    const valueError = validateValueField(formValue, formType);
    if (valueError) {
      setFormValueError(valueError);
      toast.error(valueError);
      return;
    }
    if (formType === "buy2get1" && formSelectedServiceIds.length === 0) {
      toast.error("Wybierz co najmniej jedna usluge dla promocji 2+1");
      return;
    }
    if (formType === "package" && formSelectedServiceIds.length < 2) {
      toast.error("Pakiet musi zawierac co najmniej 2 uslugi");
      return;
    }
    if (formType === "happy_hours") {
      if (!formHappyHoursStart || !formHappyHoursEnd) {
        toast.error("Podaj godziny happy hours");
        return;
      }
      if (formHappyHoursStart >= formHappyHoursEnd) {
        toast.error("Godzina rozpoczecia musi byc wczesniejsza niz zakonczenia");
        return;
      }
      if (formHappyHoursDays.length === 0) {
        toast.error("Wybierz co najmniej jeden dzien tygodnia");
        return;
      }
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        salonId: salonId,
        name: formName.trim(),
        type: formType,
        value: formValue,
        startDate: formStartDate || null,
        endDate: formEndDate || null,
        isActive: formIsActive,
      };

      // Include applicable service IDs for buy2get1 promotions
      if (formType === "buy2get1" || (formType !== "package" && formSelectedServiceIds.length > 0)) {
        payload.applicableServiceIds = formSelectedServiceIds;
      }

      // Include package service IDs
      if (formType === "package") {
        payload.conditionsJson = {
          packageServiceIds: formSelectedServiceIds,
        };
      }

      // Include happy hours conditions
      if (formType === "happy_hours") {
        payload.conditionsJson = {
          startTime: formHappyHoursStart,
          endTime: formHappyHoursEnd,
          daysOfWeek: formHappyHoursDays,
        };
      }

      let res: Response;
      if (editingPromotion) {
        res = await mutationFetch(`/api/promotions/${editingPromotion.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await mutationFetch("/api/promotions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json();
      if (data.success) {
        toast.success(
          editingPromotion
            ? `Promocja "${data.data.name}" zaktualizowana`
            : `Promocja "${data.data.name}" utworzona`
        );
        setDialogOpen(false);
        onSuccess();
      } else {
        toast.error(data.error || "Nie udalo sie zapisac promocji");
      }
    } catch {
      toast.error("Blad podczas zapisywania promocji");
    } finally {
      setSaving(false);
    }
  };

  return {
    dialogOpen,
    editingPromotion,
    formName,
    formType,
    formValue,
    formStartDate,
    formEndDate,
    formIsActive,
    formSelectedServiceIds,
    formHappyHoursStart,
    formHappyHoursEnd,
    formHappyHoursDays,
    formValueError,
    saving,
    promoWasRecovered,
    setDialogOpen,
    setFormName,
    setFormStartDate,
    setFormEndDate,
    setFormIsActive,
    setFormHappyHoursStart,
    setFormHappyHoursEnd,
    openCreateDialog,
    openEditDialog,
    handleTypeChange,
    handleValueChange,
    toggleHappyHoursDay,
    toggleServiceSelection,
    handleSave,
    handleRestorePromoForm,
    clearPromoSavedForm,
  };
}
