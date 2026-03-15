"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type {
  ServiceDetail,
  Employee,
  EmployeePrice,
  ServiceProductLink,
  Product,
  GalleryPhoto,
} from "../_types";

interface UseServiceDataParams {
  serviceId: string;
  salonId: string | null;
}

interface UseServiceDataReturn {
  service: ServiceDetail | null;
  loading: boolean;
  assignedEmployeeIds: Set<string>;
  setAssignedEmployeeIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  employeePrices: EmployeePrice[];
  allEmployees: Employee[];
  serviceProductLinks: ServiceProductLink[];
  allProducts: Product[];
  galleryPhotos: GalleryPhoto[];
  refetchService: () => Promise<void>;
  refetchEmployeePrices: () => Promise<void>;
  refetchServiceProductLinks: () => Promise<void>;
}

export function useServiceData({
  serviceId,
  salonId,
}: UseServiceDataParams): UseServiceDataReturn {
  const router = useRouter();

  const [service, setService] = useState<ServiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [assignedEmployeeIds, setAssignedEmployeeIds] = useState<Set<string>>(
    new Set(),
  );
  const [employeePrices, setEmployeePrices] = useState<EmployeePrice[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [serviceProductLinks, setServiceProductLinks] = useState<
    ServiceProductLink[]
  >([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [galleryPhotos, setGalleryPhotos] = useState<GalleryPhoto[]>([]);

  const fetchService = useCallback(
    async (signal: AbortSignal | null = null) => {
      try {
        const res = await fetch(`/api/services/${serviceId}`, { signal });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
          setService(data.data);
        } else {
          toast.error("Nie znaleziono uslugi");
          router.replace("/dashboard/services");
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        toast.error("Blad podczas ladowania uslugi");
      } finally {
        setLoading(false);
      }
    },
    [serviceId, router],
  );

  const fetchEmployeeAssignments = useCallback(
    async (signal: AbortSignal | null = null) => {
      try {
        const res = await fetch(
          `/api/services/${serviceId}/employee-assignments`,
          { signal },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
          const ids = new Set<string>(
            data.data.map((a: { employeeId: string }) => a.employeeId),
          );
          setAssignedEmployeeIds(ids);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    },
    [serviceId],
  );

  const fetchEmployeePrices = useCallback(
    async (signal: AbortSignal | null = null) => {
      try {
        const res = await fetch(
          `/api/services/${serviceId}/employee-prices`,
          { signal },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
          setEmployeePrices(data.data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    },
    [serviceId],
  );

  const fetchEmployees = useCallback(
    async (signal: AbortSignal | null = null) => {
      if (!salonId) return;
      try {
        const res = await fetch(
          `/api/employees?salonId=${salonId}&activeOnly=true`,
          { signal },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
          setAllEmployees(data.data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    },
    [salonId],
  );

  const fetchServiceProductLinks = useCallback(
    async (signal: AbortSignal | null = null) => {
      try {
        const res = await fetch(`/api/services/${serviceId}/products`, {
          signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
          setServiceProductLinks(data.data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    },
    [serviceId],
  );

  const fetchAllProducts = useCallback(
    async (signal: AbortSignal | null = null) => {
      if (!salonId) return;
      try {
        const res = await fetch(`/api/products?salonId=${salonId}`, { signal });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
          setAllProducts(data.data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    },
    [salonId],
  );

  const fetchGalleryPhotos = useCallback(
    async (signal: AbortSignal | null = null) => {
      if (!salonId) return;
      try {
        const res = await fetch(
          `/api/gallery?salonId=${salonId}&serviceId=${serviceId}`,
          { signal },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.success) {
          setGalleryPhotos(data.data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    },
    [salonId, serviceId],
  );

  useEffect(() => {
    const controller = new AbortController();
    async function loadData() {
      setLoading(true);
      await Promise.all([
        fetchService(controller.signal),
        fetchEmployeeAssignments(controller.signal),
        fetchEmployeePrices(controller.signal),
        fetchEmployees(controller.signal),
        fetchGalleryPhotos(controller.signal),
        fetchServiceProductLinks(controller.signal),
        fetchAllProducts(controller.signal),
      ]);
      setLoading(false);
    }
    loadData();
    return () => controller.abort();
  }, [
    fetchService,
    fetchEmployeeAssignments,
    fetchEmployeePrices,
    fetchEmployees,
    fetchGalleryPhotos,
    fetchServiceProductLinks,
    fetchAllProducts,
  ]);

  // Stable refetch wrappers (no signal needed for manual refetches)
  const refetchService = useCallback(
    () => fetchService(null),
    [fetchService],
  );
  const refetchEmployeePrices = useCallback(
    () => fetchEmployeePrices(null),
    [fetchEmployeePrices],
  );
  const refetchServiceProductLinks = useCallback(
    () => fetchServiceProductLinks(null),
    [fetchServiceProductLinks],
  );

  return {
    service,
    loading,
    assignedEmployeeIds,
    setAssignedEmployeeIds,
    employeePrices,
    allEmployees,
    serviceProductLinks,
    allProducts,
    galleryPhotos,
    refetchService,
    refetchEmployeePrices,
    refetchServiceProductLinks,
  };
}
