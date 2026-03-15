"use client";

import { useState } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import type { ServiceVariant } from "../_types";

interface UseVariantFormParams {
  serviceId: string;
  onSuccess: () => Promise<void>;
}

export function useVariantForm({ serviceId, onSuccess }: UseVariantFormParams) {
  const [variantDialogOpen, setVariantDialogOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ServiceVariant | null>(
    null,
  );
  const [variantName, setVariantName] = useState("");
  const [variantPriceModifier, setVariantPriceModifier] = useState("0");
  const [variantDurationModifier, setVariantDurationModifier] = useState("0");
  const [savingVariant, setSavingVariant] = useState(false);
  const [variantErrors, setVariantErrors] = useState<Record<string, string>>(
    {},
  );

  const clearVariantError = (field: string) => {
    setVariantErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const resetVariantForm = () => {
    setVariantName("");
    setVariantPriceModifier("0");
    setVariantDurationModifier("0");
    setEditingVariant(null);
    setVariantErrors({});
  };

  const openEditVariant = (variant: ServiceVariant) => {
    setEditingVariant(variant);
    setVariantName(variant.name);
    setVariantPriceModifier(variant.priceModifier);
    setVariantDurationModifier(variant.durationModifier.toString());
    setVariantDialogOpen(true);
  };

  const handleSaveVariant = async () => {
    const errors: Record<string, string> = {};
    if (!variantName.trim()) {
      errors.variantName = "Wpisz nazwe wariantu, np. Krotkie wlosy";
    }
    if (variantPriceModifier && isNaN(Number(variantPriceModifier))) {
      errors.variantPriceModifier =
        "Modyfikator ceny musi byc liczba, np. 10.00 lub -5.00";
    }
    if (variantDurationModifier && isNaN(Number(variantDurationModifier))) {
      errors.variantDurationModifier =
        "Modyfikator czasu musi byc liczba minut, np. 15 lub -10";
    }
    setVariantErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Popraw zaznaczone pola formularza");
      return;
    }

    setSavingVariant(true);
    try {
      const url = editingVariant
        ? `/api/services/${serviceId}/variants/${editingVariant.id}`
        : `/api/services/${serviceId}/variants`;

      const method = editingVariant ? "PUT" : "POST";

      const res = await mutationFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: variantName.trim(),
          priceModifier: parseFloat(variantPriceModifier) || 0,
          durationModifier: parseInt(variantDurationModifier, 10) || 0,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(
          editingVariant
            ? `Wariant "${variantName}" zaktualizowany`
            : `Wariant "${variantName}" dodany`,
        );
        resetVariantForm();
        setVariantDialogOpen(false);
        await onSuccess();
      } else {
        toast.error(data.error || "Nie udalo sie zapisac wariantu");
      }
    } catch {
      toast.error("Blad podczas zapisywania wariantu");
    } finally {
      setSavingVariant(false);
    }
  };

  const handleDeleteVariant = async (variant: ServiceVariant) => {
    if (!confirm(`Czy na pewno chcesz usunac wariant "${variant.name}"?`)) {
      return;
    }

    try {
      const res = await mutationFetch(
        `/api/services/${serviceId}/variants/${variant.id}`,
        { method: "DELETE" },
      );

      const data = await res.json();

      if (data.success) {
        toast.success(`Wariant "${variant.name}" usuniety`);
        await onSuccess();
      } else {
        toast.error(data.error || "Nie udalo sie usunac wariantu");
      }
    } catch {
      toast.error("Blad podczas usuwania wariantu");
    }
  };

  return {
    variantDialogOpen,
    setVariantDialogOpen,
    editingVariant,
    variantName,
    setVariantName,
    variantPriceModifier,
    setVariantPriceModifier,
    variantDurationModifier,
    setVariantDurationModifier,
    savingVariant,
    variantErrors,
    setVariantErrors,
    clearVariantError,
    resetVariantForm,
    openEditVariant,
    handleSaveVariant,
    handleDeleteVariant,
  };
}
