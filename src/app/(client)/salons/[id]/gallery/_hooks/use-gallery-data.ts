"use client";

import { useState, useEffect, useCallback } from "react";

export interface GalleryPhoto {
  id: string;
  salonId: string;
  employeeId: string | null;
  serviceId: string | null;
  beforePhotoUrl: string | null;
  afterPhotoUrl: string | null;
  description: string | null;
  productsUsed: string | null;
  techniques: string | null;
  duration: number | null;
  showProductsToClients: boolean;
  createdAt: string;
  employeeFirstName: string | null;
  employeeLastName: string | null;
  serviceName: string | null;
}

export interface FilterEmployee {
  id: string;
  firstName: string;
  lastName: string;
}

export interface FilterService {
  id: string;
  name: string;
}

interface UseGalleryDataReturn {
  photos: GalleryPhoto[];
  loading: boolean;
  filterEmployees: FilterEmployee[];
  filterServices: FilterService[];
  selectedEmployeeId: string;
  selectedServiceId: string;
  pairsOnly: boolean;
  selectedPhoto: GalleryPhoto | null;
  salonName: string;
  hasActiveFilters: boolean;
  setSelectedPhoto: (photo: GalleryPhoto | null) => void;
  handleEmployeeFilterChange: (value: string) => void;
  handleServiceFilterChange: (value: string) => void;
  handlePairsToggle: () => void;
  clearFilters: () => void;
}

export function useGalleryData(salonId: string): UseGalleryDataReturn {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterEmployees, setFilterEmployees] = useState<FilterEmployee[]>([]);
  const [filterServices, setFilterServices] = useState<FilterService[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [selectedServiceId, setSelectedServiceId] = useState<string>("");
  const [pairsOnly, setPairsOnly] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<GalleryPhoto | null>(null);
  const [salonName, setSalonName] = useState<string>("");

  const fetchGallery = useCallback(
    async (employeeId?: string, serviceId?: string, pairs?: boolean) => {
      try {
        setLoading(true);
        let url = `/api/salons/${salonId}/gallery`;
        const queryParams: string[] = [];
        if (employeeId && employeeId !== "all") {
          queryParams.push(`employeeId=${employeeId}`);
        }
        if (serviceId && serviceId !== "all") {
          queryParams.push(`serviceId=${serviceId}`);
        }
        if (pairs) {
          queryParams.push("pairsOnly=true");
        }
        if (queryParams.length > 0) {
          url += `?${queryParams.join("&")}`;
        }

        const res = await fetch(url);
        const json = await res.json();
        if (json.success) {
          setPhotos(json.data);
          if (json.filters) {
            setFilterEmployees(json.filters.employees || []);
            setFilterServices(json.filters.services || []);
          }
        }
      } catch {
      } finally {
        setLoading(false);
      }
    },
    [salonId]
  );

  const fetchSalonName = useCallback(async () => {
    try {
      const res = await fetch(`/api/salons/${salonId}`);
      const json = await res.json();
      if (json.success && json.data) {
        setSalonName(json.data.name);
      }
    } catch {
    }
  }, [salonId]);

  useEffect(() => {
    fetchGallery();
    fetchSalonName();
  }, [fetchGallery, fetchSalonName]);

  const handleEmployeeFilterChange = (value: string) => {
    setSelectedEmployeeId(value);
    fetchGallery(
      value !== "all" ? value : undefined,
      selectedServiceId && selectedServiceId !== "all"
        ? selectedServiceId
        : undefined,
      pairsOnly
    );
  };

  const handleServiceFilterChange = (value: string) => {
    setSelectedServiceId(value);
    fetchGallery(
      selectedEmployeeId && selectedEmployeeId !== "all"
        ? selectedEmployeeId
        : undefined,
      value !== "all" ? value : undefined,
      pairsOnly
    );
  };

  const handlePairsToggle = () => {
    const newPairsOnly = !pairsOnly;
    setPairsOnly(newPairsOnly);
    fetchGallery(
      selectedEmployeeId && selectedEmployeeId !== "all"
        ? selectedEmployeeId
        : undefined,
      selectedServiceId && selectedServiceId !== "all"
        ? selectedServiceId
        : undefined,
      newPairsOnly
    );
  };

  const clearFilters = () => {
    setSelectedEmployeeId("");
    setSelectedServiceId("");
    setPairsOnly(false);
    fetchGallery();
  };

  const hasActiveFilters =
    (selectedEmployeeId && selectedEmployeeId !== "all") ||
    (selectedServiceId && selectedServiceId !== "all") ||
    pairsOnly;

  return {
    photos,
    loading,
    filterEmployees,
    filterServices,
    selectedEmployeeId,
    selectedServiceId,
    pairsOnly,
    selectedPhoto,
    salonName,
    hasActiveFilters: !!hasActiveFilters,
    setSelectedPhoto,
    handleEmployeeFilterChange,
    handleServiceFilterChange,
    handlePairsToggle,
    clearFilters,
  };
}
