"use client";

import { useState, useEffect } from "react";
import { useSession } from "@/lib/auth-client";

/**
 * Client-side hook to get the current user's salon ID.
 * Fetches from /api/salons/mine when user is authenticated.
 *
 * Returns { salonId, loading } — salonId is null until loaded.
 */
export function useSalonId() {
  const { data: session } = useSession();
  const [salonId, setSalonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.user) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchSalon() {
      try {
        const res = await fetch("/api/salons/mine");
        const data = await res.json();
        if (!cancelled && data.success && data.salon) {
          setSalonId(data.salon.id);
        }
      } catch {
        // Salon fetch failed — salonId will remain null
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSalon();
    return () => { cancelled = true; };
  }, [session]);

  return { salonId, loading };
}
