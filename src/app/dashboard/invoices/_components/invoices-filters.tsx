"use client";

import { Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InvoiceSummary } from "../_hooks/use-invoices-data";

interface InvoicesFiltersProps {
  dateFrom: string;
  dateTo: string;
  typeFilter: string;
  searchQuery: string;
  summary: InvoiceSummary | null;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onTypeFilterChange: (value: string) => void;
  onSearchQueryChange: (value: string) => void;
  onRefresh: () => void;
}

export function InvoicesFilters({
  dateFrom,
  dateTo,
  typeFilter,
  searchQuery,
  summary,
  onDateFromChange,
  onDateToChange,
  onTypeFilterChange,
  onSearchQueryChange,
  onRefresh,
}: InvoicesFiltersProps) {
  return (
    <>
      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <Label>Od daty</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => onDateFromChange(e.target.value)}
                data-testid="date-from-input"
              />
            </div>
            <div>
              <Label>Do daty</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => onDateToChange(e.target.value)}
                data-testid="date-to-input"
              />
            </div>
            <div>
              <Label>Typ</Label>
              <Select value={typeFilter} onValueChange={onTypeFilterChange}>
                <SelectTrigger className="w-[160px]" data-testid="type-filter">
                  <SelectValue placeholder="Wszystkie" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Wszystkie</SelectItem>
                  <SelectItem value="paragon">Rachunek</SelectItem>
                  <SelectItem value="faktura">Faktura VAT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <Label>Szukaj</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Numer faktury, klient, firma..."
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  className="pl-9"
                  maxLength={200}
                  data-testid="search-input"
                />
              </div>
            </div>
            <Button
              onClick={onRefresh}
              variant="outline"
              data-testid="refresh-btn"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Odswiez
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-muted-foreground">
                Liczba faktur
              </p>
              <div className="text-2xl font-bold mt-2" data-testid="total-invoices">
                {summary.totalInvoices}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {summary.paragonCount} rachunkow, {summary.fakturaCount} faktur VAT
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-muted-foreground">
                Kwota brutto
              </p>
              <div className="text-2xl font-bold mt-2" data-testid="total-amount">
                {parseFloat(summary.totalAmount).toFixed(2)} PLN
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-muted-foreground">
                Kwota netto
              </p>
              <div className="text-2xl font-bold mt-2" data-testid="total-net">
                {parseFloat(summary.totalNet).toFixed(2)} PLN
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-muted-foreground">
                VAT
              </p>
              <div className="text-2xl font-bold mt-2" data-testid="total-vat">
                {parseFloat(summary.totalVat).toFixed(2)} PLN
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
