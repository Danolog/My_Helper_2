"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import type { ServiceDetail } from "../_types";

interface UseEditServiceParams {
  serviceId: string;
  service: ServiceDetail | null;
  salonId: string | null;
  onSuccess: () => Promise<void>;
}

export function useEditService({
  serviceId,
  service,
  onSuccess,
}: UseEditServiceParams) {
  const router = useRouter();

  // Edit service state
  const [editServiceDialogOpen, setEditServiceDialogOpen] = useState(false);
  const [editServiceName, setEditServiceName] = useState("");
  const [editServiceDescription, setEditServiceDescription] = useState("");
  const [editServicePrice, setEditServicePrice] = useState("");
  const [editServiceDuration, setEditServiceDuration] = useState("");
  const [editServiceIsActive, setEditServiceIsActive] = useState(true);
  const [savingService, setSavingService] = useState(false);
  const [editServiceErrors, setEditServiceErrors] = useState<
    Record<string, string>
  >({});

  // Delete service state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingService, setDeletingService] = useState(false);

  // AI description generation state
  const [generatingDescription, setGeneratingDescription] = useState(false);

  const clearEditServiceError = (field: string) => {
    setEditServiceErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const openEditServiceDialog = () => {
    if (!service) return;
    setEditServiceName(service.name);
    setEditServiceDescription(service.description || "");
    setEditServicePrice(parseFloat(service.basePrice).toString());
    setEditServiceDuration(service.baseDuration.toString());
    setEditServiceIsActive(service.isActive);
    setEditServiceErrors({});
    setEditServiceDialogOpen(true);
  };

  const handleSaveService = async () => {
    const errors: Record<string, string> = {};
    if (!editServiceName.trim()) {
      errors.name = "Wpisz nazwe uslugi, np. Strzyzenie damskie";
    }
    if (!editServicePrice || parseFloat(editServicePrice) < 0) {
      errors.price = "Podaj cene bazowa w PLN (wartosc >= 0), np. 50.00";
    }
    if (!editServiceDuration || parseInt(editServiceDuration, 10) <= 0) {
      errors.duration = "Podaj czas trwania w minutach (> 0), np. 30";
    }
    setEditServiceErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Popraw zaznaczone pola formularza");
      return;
    }

    setSavingService(true);
    try {
      const res = await mutationFetch(`/api/services/${serviceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editServiceName.trim(),
          description: editServiceDescription.trim() || null,
          basePrice: parseFloat(editServicePrice),
          baseDuration: parseInt(editServiceDuration, 10),
          isActive: editServiceIsActive,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(`Usluga "${editServiceName.trim()}" zaktualizowana`);
        setEditServiceDialogOpen(false);
        await onSuccess();
      } else {
        toast.error(data.error || "Nie udalo sie zapisac uslugi");
      }
    } catch {
      toast.error("Blad podczas zapisywania uslugi");
    } finally {
      setSavingService(false);
    }
  };

  const handleDeleteService = async () => {
    setDeletingService(true);
    try {
      const res = await mutationFetch(`/api/services/${serviceId}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (data.success) {
        toast.success(`Usluga "${service?.name}" zostala usunieta`);
        router.replace("/dashboard/services");
      } else {
        toast.error(data.error || "Nie udalo sie usunac uslugi");
      }
    } catch {
      toast.error("Blad podczas usuwania uslugi");
    } finally {
      setDeletingService(false);
      setDeleteDialogOpen(false);
    }
  };

  const handleGenerateDescription = async () => {
    if (!service) return;
    setGeneratingDescription(true);
    try {
      const res = await mutationFetch("/api/ai/content/generate-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceName: editServiceName || service.name,
          categoryName: service.category?.name || undefined,
          basePrice: parseFloat(editServicePrice || service.basePrice),
          baseDuration: parseInt(
            editServiceDuration || service.baseDuration.toString(),
            10,
          ),
        }),
      });

      const data = await res.json();

      if (res.status === 403 && data.code === "PLAN_UPGRADE_REQUIRED") {
        toast.error("Generowanie opisow AI wymaga Planu Pro");
        return;
      }

      if (!res.ok || !data.success) {
        toast.error(data.error || "Nie udalo sie wygenerowac opisu");
        return;
      }

      setEditServiceDescription(data.description);
      toast.success("Opis wygenerowany przez AI");
    } catch {
      toast.error("Blad podczas generowania opisu AI");
    } finally {
      setGeneratingDescription(false);
    }
  };

  return {
    editServiceDialogOpen,
    setEditServiceDialogOpen,
    editServiceName,
    setEditServiceName,
    editServiceDescription,
    setEditServiceDescription,
    editServicePrice,
    setEditServicePrice,
    editServiceDuration,
    setEditServiceDuration,
    editServiceIsActive,
    setEditServiceIsActive,
    savingService,
    editServiceErrors,
    clearEditServiceError,
    deleteDialogOpen,
    setDeleteDialogOpen,
    deletingService,
    generatingDescription,
    openEditServiceDialog,
    handleSaveService,
    handleDeleteService,
    handleGenerateDescription,
  };
}
