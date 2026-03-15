"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import { useTabSync } from "@/hooks/use-tab-sync";
import { useSalonId } from "@/hooks/use-salon-id";
import { mutationFetch } from "@/lib/api-client";
import type { Promotion, Service } from "../_types";

interface UsePromotionsDataReturn {
  session: ReturnType<typeof useSession>["data"];
  isPending: boolean;
  salonId: string | null;
  promotionsList: Promotion[];
  servicesList: Service[];
  loading: boolean;
  deleteTarget: Promotion | null;
  deleting: boolean;
  setDeleteTarget: (target: Promotion | null) => void;
  fetchPromotions: (signal?: AbortSignal) => Promise<void>;
  handleDelete: () => Promise<void>;
  handleToggleActive: (promo: Promotion) => Promise<void>;
  notifyPromotionsChanged: () => void;
}

export function usePromotionsData(): UsePromotionsDataReturn {
  const { data: session, isPending } = useSession();
  const { salonId } = useSalonId();

  const [promotionsList, setPromotionsList] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [servicesList, setServicesList] = useState<Service[]>([]);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Promotion | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchPromotions = useCallback(async (signal?: AbortSignal) => {
    if (!salonId) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/promotions?salonId=${salonId}`, signal ? { signal } : {});
      const data = await res.json();
      if (data.success) {
        setPromotionsList(data.data);
      } else {
        toast.error("Nie udalo sie pobrac promocji");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      toast.error("Blad podczas pobierania promocji");
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  const fetchServices = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/services?salonId=${salonId}&activeOnly=true`, signal ? { signal } : {});
      const data = await res.json();
      if (data.success) {
        setServicesList(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [salonId]);

  useEffect(() => {
    if (!session) return;

    const abortController = new AbortController();

    fetchPromotions(abortController.signal);
    fetchServices(abortController.signal);

    return () => abortController.abort();
  }, [session, fetchPromotions, fetchServices]);

  // Cross-tab sync: refetch when another tab modifies promotions
  const { notifyChange: notifyPromotionsChanged } = useTabSync("promotions", fetchPromotions);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await mutationFetch(`/api/promotions/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Promocja "${deleteTarget.name}" usunieta`);
        setDeleteTarget(null);
        fetchPromotions();
        notifyPromotionsChanged();
      } else {
        toast.error(data.error || "Nie udalo sie usunac promocji");
      }
    } catch {
      toast.error("Blad podczas usuwania promocji");
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (promo: Promotion) => {
    try {
      const res = await mutationFetch(`/api/promotions/${promo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !promo.isActive }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          data.data.isActive
            ? `Promocja "${promo.name}" aktywowana`
            : `Promocja "${promo.name}" dezaktywowana`
        );
        fetchPromotions();
        notifyPromotionsChanged();
      } else {
        toast.error("Nie udalo sie zmienic statusu");
      }
    } catch {
      toast.error("Blad podczas zmiany statusu");
    }
  };

  return {
    session,
    isPending,
    salonId,
    promotionsList,
    servicesList,
    loading,
    deleteTarget,
    deleting,
    setDeleteTarget,
    fetchPromotions,
    handleDelete,
    handleToggleActive,
    notifyPromotionsChanged,
  };
}
