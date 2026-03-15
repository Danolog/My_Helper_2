"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { getNetworkErrorMessage } from "@/lib/fetch-with-retry";
import { useFormRecovery } from "@/hooks/use-form-recovery";
import { useTabSync } from "@/hooks/use-tab-sync";
import { mutationFetch } from "@/lib/api-client";
import { validatePhone } from "@/lib/validations";
import type { Client, ClientFiltersState } from "../_types";
import { EMPTY_FILTERS } from "../_types";

type ClientFormState = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  notes: string;
};

export interface UseClientsDataReturn {
  // Data
  clients: Client[];
  filteredClients: Client[];

  // Loading / error
  loading: boolean;
  fetchError: { message: string; isNetwork: boolean; isTimeout: boolean } | null;

  // Search
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // Filter state (UI inputs, not yet applied)
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean) => void;
  dateAddedFrom: string;
  setDateAddedFrom: (v: string) => void;
  dateAddedTo: string;
  setDateAddedTo: (v: string) => void;
  lastVisitFrom: string;
  setLastVisitFrom: (v: string) => void;
  lastVisitTo: string;
  setLastVisitTo: (v: string) => void;
  filterHasAllergies: boolean;
  setFilterHasAllergies: (v: boolean) => void;

  // Applied filters (sent to API)
  appliedFilters: ClientFiltersState;
  hasActiveFilters: boolean;
  activeFilterCount: number;

  // Filter actions
  handleApplyFilters: () => Promise<void>;
  handleClearFilters: () => Promise<void>;

  // Dialog state
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  saving: boolean;

  // Form state
  formFirstName: string;
  setFormFirstName: (v: string) => void;
  formLastName: string;
  setFormLastName: (v: string) => void;
  formPhone: string;
  setFormPhone: (v: string) => void;
  formEmail: string;
  setFormEmail: (v: string) => void;
  formNotes: string;
  setFormNotes: (v: string) => void;
  formErrors: Record<string, string>;
  clearFieldError: (field: string) => void;

  // Form recovery
  clientWasRecovered: boolean;
  handleRestoreClientForm: () => void;
  clearClientSavedForm: () => void;

  // Actions
  resetForm: () => void;
  handleSaveClient: () => Promise<void>;
  retryFetch: () => Promise<void>;
}

export function useClientsData(salonId: string | null): UseClientsDataReturn {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Data state
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<{
    message: string;
    isNetwork: boolean;
    isTimeout: boolean;
  } | null>(null);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Search state (initialized from URL)
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");

  // Filter UI state (values in the filter form, not yet applied)
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateAddedFrom, setDateAddedFrom] = useState("");
  const [dateAddedTo, setDateAddedTo] = useState("");
  const [lastVisitFrom, setLastVisitFrom] = useState("");
  const [lastVisitTo, setLastVisitTo] = useState("");
  const [filterHasAllergies, setFilterHasAllergies] = useState(false);

  // Applied filters represent the filters that were actually sent to the API
  const [appliedFilters, setAppliedFilters] = useState<ClientFiltersState>(EMPTY_FILTERS);

  // Form state
  const [formFirstName, setFormFirstName] = useState("");
  const [formLastName, setFormLastName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Form recovery for client creation dialog
  const {
    wasRecovered: clientWasRecovered,
    getRecoveredState: getClientRecoveredState,
    saveFormState: saveClientFormState,
    clearSavedForm: clearClientSavedForm,
    setDirty: setClientDirty,
  } = useFormRecovery<ClientFormState>({
    storageKey: "add-client-form",
    warnOnUnload: true,
  });

  // Auto-open dialog when recovered data is found
  useEffect(() => {
    if (clientWasRecovered) {
      setDialogOpen(true);
    }
  }, [clientWasRecovered]);

  // Save client form state on changes (debounced inside hook)
  useEffect(() => {
    const hasData = !!formFirstName || !!formLastName || !!formPhone || !!formEmail || !!formNotes;
    if (hasData) {
      saveClientFormState({
        firstName: formFirstName,
        lastName: formLastName,
        phone: formPhone,
        email: formEmail,
        notes: formNotes,
      });
    }
    setClientDirty(hasData);
  }, [formFirstName, formLastName, formPhone, formEmail, formNotes, saveClientFormState, setClientDirty]);

  // Recovery handler: restores client form fields from localStorage
  const handleRestoreClientForm = useCallback(() => {
    const saved = getClientRecoveredState();
    if (saved) {
      setFormFirstName(saved.firstName || "");
      setFormLastName(saved.lastName || "");
      setFormPhone(saved.phone || "");
      setFormEmail(saved.email || "");
      setFormNotes(saved.notes || "");
    }
  }, [getClientRecoveredState]);

  // Sync search query to browser URL for shareable links
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [searchQuery, router, pathname]);

  // ─── Derived filter metadata ──────────────────────────────────

  const hasActiveFilters =
    appliedFilters.dateAddedFrom !== "" ||
    appliedFilters.dateAddedTo !== "" ||
    appliedFilters.lastVisitFrom !== "" ||
    appliedFilters.lastVisitTo !== "" ||
    appliedFilters.hasAllergies;

  const activeFilterCount = [
    appliedFilters.dateAddedFrom || appliedFilters.dateAddedTo ? 1 : 0,
    appliedFilters.lastVisitFrom || appliedFilters.lastVisitTo ? 1 : 0,
    appliedFilters.hasAllergies ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  // ─── Fetch callback ───────────────────────────────────────────

  const fetchClients = useCallback(
    async (filters?: ClientFiltersState, signal?: AbortSignal) => {
      if (!salonId) return;
      try {
        const params = new URLSearchParams({
          salonId: salonId,
        });

        const f = filters || appliedFilters;

        if (f.dateAddedFrom) {
          params.set("dateAddedFrom", new Date(f.dateAddedFrom).toISOString());
        }
        if (f.dateAddedTo) {
          // Set to end of day
          const endDate = new Date(f.dateAddedTo);
          endDate.setHours(23, 59, 59, 999);
          params.set("dateAddedTo", endDate.toISOString());
        }
        if (f.lastVisitFrom) {
          params.set("lastVisitFrom", f.lastVisitFrom);
        }
        if (f.lastVisitTo) {
          params.set("lastVisitTo", f.lastVisitTo);
        }
        if (f.hasAllergies) {
          params.set("hasAllergies", "true");
        }

        const res = await fetch(`/api/clients?${params.toString()}`, signal ? { signal } : {});
        const data = await res.json();
        if (data.success) {
          setClients(data.data);
          setFetchError(null);
        }
      } catch (error) {
        // Silently ignore aborted requests (component unmounted or deps changed)
        if (error instanceof Error && error.name === "AbortError") return;
        const errInfo = getNetworkErrorMessage(error);
        setFetchError(errInfo);
      }
    },
    [salonId, appliedFilters]
  );

  // Initial data fetch
  useEffect(() => {
    const abortController = new AbortController();

    async function loadData() {
      setLoading(true);
      await fetchClients(undefined, abortController.signal);
      setLoading(false);
    }
    loadData();

    return () => abortController.abort();
  }, [fetchClients]);

  // Cross-tab sync: refetch when another tab modifies clients
  const { notifyChange: notifyClientsChanged } = useTabSync("clients", fetchClients);

  // ─── Filter actions ───────────────────────────────────────────

  const handleApplyFilters = useCallback(async () => {
    const newFilters: ClientFiltersState = {
      dateAddedFrom,
      dateAddedTo,
      lastVisitFrom,
      lastVisitTo,
      hasAllergies: filterHasAllergies,
    };
    setAppliedFilters(newFilters);
    setLoading(true);
    await fetchClients(newFilters);
    setLoading(false);
    toast.success("Filtry zastosowane");
  }, [dateAddedFrom, dateAddedTo, lastVisitFrom, lastVisitTo, filterHasAllergies, fetchClients]);

  const handleClearFilters = useCallback(async () => {
    setDateAddedFrom("");
    setDateAddedTo("");
    setLastVisitFrom("");
    setLastVisitTo("");
    setFilterHasAllergies(false);
    setAppliedFilters(EMPTY_FILTERS);
    setLoading(true);
    await fetchClients(EMPTY_FILTERS);
    setLoading(false);
    toast.success("Filtry wyczyszczone");
  }, [fetchClients]);

  // ─── Client-side text search ──────────────────────────────────

  const filteredClients = clients.filter((client) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      client.firstName.toLowerCase().includes(query) ||
      client.lastName.toLowerCase().includes(query) ||
      (client.phone && client.phone.toLowerCase().includes(query)) ||
      (client.email && client.email.toLowerCase().includes(query))
    );
  });

  // ─── Form helpers ─────────────────────────────────────────────

  const clearFieldError = useCallback((field: string) => {
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const resetForm = useCallback(() => {
    setFormFirstName("");
    setFormLastName("");
    setFormPhone("");
    setFormEmail("");
    setFormNotes("");
    setFormErrors({});
    clearClientSavedForm();
  }, [clearClientSavedForm]);

  const validateClientForm = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    if (!formFirstName.trim()) {
      errors.firstName = "Wpisz imie klienta, np. Anna";
    }
    if (!formLastName.trim()) {
      errors.lastName = "Wpisz nazwisko klienta, np. Kowalska";
    }
    if (formEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formEmail.trim())) {
      errors.email = "Nieprawidlowy format email. Wpisz adres w formacie: nazwa@domena.pl";
    }
    if (formPhone.trim()) {
      const phoneError = validatePhone(formPhone);
      if (phoneError) {
        errors.phone = phoneError;
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formFirstName, formLastName, formEmail, formPhone]);

  // ─── Save handler ─────────────────────────────────────────────

  const handleSaveClient = useCallback(async () => {
    if (!validateClientForm()) {
      toast.error("Popraw zaznaczone pola formularza");
      return;
    }

    setSaving(true);
    try {
      const res = await mutationFetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId: salonId!,
          firstName: formFirstName.trim(),
          lastName: formLastName.trim(),
          phone: formPhone.trim() || null,
          email: formEmail.trim() || null,
          notes: formNotes.trim() || null,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(
          `Klient "${formFirstName.trim()} ${formLastName.trim()}" zostal dodany`
        );
        clearClientSavedForm();
        resetForm();
        setDialogOpen(false);
        await fetchClients();
        notifyClientsChanged();
      } else {
        toast.error(data.error || "Nie udalo sie dodac klienta");
      }
    } catch (error) {
      const errInfo = getNetworkErrorMessage(error);
      toast.error(errInfo.isNetwork
        ? errInfo.message
        : "Blad podczas zapisywania klienta", {
        action: {
          label: "Sprobuj ponownie",
          onClick: () => handleSaveClient(),
        },
      });
    } finally {
      setSaving(false);
    }
  }, [
    validateClientForm,
    salonId,
    formFirstName,
    formLastName,
    formPhone,
    formEmail,
    formNotes,
    clearClientSavedForm,
    resetForm,
    fetchClients,
    notifyClientsChanged,
  ]);

  // Retry handler for NetworkErrorHandler
  const retryFetch = useCallback(async () => {
    setFetchError(null);
    setLoading(true);
    await fetchClients();
    setLoading(false);
  }, [fetchClients]);

  return {
    clients,
    filteredClients,

    loading,
    fetchError,

    searchQuery,
    setSearchQuery,

    filtersOpen,
    setFiltersOpen,
    dateAddedFrom,
    setDateAddedFrom,
    dateAddedTo,
    setDateAddedTo,
    lastVisitFrom,
    setLastVisitFrom,
    lastVisitTo,
    setLastVisitTo,
    filterHasAllergies,
    setFilterHasAllergies,

    appliedFilters,
    hasActiveFilters,
    activeFilterCount,

    handleApplyFilters,
    handleClearFilters,

    dialogOpen,
    setDialogOpen,
    saving,

    formFirstName,
    setFormFirstName,
    formLastName,
    setFormLastName,
    formPhone,
    setFormPhone,
    formEmail,
    setFormEmail,
    formNotes,
    setFormNotes,
    formErrors,
    clearFieldError,

    clientWasRecovered,
    handleRestoreClientForm,
    clearClientSavedForm,

    resetForm,
    handleSaveClient,
    retryFetch,
  };
}
