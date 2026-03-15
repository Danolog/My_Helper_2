"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Image as ImageIcon,
  X,
  Loader2,
  Filter,
  Users,
  Scissors,
  SlidersHorizontal,
  Clock,
  ChevronLeft,
  ChevronRight,
  Maximize2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface GalleryPhoto {
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

interface FilterEmployee {
  id: string;
  firstName: string;
  lastName: string;
}

interface FilterService {
  id: string;
  name: string;
}

// Comparison slider component for before/after photos
function ComparisonSlider({
  beforeUrl,
  afterUrl,
}: {
  beforeUrl: string;
  afterUrl: string;
}) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  }, []);

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging.current) {
        handleMove(e.clientX);
      }
    },
    [handleMove]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (touch) handleMove(touch.clientX);
    },
    [handleMove]
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-[4/3] overflow-hidden rounded-lg cursor-col-resize select-none"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onMouseMove={handleMouseMove}
      onTouchMove={handleTouchMove}
      onTouchStart={handleMouseDown}
      onTouchEnd={handleMouseUp}
      onClick={(e) => handleMove(e.clientX)}
      data-testid="comparison-slider"
    >
      {/* After photo (full width background) -- raw img required for slider dragging */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={afterUrl}
        alt="Po zabiegu"
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
      />

      {/* Before photo (clipped) -- raw img required for dynamic width via slider */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${sliderPosition}%` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={beforeUrl}
          alt="Przed zabiegiem"
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            width: containerRef.current
              ? `${containerRef.current.offsetWidth}px`
              : "100%",
          }}
          draggable={false}
        />
      </div>

      {/* Slider line */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg z-10"
        style={{ left: `${sliderPosition}%` }}
      >
        {/* Slider handle */}
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center border-2 border-gray-200">
          <SlidersHorizontal className="w-5 h-5 text-gray-600" />
        </div>
      </div>

      {/* Labels */}
      <div className="absolute top-3 left-3 bg-black/60 text-white text-xs font-semibold px-2 py-1 rounded z-20">
        PRZED
      </div>
      <div className="absolute top-3 right-3 bg-black/60 text-white text-xs font-semibold px-2 py-1 rounded z-20">
        PO
      </div>
    </div>
  );
}

// Lightbox component for photo detail view
function PhotoLightbox({
  photo,
  photos,
  onClose,
  onNavigate,
}: {
  photo: GalleryPhoto;
  photos: GalleryPhoto[];
  onClose: () => void;
  onNavigate: (photo: GalleryPhoto) => void;
}) {
  const currentIndex = photos.findIndex((p) => p.id === photo.id);
  const [comparisonMode, setComparisonMode] = useState<
    "slider" | "side-by-side"
  >("slider");

  const isPair = photo.beforePhotoUrl && photo.afterPhotoUrl;

  const goNext = () => {
    const next = photos[currentIndex + 1];
    if (currentIndex < photos.length - 1 && next) {
      onNavigate(next);
    }
  };

  const goPrev = () => {
    const prev = photos[currentIndex - 1];
    if (currentIndex > 0 && prev) {
      onNavigate(prev);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="photo-lightbox"
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white z-50 p-2 rounded-full bg-black/40 hover:bg-black/60 transition-colors"
        data-testid="lightbox-close"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Navigation: Previous */}
      {currentIndex > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white z-50 p-3 rounded-full bg-black/40 hover:bg-black/60 transition-colors"
          data-testid="lightbox-prev"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      {/* Navigation: Next */}
      {currentIndex < photos.length - 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white z-50 p-3 rounded-full bg-black/40 hover:bg-black/60 transition-colors"
          data-testid="lightbox-next"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      {/* Main content */}
      <div className="max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Photo counter */}
        <div className="text-center text-white/60 text-sm mb-3">
          {currentIndex + 1} / {photos.length}
        </div>

        {/* Photo display */}
        {isPair ? (
          <div>
            {/* Comparison mode toggle */}
            <div className="flex items-center justify-center gap-2 mb-3">
              <Button
                variant={comparisonMode === "slider" ? "default" : "outline"}
                size="sm"
                onClick={() => setComparisonMode("slider")}
                className="text-xs"
              >
                <SlidersHorizontal className="w-3 h-3 mr-1" />
                Suwak
              </Button>
              <Button
                variant={
                  comparisonMode === "side-by-side" ? "default" : "outline"
                }
                size="sm"
                onClick={() => setComparisonMode("side-by-side")}
                className="text-xs"
              >
                Obok siebie
              </Button>
            </div>

            {comparisonMode === "slider" ? (
              <ComparisonSlider
                beforeUrl={photo.beforePhotoUrl!}
                afterUrl={photo.afterPhotoUrl!}
              />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm font-medium mb-2 text-center bg-orange-500/80 text-white rounded py-1">
                    Przed
                  </p>
                  <div className="relative aspect-[3/4]">
                    <Image
                      src={photo.beforePhotoUrl!}
                      alt="Przed"
                      fill
                      className="rounded-lg object-cover"
                      sizes="(max-width: 768px) 45vw, 30vw"
                    />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium mb-2 text-center bg-green-500/80 text-white rounded py-1">
                    Po
                  </p>
                  <div className="relative aspect-[3/4]">
                    <Image
                      src={photo.afterPhotoUrl!}
                      alt="Po"
                      fill
                      className="rounded-lg object-cover"
                      sizes="(max-width: 768px) 45vw, 30vw"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="relative w-full" style={{ height: "60vh" }}>
            <Image
              src={photo.afterPhotoUrl || photo.beforePhotoUrl || ""}
              alt={photo.description || "Zdjecie galerii"}
              fill
              className="rounded-lg object-contain"
              sizes="(max-width: 768px) 100vw, 80vw"
            />
          </div>
        )}

        {/* Photo details */}
        <div className="mt-4 bg-white/10 backdrop-blur-sm rounded-lg p-4 text-white" data-testid="photo-details">
          {photo.description && (
            <p className="text-sm mb-3" data-testid="photo-description">
              {photo.description}
            </p>
          )}

          <div className="flex flex-wrap gap-3 text-sm text-white/80">
            {photo.employeeFirstName && (
              <div className="flex items-center gap-1.5" data-testid="photo-employee">
                <Users className="w-3.5 h-3.5" />
                <span>
                  {photo.employeeFirstName} {photo.employeeLastName}
                </span>
              </div>
            )}
            {photo.serviceName && (
              <div className="flex items-center gap-1.5" data-testid="photo-service">
                <Scissors className="w-3.5 h-3.5" />
                <span>{photo.serviceName}</span>
              </div>
            )}
            {photo.duration && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>{photo.duration} min</span>
              </div>
            )}
          </div>

          {photo.techniques && (
            <p className="text-sm text-white/70 mt-2" data-testid="photo-techniques">
              <span className="font-medium text-white/90">Techniki:</span>{" "}
              {photo.techniques}
            </p>
          )}

          {photo.productsUsed && (
            <p className="text-sm text-white/70 mt-1" data-testid="photo-products">
              <span className="font-medium text-white/90">Produkty:</span>{" "}
              {photo.productsUsed}
            </p>
          )}

          <p className="text-xs text-white/50 mt-3">
            {new Date(photo.createdAt).toLocaleDateString("pl-PL", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SalonGalleryPage() {
  const params = useParams();
  const salonId = params.id as string;

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

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" asChild>
          <Link href={`/salons/${salonId}`}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Powrot do salonu
          </Link>
        </Button>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ImageIcon className="w-6 h-6" />
          Galeria
        </h1>
        {salonName && (
          <p className="text-muted-foreground mt-1">{salonName}</p>
        )}
      </div>

      {/* Filter bar */}
      <div
        className="flex flex-wrap items-center gap-3 mb-6 p-3 bg-muted/50 rounded-lg"
        data-testid="gallery-filters"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Filter className="w-4 h-4" />
          <span>Filtry:</span>
        </div>

        {filterEmployees.length > 0 && (
          <Select
            value={selectedEmployeeId || "all"}
            onValueChange={handleEmployeeFilterChange}
          >
            <SelectTrigger className="w-[200px]" data-testid="filter-employee">
              <SelectValue placeholder="Wszyscy pracownicy" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Wszyscy pracownicy
                </span>
              </SelectItem>
              {filterEmployees.map((emp) => (
                <SelectItem key={emp.id} value={emp.id}>
                  {emp.firstName} {emp.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {filterServices.length > 0 && (
          <Select
            value={selectedServiceId || "all"}
            onValueChange={handleServiceFilterChange}
          >
            <SelectTrigger className="w-[200px]" data-testid="filter-service">
              <SelectValue placeholder="Wszystkie uslugi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <span className="flex items-center gap-2">
                  <Scissors className="w-4 h-4" />
                  Wszystkie uslugi
                </span>
              </SelectItem>
              {filterServices.map((svc) => (
                <SelectItem key={svc.id} value={svc.id}>
                  {svc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          variant={pairsOnly ? "default" : "outline"}
          size="sm"
          onClick={handlePairsToggle}
          className="gap-1"
          data-testid="filter-pairs"
        >
          <SlidersHorizontal className="w-4 h-4" />
          Przed / Po
        </Button>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="w-4 h-4 mr-1" />
            Wyczysc filtry
          </Button>
        )}

        <span className="text-xs text-muted-foreground ml-auto">
          {photos.length}{" "}
          {photos.length === 1
            ? "zdjecie"
            : photos.length < 5
              ? "zdjecia"
              : "zdjec"}
        </span>
      </div>

      {/* Gallery grid */}
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <ImageIcon className="w-16 h-16 text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold mb-2">
            {hasActiveFilters
              ? "Brak zdjec dla wybranych filtrow"
              : "Galeria jest pusta"}
          </h2>
          <p className="text-muted-foreground">
            {hasActiveFilters
              ? "Sprobuj inne kryteria wyszukiwania"
              : "Ten salon nie dodal jeszcze zdjec do galerii"}
          </p>
          {hasActiveFilters && (
            <Button
              variant="outline"
              className="mt-4"
              onClick={clearFilters}
            >
              Wyczysc filtry
            </Button>
          )}
        </div>
      ) : (
        <div
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
          data-testid="gallery-grid"
        >
          {photos.map((photo) => {
            const isPair = photo.beforePhotoUrl && photo.afterPhotoUrl;

            return (
              <div
                key={photo.id}
                className="group relative border rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all hover:shadow-lg"
                onClick={() => setSelectedPhoto(photo)}
                data-testid={`gallery-photo-${photo.id}`}
              >
                <div className="aspect-square relative">
                  {isPair ? (
                    /* Split preview for before/after pairs -- raw img for w-[200%] crop trick */
                    <div className="w-full h-full flex">
                      <div className="w-1/2 h-full relative overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.beforePhotoUrl!}
                          alt="Przed"
                          className="absolute inset-0 w-[200%] h-full object-cover"
                        />
                      </div>
                      <div className="w-0.5 bg-white z-10 relative" />
                      <div className="w-1/2 h-full relative overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.afterPhotoUrl!}
                          alt="Po"
                          className="absolute inset-0 w-[200%] h-full object-cover object-right"
                        />
                      </div>
                    </div>
                  ) : photo.afterPhotoUrl ? (
                    <Image
                      src={photo.afterPhotoUrl}
                      alt={photo.description || "Zdjecie galerii"}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    />
                  ) : photo.beforePhotoUrl ? (
                    <Image
                      src={photo.beforePhotoUrl}
                      alt={photo.description || "Zdjecie galerii"}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-muted">
                      <ImageIcon className="w-12 h-12 text-muted-foreground" />
                    </div>
                  )}

                  {/* Badges */}
                  {isPair && (
                    <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs font-semibold px-2 py-1 rounded flex items-center gap-1">
                      <SlidersHorizontal className="w-3 h-3" />
                      Przed / Po
                    </div>
                  )}

                  {/* Hover overlay with zoom icon */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Maximize2 className="w-8 h-8 text-white drop-shadow-lg" />
                    </div>
                  </div>
                </div>

                <div className="p-3">
                  {photo.employeeFirstName && (
                    <p className="text-sm font-medium">
                      {photo.employeeFirstName} {photo.employeeLastName}
                    </p>
                  )}
                  {photo.serviceName && (
                    <Badge variant="secondary" className="text-xs mt-1">
                      {photo.serviceName}
                    </Badge>
                  )}
                  {photo.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {photo.description}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox */}
      {selectedPhoto && (
        <PhotoLightbox
          photo={selectedPhoto}
          photos={photos}
          onClose={() => setSelectedPhoto(null)}
          onNavigate={(photo) => setSelectedPhoto(photo)}
        />
      )}
    </div>
  );
}
