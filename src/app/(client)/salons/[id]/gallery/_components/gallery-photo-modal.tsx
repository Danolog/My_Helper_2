"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import {
  X,
  Users,
  Scissors,
  SlidersHorizontal,
  Clock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GalleryPhoto } from "../_hooks/use-gallery-data";

// Comparison slider component for before/after photos
function ComparisonSlider({
  beforeUrl,
  afterUrl,
}: {
  beforeUrl: string;
  afterUrl: string;
}) {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // Track container width via ResizeObserver to avoid accessing ref during render
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    setContainerWidth(el.offsetWidth);
    return () => observer.disconnect();
  }, []);

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
            width: containerWidth
              ? `${containerWidth}px`
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

interface GalleryPhotoModalProps {
  photo: GalleryPhoto;
  photos: GalleryPhoto[];
  onClose: () => void;
  onNavigate: (photo: GalleryPhoto) => void;
}

export function GalleryPhotoModal({
  photo,
  photos,
  onClose,
  onNavigate,
}: GalleryPhotoModalProps) {
  const currentIndex = photos.findIndex((p) => p.id === photo.id);
  const [comparisonMode, setComparisonMode] = useState<
    "slider" | "side-by-side"
  >("slider");

  const isPair = photo.beforePhotoUrl && photo.afterPhotoUrl;

  const goNext = useCallback(() => {
    const next = photos[currentIndex + 1];
    if (currentIndex < photos.length - 1 && next) {
      onNavigate(next);
    }
  }, [currentIndex, photos, onNavigate]);

  const goPrev = useCallback(() => {
    const prev = photos[currentIndex - 1];
    if (currentIndex > 0 && prev) {
      onNavigate(prev);
    }
  }, [currentIndex, photos, onNavigate]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, goNext, goPrev]);

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
