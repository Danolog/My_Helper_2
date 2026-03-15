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
import type { Employee, Service } from "./gallery-types";

interface GalleryToolbarProps {
  employees: Employee[];
  services: Service[];
  filterEmployeeId: string;
  filterServiceId: string;
  filterPairsOnly: boolean;
  displayPhotosCount: number;
  onEmployeeFilterChange: (value: string) => void;
  onServiceFilterChange: (value: string) => void;
  onTogglePairsOnly: () => void;
  onClearFilters: () => void;
}

export function GalleryToolbar({
  employees,
  services,
  filterEmployeeId,
  filterServiceId,
  filterPairsOnly,
  displayPhotosCount,
  onEmployeeFilterChange,
  onServiceFilterChange,
  onTogglePairsOnly,
  onClearFilters,
}: GalleryToolbarProps) {
  const hasActiveFilters =
    (filterEmployeeId && filterEmployeeId !== "all") ||
    (filterServiceId && filterServiceId !== "all") ||
    filterPairsOnly;

  return (
    <div className="flex flex-wrap items-center gap-3 mb-6 p-3 bg-muted/50 rounded-lg">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Filter className="w-4 h-4" />
        <span>Filtry:</span>
      </div>
      <Select value={filterEmployeeId || "all"} onValueChange={onEmployeeFilterChange}>
        <SelectTrigger className="w-[220px]">
          <SelectValue placeholder="Wszyscy pracownicy" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            <span className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Wszyscy pracownicy
            </span>
          </SelectItem>
          {employees.map((emp) => (
            <SelectItem key={emp.id} value={emp.id}>
              {emp.firstName} {emp.lastName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filterServiceId || "all"} onValueChange={onServiceFilterChange}>
        <SelectTrigger className="w-[220px]">
          <SelectValue placeholder="Wszystkie uslugi" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            <span className="flex items-center gap-2">
              <Scissors className="w-4 h-4" />
              Wszystkie uslugi
            </span>
          </SelectItem>
          {services.map((svc) => (
            <SelectItem key={svc.id} value={svc.id}>
              {svc.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant={filterPairsOnly ? "default" : "outline"}
        size="sm"
        onClick={onTogglePairsOnly}
        className="gap-1"
      >
        <SlidersHorizontal className="w-4 h-4" />
        Tylko pary
      </Button>
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearFilters}
        >
          <X className="w-4 h-4 mr-1" />
          Wyczysc filtry
        </Button>
      )}
      <span className="text-xs text-muted-foreground ml-auto">
        {displayPhotosCount} {displayPhotosCount === 1 ? "zdjecie" : "zdjec"}
      </span>
    </div>
  );
}
