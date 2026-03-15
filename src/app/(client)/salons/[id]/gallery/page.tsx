"use client";

import { useParams } from "next/navigation";
import { GalleryFilters } from "./_components/gallery-filters";
import { GalleryGrid } from "./_components/gallery-grid";
import { GalleryHeader } from "./_components/gallery-header";
import { GalleryPhotoModal } from "./_components/gallery-photo-modal";
import { useGalleryData } from "./_hooks/use-gallery-data";

export default function SalonGalleryPage() {
  const params = useParams();
  const salonId = params.id as string;

  const {
    photos,
    loading,
    filterEmployees,
    filterServices,
    selectedEmployeeId,
    selectedServiceId,
    pairsOnly,
    selectedPhoto,
    salonName,
    hasActiveFilters,
    setSelectedPhoto,
    handleEmployeeFilterChange,
    handleServiceFilterChange,
    handlePairsToggle,
    clearFilters,
  } = useGalleryData(salonId);

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <GalleryHeader salonId={salonId} salonName={salonName} />

      <GalleryFilters
        filterEmployees={filterEmployees}
        filterServices={filterServices}
        selectedEmployeeId={selectedEmployeeId}
        selectedServiceId={selectedServiceId}
        pairsOnly={pairsOnly}
        hasActiveFilters={hasActiveFilters}
        photosCount={photos.length}
        onEmployeeFilterChange={handleEmployeeFilterChange}
        onServiceFilterChange={handleServiceFilterChange}
        onPairsToggle={handlePairsToggle}
        onClearFilters={clearFilters}
      />

      <GalleryGrid
        photos={photos}
        loading={loading}
        hasActiveFilters={hasActiveFilters}
        onPhotoSelect={setSelectedPhoto}
        onClearFilters={clearFilters}
      />

      {selectedPhoto && (
        <GalleryPhotoModal
          photo={selectedPhoto}
          photos={photos}
          onClose={() => setSelectedPhoto(null)}
          onNavigate={(photo) => setSelectedPhoto(photo)}
        />
      )}
    </div>
  );
}
