"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useFormRecovery } from "@/hooks/use-form-recovery";
import { useTabSync } from "@/hooks/use-tab-sync";
import { mutationFetch } from "@/lib/api-client";
import { getNetworkErrorMessage } from "@/lib/fetch-with-retry";
import type { Service, ServiceCategory, ServiceGroup } from "../_types";

/**
 * Form state shape for the add-service dialog.
 * Uses `type` (not `interface`) to satisfy the `Record<string, unknown>`
 * constraint required by `useFormRecovery`.
 */
type ServiceFormState = {
  name: string;
  description: string;
  categoryId: string;
  price: string;
  duration: string;
};

export interface UseServicesDataReturn {
  // Data
  services: Service[];
  categories: ServiceCategory[];
  groupedServices: ServiceGroup[];

  // Loading / error
  loading: boolean;
  fetchError: { message: string; isNetwork: boolean; isTimeout: boolean } | null;

  // Service dialog state
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  saving: boolean;
  formName: string;
  setFormName: (v: string) => void;
  formDescription: string;
  setFormDescription: (v: string) => void;
  formCategoryId: string;
  setFormCategoryId: (v: string) => void;
  formPrice: string;
  setFormPrice: (v: string) => void;
  formDuration: string;
  setFormDuration: (v: string) => void;
  formErrors: Record<string, string>;
  setFormErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  clearFieldError: (field: string) => void;

  // Form recovery
  serviceWasRecovered: boolean;
  handleRestoreServiceForm: () => void;
  clearServiceSavedForm: () => void;

  // Delete dialog state
  deleteDialogOpen: boolean;
  setDeleteDialogOpen: (open: boolean) => void;
  serviceToDelete: Service | null;
  setServiceToDelete: (s: Service | null) => void;
  deletingService: boolean;

  // Actions
  resetForm: () => void;
  handleSaveService: () => Promise<void>;
  handleDeleteService: () => Promise<void>;
  handleAssignCategory: (serviceId: string, categoryId: string | null) => Promise<void>;
  getServiceCountForCategory: (categoryId: string) => number;
  retryFetch: () => Promise<void>;
  fetchServices: (signal?: AbortSignal) => Promise<void>;
  fetchCategories: (signal?: AbortSignal) => Promise<void>;
  notifyServicesChanged: () => void;
}

export function useServicesData(salonId: string | null): UseServicesDataReturn {
  // Data state
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<{
    message: string;
    isNetwork: boolean;
    isTimeout: boolean;
  } | null>(null);

  // Service dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Delete service state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState<Service | null>(null);
  const [deletingService, setDeletingService] = useState(false);

  // Service form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategoryId, setFormCategoryId] = useState<string>("");
  const [formPrice, setFormPrice] = useState("");
  const [formDuration, setFormDuration] = useState("");

  // Form validation errors
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Form recovery for service creation dialog
  const {
    wasRecovered: serviceWasRecovered,
    getRecoveredState: getServiceRecoveredState,
    saveFormState: saveServiceFormState,
    clearSavedForm: clearServiceSavedForm,
    setDirty: setServiceDirty,
  } = useFormRecovery<ServiceFormState>({
    storageKey: "add-service-form",
    warnOnUnload: true,
  });

  // Auto-open dialog when recovered data is found
  useEffect(() => {
    if (serviceWasRecovered) {
      setDialogOpen(true);
    }
  }, [serviceWasRecovered]);

  // Save service form state on changes (debounced inside hook)
  useEffect(() => {
    const hasData = !!formName || !!formDescription || !!formPrice || !!formDuration;
    if (hasData) {
      saveServiceFormState({
        name: formName,
        description: formDescription,
        categoryId: formCategoryId,
        price: formPrice,
        duration: formDuration,
      });
    }
    setServiceDirty(hasData);
  }, [formName, formDescription, formCategoryId, formPrice, formDuration, saveServiceFormState, setServiceDirty]);

  // Recovery handler: restores service form fields from localStorage
  const handleRestoreServiceForm = useCallback(() => {
    const saved = getServiceRecoveredState();
    if (saved) {
      setFormName(saved.name || "");
      setFormDescription(saved.description || "");
      setFormCategoryId(saved.categoryId || "");
      setFormPrice(saved.price || "");
      setFormDuration(saved.duration || "");
    }
  }, [getServiceRecoveredState]);

  // ─── Fetch callbacks ─────────────────────────────────────────

  const fetchServices = useCallback(async (signal?: AbortSignal) => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/services?salonId=${salonId}`, signal ? { signal } : {});
      const data = await res.json();
      if (data.success) {
        setServices(data.data);
        setFetchError(null);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      const errInfo = getNetworkErrorMessage(error);
      setFetchError(errInfo);
    }
  }, [salonId]);

  const fetchCategories = useCallback(async (signal?: AbortSignal) => {
    if (!salonId) return;
    try {
      const res = await fetch(
        `/api/service-categories?salonId=${salonId}`,
        signal ? { signal } : {}
      );
      const data = await res.json();
      if (data.success) {
        setCategories(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [salonId]);

  // Initial data fetch
  useEffect(() => {
    const abortController = new AbortController();

    async function loadData() {
      setLoading(true);
      await Promise.all([
        fetchServices(abortController.signal),
        fetchCategories(abortController.signal),
      ]);
      setLoading(false);
    }
    loadData();

    return () => abortController.abort();
  }, [fetchServices, fetchCategories]);

  // Cross-tab sync: refetch when another tab modifies services
  const { notifyChange: notifyServicesChanged } = useTabSync("services", () => {
    fetchServices();
    fetchCategories();
  });

  // ─── Derived data ────────────────────────────────────────────

  const groupedServices = useMemo((): ServiceGroup[] => {
    const grouped: ServiceGroup[] = [];

    // Categorized services
    for (const cat of categories) {
      const catServices = services.filter((s) => s.categoryId === cat.id);
      grouped.push({ category: cat, services: catServices });
    }

    // Uncategorized services
    const uncategorized = services.filter((s) => !s.categoryId);
    if (uncategorized.length > 0) {
      grouped.push({ category: null, services: uncategorized });
    }

    return grouped;
  }, [categories, services]);

  const getServiceCountForCategory = useCallback(
    (categoryId: string) => {
      return services.filter((s) => s.categoryId === categoryId).length;
    },
    [services],
  );

  // ─── Form helpers ────────────────────────────────────────────

  const clearFieldError = useCallback((field: string) => {
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const resetForm = useCallback(() => {
    setFormName("");
    setFormDescription("");
    setFormCategoryId("");
    setFormPrice("");
    setFormDuration("");
    setFormErrors({});
    clearServiceSavedForm();
  }, [clearServiceSavedForm]);

  const validateServiceForm = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    if (!formName.trim()) {
      errors.name = "Wpisz nazwe uslugi, np. Strzyzenie damskie";
    }
    if (!formPrice) {
      errors.price = "Podaj cene uslugi w PLN, np. 50.00";
    } else if (isNaN(parseFloat(formPrice)) || isNaN(Number(formPrice))) {
      errors.price = "Cena musi byc liczba. Wpisz wartosc, np. 50.00";
    } else if (parseFloat(formPrice) < 0) {
      errors.price = "Cena nie moze byc ujemna. Wpisz wartosc wieksza lub rowna 0";
    }
    if (!formDuration) {
      errors.duration = "Podaj czas trwania w minutach, np. 30";
    } else if (isNaN(parseInt(formDuration, 10)) || isNaN(Number(formDuration))) {
      errors.duration = "Czas trwania musi byc liczba minut, np. 30 lub 60";
    } else if (parseInt(formDuration, 10) <= 0) {
      errors.duration = "Czas trwania musi byc wiekszy niz 0 minut";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formName, formPrice, formDuration]);

  // ─── CRUD handlers ───────────────────────────────────────────

  const handleSaveService = useCallback(async () => {
    if (!validateServiceForm()) {
      toast.error("Popraw zaznaczone pola formularza");
      return;
    }

    setSaving(true);
    try {
      const res = await mutationFetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId: salonId!,
          categoryId: formCategoryId || null,
          name: formName.trim(),
          description: formDescription.trim() || null,
          basePrice: formPrice,
          baseDuration: formDuration,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(`Usluga "${formName}" zostala dodana`);
        clearServiceSavedForm();
        resetForm();
        setDialogOpen(false);
        await fetchServices();
        notifyServicesChanged();
      } else {
        toast.error(data.error || "Nie udalo sie dodac uslugi");
      }
    } catch (error) {
      const errInfo = getNetworkErrorMessage(error);
      toast.error(errInfo.isNetwork
        ? errInfo.message
        : "Blad podczas zapisywania uslugi", {
        action: {
          label: "Sprobuj ponownie",
          onClick: () => handleSaveService(),
        },
      });
    } finally {
      setSaving(false);
    }
  }, [
    validateServiceForm,
    salonId,
    formCategoryId,
    formName,
    formDescription,
    formPrice,
    formDuration,
    clearServiceSavedForm,
    resetForm,
    fetchServices,
    notifyServicesChanged,
  ]);

  const handleDeleteService = useCallback(async () => {
    if (!serviceToDelete) return;
    setDeletingService(true);
    try {
      const res = await mutationFetch(`/api/services/${serviceToDelete.id}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (data.success) {
        toast.success(`Usluga "${serviceToDelete.name}" zostala usunieta`);
        await fetchServices();
        notifyServicesChanged();
      } else {
        toast.error(data.error || "Nie udalo sie usunac uslugi");
      }
    } catch {
      toast.error("Blad podczas usuwania uslugi");
    } finally {
      setDeletingService(false);
      setDeleteDialogOpen(false);
      setServiceToDelete(null);
    }
  }, [serviceToDelete, fetchServices, notifyServicesChanged]);

  const handleAssignCategory = useCallback(async (serviceId: string, categoryId: string | null) => {
    try {
      const res = await mutationFetch(`/api/services/${serviceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Kategoria uslugi zostala zmieniona");
        await fetchServices();
      } else {
        toast.error(data.error || "Nie udalo sie zmienic kategorii");
      }
    } catch {
      toast.error("Blad podczas przypisywania kategorii");
    }
  }, [fetchServices]);

  // Retry handler for NetworkErrorHandler
  const retryFetch = useCallback(async () => {
    setFetchError(null);
    setLoading(true);
    await fetchServices();
    await fetchCategories();
    setLoading(false);
  }, [fetchServices, fetchCategories]);

  return {
    services,
    categories,
    groupedServices,

    loading,
    fetchError,

    dialogOpen,
    setDialogOpen,
    saving,
    formName,
    setFormName,
    formDescription,
    setFormDescription,
    formCategoryId,
    setFormCategoryId,
    formPrice,
    setFormPrice,
    formDuration,
    setFormDuration,
    formErrors,
    setFormErrors,
    clearFieldError,

    serviceWasRecovered,
    handleRestoreServiceForm,
    clearServiceSavedForm,

    deleteDialogOpen,
    setDeleteDialogOpen,
    serviceToDelete,
    setServiceToDelete,
    deletingService,

    resetForm,
    handleSaveService,
    handleDeleteService,
    handleAssignCategory,
    getServiceCountForCategory,
    retryFetch,
    fetchServices,
    fetchCategories,
    notifyServicesChanged,
  };
}
