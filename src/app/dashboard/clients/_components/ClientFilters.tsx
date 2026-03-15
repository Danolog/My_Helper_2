"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search,
  Filter,
  X,
  Calendar,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import type { ClientFiltersState } from "../_types";

interface ClientFiltersProps {
  // Search
  searchQuery: string;
  onSearchChange: (q: string) => void;

  // Filter panel toggle
  filtersOpen: boolean;
  onFiltersOpenChange: (open: boolean) => void;

  // Filter UI state (input values)
  dateAddedFrom: string;
  onDateAddedFromChange: (v: string) => void;
  dateAddedTo: string;
  onDateAddedToChange: (v: string) => void;
  lastVisitFrom: string;
  onLastVisitFromChange: (v: string) => void;
  lastVisitTo: string;
  onLastVisitToChange: (v: string) => void;
  filterHasAllergies: boolean;
  onFilterHasAllergiesChange: (v: boolean) => void;

  // Applied filters (for badge display)
  appliedFilters: ClientFiltersState;
  hasActiveFilters: boolean;
  activeFilterCount: number;

  // Actions
  onApplyFilters: () => void;
  onClearFilters: () => void;
}

export function ClientFilters({
  searchQuery,
  onSearchChange,
  filtersOpen,
  onFiltersOpenChange,
  dateAddedFrom,
  onDateAddedFromChange,
  dateAddedTo,
  onDateAddedToChange,
  lastVisitFrom,
  onLastVisitFromChange,
  lastVisitTo,
  onLastVisitToChange,
  filterHasAllergies,
  onFilterHasAllergiesChange,
  appliedFilters,
  hasActiveFilters,
  activeFilterCount,
  onApplyFilters,
  onClearFilters,
}: ClientFiltersProps) {
  return (
    <>
      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Szukaj klienta po imieniu, nazwisku, telefonie lub emailu..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
          maxLength={200}
          data-testid="client-search-input"
        />
      </div>

      {/* Filter toggle button */}
      <div className="flex items-center gap-2 mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onFiltersOpenChange(!filtersOpen)}
          data-testid="toggle-filters-btn"
          className="flex items-center gap-2"
        >
          <Filter className="h-4 w-4" />
          Filtry
          {hasActiveFilters && (
            <Badge variant="default" className="ml-1 text-xs px-1.5 py-0" data-testid="active-filter-count">
              {activeFilterCount}
            </Badge>
          )}
          {filtersOpen ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </Button>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            data-testid="clear-filters-btn"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4 mr-1" />
            Wyczysc filtry
          </Button>
        )}
      </div>

      {/* Active filter badges */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-2 mb-4" data-testid="active-filters-badges">
          {(appliedFilters.dateAddedFrom || appliedFilters.dateAddedTo) && (
            <Badge variant="secondary" className="text-xs gap-1" data-testid="filter-badge-date-added">
              <Calendar className="h-3 w-3" />
              Data dodania: {appliedFilters.dateAddedFrom || "..."} - {appliedFilters.dateAddedTo || "..."}
            </Badge>
          )}
          {(appliedFilters.lastVisitFrom || appliedFilters.lastVisitTo) && (
            <Badge variant="secondary" className="text-xs gap-1" data-testid="filter-badge-last-visit">
              <Calendar className="h-3 w-3" />
              Ostatnia wizyta: {appliedFilters.lastVisitFrom || "..."} - {appliedFilters.lastVisitTo || "..."}
            </Badge>
          )}
          {appliedFilters.hasAllergies && (
            <Badge variant="secondary" className="text-xs gap-1" data-testid="filter-badge-allergies">
              <AlertTriangle className="h-3 w-3" />
              Z alergiami
            </Badge>
          )}
        </div>
      )}

      {/* Filter panel */}
      {filtersOpen && (
        <Card className="mb-6" data-testid="filter-panel">
          <CardContent className="p-4">
            <div className="grid gap-4">
              {/* Date Added filter row */}
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Data dodania klienta
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="filter-date-added-from" className="text-xs text-muted-foreground">
                      Od
                    </Label>
                    <Input
                      id="filter-date-added-from"
                      type="date"
                      value={dateAddedFrom}
                      onChange={(e) => onDateAddedFromChange(e.target.value)}
                      data-testid="filter-date-added-from"
                    />
                  </div>
                  <div>
                    <Label htmlFor="filter-date-added-to" className="text-xs text-muted-foreground">
                      Do
                    </Label>
                    <Input
                      id="filter-date-added-to"
                      type="date"
                      value={dateAddedTo}
                      onChange={(e) => onDateAddedToChange(e.target.value)}
                      data-testid="filter-date-added-to"
                    />
                  </div>
                </div>
              </div>

              {/* Last Visit filter row */}
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Ostatnia wizyta
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="filter-last-visit-from" className="text-xs text-muted-foreground">
                      Od
                    </Label>
                    <Input
                      id="filter-last-visit-from"
                      type="date"
                      value={lastVisitFrom}
                      onChange={(e) => onLastVisitFromChange(e.target.value)}
                      data-testid="filter-last-visit-from"
                    />
                  </div>
                  <div>
                    <Label htmlFor="filter-last-visit-to" className="text-xs text-muted-foreground">
                      Do
                    </Label>
                    <Input
                      id="filter-last-visit-to"
                      type="date"
                      value={lastVisitTo}
                      onChange={(e) => onLastVisitToChange(e.target.value)}
                      data-testid="filter-last-visit-to"
                    />
                  </div>
                </div>
              </div>

              {/* Has Allergies filter */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="filter-has-allergies"
                  checked={filterHasAllergies}
                  onCheckedChange={(checked) =>
                    onFilterHasAllergiesChange(checked === true)
                  }
                  data-testid="filter-has-allergies"
                />
                <Label htmlFor="filter-has-allergies" className="text-sm cursor-pointer">
                  Tylko klienci z alergiami
                </Label>
              </div>

              {/* Filter action buttons */}
              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={onApplyFilters}
                  data-testid="apply-filters-btn"
                >
                  <Filter className="h-4 w-4 mr-2" />
                  Filtruj
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClearFilters}
                  data-testid="clear-filters-panel-btn"
                >
                  <X className="h-4 w-4 mr-2" />
                  Wyczysc
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
