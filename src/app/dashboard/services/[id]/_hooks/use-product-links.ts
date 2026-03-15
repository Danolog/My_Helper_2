"use client";

import { useState } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import type { Product, ServiceProductLink } from "../_types";

interface UseProductLinksParams {
  serviceId: string;
  allProducts: Product[];
  onSuccess: () => Promise<void>;
}

export function useProductLinks({
  serviceId,
  allProducts,
  onSuccess,
}: UseProductLinksParams) {
  const [productLinkDialogOpen, setProductLinkDialogOpen] = useState(false);
  const [productLinkProductId, setProductLinkProductId] = useState("");
  const [productLinkQuantity, setProductLinkQuantity] = useState("1");
  const [savingProductLink, setSavingProductLink] = useState(false);

  const resetProductLinkForm = () => {
    setProductLinkProductId("");
    setProductLinkQuantity("1");
  };

  const handleSaveProductLink = async () => {
    if (!productLinkProductId) {
      toast.error("Wybierz produkt");
      return;
    }
    if (!productLinkQuantity || parseFloat(productLinkQuantity) <= 0) {
      toast.error("Podaj prawidlowa ilosc");
      return;
    }

    setSavingProductLink(true);
    try {
      const res = await mutationFetch(`/api/services/${serviceId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: productLinkProductId,
          defaultQuantity: parseFloat(productLinkQuantity),
        }),
      });

      const data = await res.json();

      if (data.success) {
        const product = allProducts.find((p) => p.id === productLinkProductId);
        const productName = product ? product.name : "produkt";
        toast.success(
          data.updated
            ? `Ilosc dla "${productName}" zaktualizowana`
            : `Produkt "${productName}" powiazany z usluga`,
        );
        resetProductLinkForm();
        setProductLinkDialogOpen(false);
        await onSuccess();
      } else {
        toast.error(data.error || "Nie udalo sie powiazac produktu");
      }
    } catch {
      toast.error("Blad podczas wiazania produktu z usluga");
    } finally {
      setSavingProductLink(false);
    }
  };

  const handleDeleteProductLink = async (link: ServiceProductLink) => {
    const productName = link.productName || "ten produkt";

    if (
      !confirm(`Czy na pewno chcesz usunac powiazanie z "${productName}"?`)
    ) {
      return;
    }

    try {
      const res = await mutationFetch(
        `/api/services/${serviceId}/products?linkId=${link.id}`,
        { method: "DELETE" },
      );

      const data = await res.json();

      if (data.success) {
        toast.success(`Powiazanie z "${productName}" usuniete`);
        await onSuccess();
      } else {
        toast.error(data.error || "Nie udalo sie usunac powiazania");
      }
    } catch {
      toast.error("Blad podczas usuwania powiazania");
    }
  };

  return {
    productLinkDialogOpen,
    setProductLinkDialogOpen,
    productLinkProductId,
    setProductLinkProductId,
    productLinkQuantity,
    setProductLinkQuantity,
    savingProductLink,
    resetProductLinkForm,
    handleSaveProductLink,
    handleDeleteProductLink,
  };
}
