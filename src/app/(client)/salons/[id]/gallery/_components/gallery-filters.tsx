"use client";

import { Filter, Users, Scissors, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FilterEmployee, FilterService } from "../_hooks/use-gallery-data";

interface GalleryFiltersProps {
  filterEmployees: FilterEmployee[];
  filterServices: FilterService[];
  selectedEmployeeId: string;
  selectedServiceId: string;
  pairsOnly: boolean;
  hasActiveFilters: boolean;
  photosCount: number;
  onEmployeeFilterChange: (value: string) => void;
  onServiceFilterChange: (value: string) => void;
  onPairsToggle: () => void;
  onClearFilters: () => void;
}

export function GalleryFilters({
  filterEmployees,
  filterServices,
  selectedEmployeeId,
  selectedServiceId,
  pairsOnly,
  hasActiveFilters,
  photosCount,
  onEmployeeFilterChange,
  onServiceFilterChange,
  onPairsToggle,
  onClearFilters,
}: GalleryFiltersProps) {
  return (
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
          onValueChange={onEmployeeFilterChange}
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
          onValueChange={onServiceFilterChange}
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
        onClick={onPairsToggle}
        className="gap-1"
        data-testid="filter-pairs"
      >
        <SlidersHorizontal className="w-4 h-4" />
        Przed / Po
      </Button>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters}>
          <X className="w-4 h-4 mr-1" />
          Wyczysc filtry
        </Button>
      )}

      <span className="text-xs text-muted-foreground ml-auto">
        {photosCount}{" "}
        {photosCount === 1
          ? "zdjecie"
          : photosCount < 5
            ? "zdjecia"
            : "zdjec"}
      </span>
    </div>
  );
}
