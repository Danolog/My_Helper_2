"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { mutationFetch } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import type { SalonDetail } from "../_types";

export function useSalonData() {
  const params = useParams();
  const salonId = params.id as string;
  const { data: session } = useSession();
  const [salon, setSalon] = useState<SalonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [expandedServices, setExpandedServices] = useState<Set<string>>(
    new Set()
  );

  const fetchSalon = useCallback(async () => {
    try {
      const res = await fetch(`/api/salons/${salonId}`);
      const json = await res.json();
      if (json.success) {
        setSalon(json.data);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  const checkFavoriteStatus = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch(
        `/api/favorites/salons/check?salonId=${salonId}`
      );
      const json = await res.json();
      if (json.success) {
        setIsFavorite(json.isFavorite);
      }
    } catch {
    }
  }, [session, salonId]);

  useEffect(() => {
    fetchSalon();
  }, [fetchSalon]);

  useEffect(() => {
    checkFavoriteStatus();
  }, [checkFavoriteStatus]);

  function toggleServiceExpanded(serviceId: string) {
    setExpandedServices((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) {
        next.delete(serviceId);
      } else {
        next.add(serviceId);
      }
      return next;
    });
  }

  async function toggleFavorite() {
    if (!session) {
      alert("Zaloguj sie, aby dodac salon do ulubionych");
      return;
    }

    setFavoriteLoading(true);
    try {
      if (isFavorite) {
        const res = await mutationFetch(`/api/favorites/salons?salonId=${salonId}`, {
          method: "DELETE",
        });
        const json = await res.json();
        if (json.success) {
          setIsFavorite(false);
        }
      } else {
        const res = await mutationFetch("/api/favorites/salons", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ salonId }),
        });
        const json = await res.json();
        if (json.success) {
          setIsFavorite(true);
        }
      }
    } catch {
    } finally {
      setFavoriteLoading(false);
    }
  }

  return {
    // Data
    salonId,
    salon,
    loading,

    // Favorites
    isFavorite,
    favoriteLoading,
    toggleFavorite,

    // Service expansion
    expandedServices,
    toggleServiceExpanded,
  };
}
