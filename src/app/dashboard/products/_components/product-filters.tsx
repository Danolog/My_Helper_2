"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, ArrowUpDown } from "lucide-react";

interface ProductFiltersProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (c: string) => void;
  sortBy: string;
  onSortChange: (s: string) => void;
  uniqueCategories: string[];
}

export function ProductFilters({
  searchQuery,
  onSearchChange,
  categoryFilter,
  onCategoryFilterChange,
  sortBy,
  onSortChange,
  uniqueCategories,
}: ProductFiltersProps) {
  return (
    <div className="flex gap-3 mb-6">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Szukaj produktu..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
          maxLength={200}
          data-testid="product-search"
        />
      </div>
      <Select value={categoryFilter} onValueChange={onCategoryFilterChange}>
        <SelectTrigger className="w-48" data-testid="category-filter">
          <SelectValue placeholder="Kategoria" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Wszystkie kategorie</SelectItem>
          {uniqueCategories.map((cat) => (
            <SelectItem key={cat} value={cat}>
              {cat}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={sortBy} onValueChange={onSortChange}>
        <SelectTrigger className="w-52" data-testid="sort-select">
          <ArrowUpDown className="h-4 w-4 mr-2 shrink-0" />
          <SelectValue placeholder="Sortuj" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="name-asc">Nazwa A-Z</SelectItem>
          <SelectItem value="name-desc">Nazwa Z-A</SelectItem>
          <SelectItem value="quantity-asc">Ilosc rosnaco</SelectItem>
          <SelectItem value="quantity-desc">Ilosc malejaco</SelectItem>
          <SelectItem value="category-asc">Kategoria A-Z</SelectItem>
          <SelectItem value="category-desc">Kategoria Z-A</SelectItem>
          <SelectItem value="price-asc">Cena rosnaco</SelectItem>
          <SelectItem value="price-desc">Cena malejaco</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
