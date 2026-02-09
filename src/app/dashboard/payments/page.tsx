"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, CreditCard, Clock, CheckCircle, XCircle, RefreshCw, Filter, DollarSign, TrendingUp, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

interface Transaction {
  id: string;
  type: "deposit" | "subscription";
  amount: string;
  currency: string;
  status: string;
  paymentMethod: string;
  description: string;
  clientName: string | null;
  date: string;
  createdAt: string;
  appointmentId: string | null;
  subscriptionId: string | null;
}

interface PaymentSummary {
  totalSucceeded: string;
  totalPending: string;
  totalRefunded: string;
  transactionCount: number;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "succeeded":
      return (
        <Badge className="bg-green-100 text-green-800 border-green-300 hover:bg-green-100">
          <CheckCircle className="w-3 h-3 mr-1" />
          Zaplacono
        </Badge>
      );
    case "pending":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-100">
          <Clock className="w-3 h-3 mr-1" />
          Oczekujace
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-100 text-red-800 border-red-300 hover:bg-red-100">
          <XCircle className="w-3 h-3 mr-1" />
          Nieudane
        </Badge>
      );
    case "refunded":
      return (
        <Badge className="bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-100">
          <RefreshCw className="w-3 h-3 mr-1" />
          Zwrocone
        </Badge>
      );
    case "forfeited":
      return (
        <Badge className="bg-orange-100 text-orange-800 border-orange-300 hover:bg-orange-100">
          <AlertCircle className="w-3 h-3 mr-1" />
          Przepadly
        </Badge>
      );
    default:
      return (
        <Badge variant="outline">
          {status}
        </Badge>
      );
  }
}

function getTypeBadge(type: string) {
  switch (type) {
    case "deposit":
      return (
        <Badge variant="outline" className="text-purple-700 border-purple-300">
          Zadatek
        </Badge>
      );
    case "subscription":
      return (
        <Badge variant="outline" className="text-indigo-700 border-indigo-300">
          Subskrypcja
        </Badge>
      );
    default:
      return <Badge variant="outline">{type}</Badge>;
  }
}

function getPaymentMethodLabel(method: string) {
  switch (method) {
    case "stripe":
      return "Karta / Stripe";
    case "blik":
      return "BLIK P2P";
    case "cash":
      return "Gotowka";
    default:
      return method;
  }
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateShort(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function PaymentsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [currentPage, setCurrentPage] = useState(1);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        salonId: DEMO_SALON_ID,
        page: String(currentPage),
        limit: "20",
      });

      if (typeFilter !== "all") {
        params.set("type", typeFilter);
      }
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      if (dateFrom) {
        params.set("dateFrom", dateFrom);
      }
      if (dateTo) {
        params.set("dateTo", dateTo);
      }

      const response = await fetch(`/api/payments?${params.toString()}`);
      const data = await response.json();

      if (data.success) {
        setTransactions(data.data.transactions);
        setSummary(data.data.summary);
        setPagination(data.data.pagination);
      } else {
        setError(data.error || "Blad ladowania platnosci");
      }
    } catch (err) {
      setError("Blad polaczenia z serwerem");
      console.error("Error fetching payments:", err);
    } finally {
      setLoading(false);
    }
  }, [currentPage, typeFilter, statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const handleTypeFilterChange = (value: string) => {
    setTypeFilter(value);
    setCurrentPage(1);
  };

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  const handleDateFromChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDateFrom(e.target.value);
    setCurrentPage(1);
  };

  const handleDateToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDateTo(e.target.value);
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setTypeFilter("all");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
    setCurrentPage(1);
  };

  const hasActiveFilters = typeFilter !== "all" || statusFilter !== "all" || dateFrom !== "" || dateTo !== "";

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Powrot
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="w-6 h-6" />
            Historia platnosci
          </h1>
          <p className="text-muted-foreground text-sm">
            Przegladaj wszystkie transakcje salonu
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <TrendingUp className="w-4 h-4" />
              Razem oplacone
            </div>
            <p className="text-2xl font-bold text-green-600">
              {parseFloat(summary.totalSucceeded).toFixed(2)} PLN
            </p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Clock className="w-4 h-4" />
              Oczekujace
            </div>
            <p className="text-2xl font-bold text-yellow-600">
              {parseFloat(summary.totalPending).toFixed(2)} PLN
            </p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <RefreshCw className="w-4 h-4" />
              Zwroty
            </div>
            <p className="text-2xl font-bold text-blue-600">
              {parseFloat(summary.totalRefunded).toFixed(2)} PLN
            </p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <DollarSign className="w-4 h-4" />
              Transakcje
            </div>
            <p className="text-2xl font-bold">
              {summary.transactionCount}
            </p>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="border border-border rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filtry</span>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs">
              Wyczysc filtry
            </Button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Type Filter */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Typ</label>
            <Select value={typeFilter} onValueChange={handleTypeFilterChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Wszystkie typy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Wszystkie typy</SelectItem>
                <SelectItem value="deposit">Zadatki</SelectItem>
                <SelectItem value="subscription">Subskrypcje</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Status</label>
            <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Wszystkie statusy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Wszystkie statusy</SelectItem>
                <SelectItem value="succeeded">Zaplacone</SelectItem>
                <SelectItem value="pending">Oczekujace</SelectItem>
                <SelectItem value="failed">Nieudane</SelectItem>
                <SelectItem value="refunded">Zwrocone</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date From */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Data od</label>
            <Input
              type="date"
              value={dateFrom}
              onChange={handleDateFromChange}
              className="w-full"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Data do</label>
            <Input
              type="date"
              value={dateTo}
              onChange={handleDateToChange}
              className="w-full"
            />
          </div>
        </div>
      </div>

      {/* Transaction List */}
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="text-muted-foreground">Ladowanie platnosci...</div>
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <XCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
          <p className="text-destructive font-medium">{error}</p>
          <Button variant="outline" onClick={fetchPayments} className="mt-4">
            Sprobuj ponownie
          </Button>
        </div>
      ) : transactions.length === 0 ? (
        <div className="text-center py-12 border border-border rounded-lg">
          <CreditCard className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground font-medium">Brak transakcji</p>
          <p className="text-muted-foreground text-sm mt-1">
            {hasActiveFilters
              ? "Brak platnosci pasujacych do wybranych filtrow"
              : "Nie znaleziono zadnych platnosci"
            }
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">Data</th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">Opis</th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">Typ</th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">Metoda</th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground">Kwota</th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                    <td className="p-3 text-sm">
                      {formatDate(tx.date)}
                    </td>
                    <td className="p-3">
                      <div className="text-sm font-medium">{tx.description}</div>
                      {tx.clientName && (
                        <div className="text-xs text-muted-foreground">
                          Klient: {tx.clientName}
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      {getTypeBadge(tx.type)}
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {getPaymentMethodLabel(tx.paymentMethod)}
                    </td>
                    <td className="p-3 text-right">
                      <span className={`font-semibold ${tx.status === "refunded" ? "text-blue-600" : tx.status === "succeeded" ? "text-green-600" : ""}`}>
                        {tx.status === "refunded" ? "-" : ""}
                        {parseFloat(tx.amount).toFixed(2)} {tx.currency}
                      </span>
                    </td>
                    <td className="p-3">
                      {getStatusBadge(tx.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {transactions.map((tx) => (
              <Card key={tx.id} className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{tx.description}</div>
                    {tx.clientName && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Klient: {tx.clientName}
                      </div>
                    )}
                  </div>
                  <span className={`font-semibold text-sm ${tx.status === "refunded" ? "text-blue-600" : tx.status === "succeeded" ? "text-green-600" : ""}`}>
                    {tx.status === "refunded" ? "-" : ""}
                    {parseFloat(tx.amount).toFixed(2)} {tx.currency}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{formatDateShort(tx.date)}</span>
                  {getTypeBadge(tx.type)}
                  <span className="text-muted-foreground">{getPaymentMethodLabel(tx.paymentMethod)}</span>
                  {getStatusBadge(tx.status)}
                </div>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex justify-center items-center gap-4 mt-6">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              >
                Poprzednia
              </Button>
              <span className="text-sm text-muted-foreground">
                Strona {pagination.page} z {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= pagination.totalPages}
                onClick={() => setCurrentPage(p => p + 1)}
              >
                Nastepna
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
