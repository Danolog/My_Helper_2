"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CreditCard,
  Download,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCw,
  Receipt,
  Calendar,
  DollarSign,
  TrendingUp,
  FileText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PaymentData = {
  id: string;
  subscriptionId: string;
  amount: string;
  currency: string;
  status: string;
  stripePaymentIntentId: string | null;
  paidAt: string | null;
  createdAt: string;
  planName: string;
  planSlug: string;
  planPrice: string | null;
  subscriptionStatus: string | null;
  periodStart: string | null;
  periodEnd: string | null;
};

type SummaryData = {
  totalSucceeded: string;
  totalPending: string;
  totalFailed: string;
  paymentCount: number;
  succeededCount: number;
  pendingCount: number;
  failedCount: number;
};

type PaginationData = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  try {
    return new Intl.DateTimeFormat("pl-PL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  try {
    return new Intl.DateTimeFormat("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "succeeded":
      return "Zaplacono";
    case "pending":
      return "Oczekuje";
    case "failed":
      return "Nieudana";
    default:
      return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "succeeded":
      return "bg-green-100 text-green-800 hover:bg-green-100 border-green-200";
    case "pending":
      return "bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200";
    case "failed":
      return "bg-red-100 text-red-800 hover:bg-red-100 border-red-200";
    default:
      return "";
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "succeeded":
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case "pending":
      return <Clock className="h-4 w-4 text-amber-600" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-600" />;
    default:
      return <CreditCard className="h-4 w-4 text-muted-foreground" />;
  }
}

export default function SubscriptionPaymentHistoryPage() {
  const [payments, setPayments] = useState<PaymentData[]>([]);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const fetchPayments = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);

      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", "20");
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      if (dateFrom) {
        params.set("dateFrom", dateFrom);
      }
      if (dateTo) {
        params.set("dateTo", dateTo);
      }

      const res = await fetch(
        `/api/subscriptions/payments?${params.toString()}`,
      );
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(
          data.error || "Nie udalo sie pobrac historii platnosci",
        );
      }

      setPayments(data.data.payments);
      setSummary(data.data.summary);
      setPagination(data.data.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wystapil blad");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, dateFrom, dateTo, page]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const handleDownloadReceipt = (paymentId: string) => {
    window.open(
      `/api/subscriptions/payments/${paymentId}/receipt`,
      "_blank",
    );
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/subscription">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Historia platnosci</h1>
          <p className="text-muted-foreground">
            Przegladaj platnosci za subskrypcje i pobieraj potwierdzenia
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoading(true);
            fetchPayments();
          }}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Odswiez
        </Button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-green-100 dark:bg-green-950/30">
                  <DollarSign className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Zaplacono</p>
                  <p className="text-lg font-bold">
                    {parseFloat(summary.totalSucceeded).toFixed(2)} PLN
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950/30">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Platnosci</p>
                  <p className="text-lg font-bold">{summary.paymentCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-950/30">
                  <Clock className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Oczekujace</p>
                  <p className="text-lg font-bold">{summary.pendingCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-red-100 dark:bg-red-950/30">
                  <XCircle className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Nieudane</p>
                  <p className="text-lg font-bold">{summary.failedCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Status
              </label>
              <Select value={statusFilter} onValueChange={(val) => { setStatusFilter(val); setPage(1); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Wszystkie" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Wszystkie</SelectItem>
                  <SelectItem value="succeeded">Zaplacono</SelectItem>
                  <SelectItem value="pending">Oczekujace</SelectItem>
                  <SelectItem value="failed">Nieudane</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Data od
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Data do
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              />
            </div>
            {(statusFilter !== "all" || dateFrom || dateTo) && (
              <div className="flex items-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStatusFilter("all");
                    setDateFrom("");
                    setDateTo("");
                    setPage(1);
                  }}
                >
                  Wyczysc filtry
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Error State */}
      {error && (
        <Card className="border-red-200">
          <CardContent className="p-6 text-center">
            <XCircle className="h-8 w-8 text-red-500 mx-auto mb-2" />
            <p className="text-red-700 font-medium">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={fetchPayments}>
              Sprobuj ponownie
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {loading && !error && (
        <Card>
          <CardContent className="p-6 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-8 w-8" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Payment List */}
      {!loading && !error && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                <Receipt className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Lista platnosci</CardTitle>
                <CardDescription>
                  {pagination
                    ? `${pagination.total} ${pagination.total === 1 ? "platnosc" : pagination.total < 5 ? "platnosci" : "platnosci"}`
                    : "Brak platnosci"}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
                <h3 className="font-medium text-lg mb-1">
                  Brak platnosci
                </h3>
                <p className="text-muted-foreground text-sm">
                  Nie znaleziono zadnych platnosci za subskrypcje
                  {statusFilter !== "all" || dateFrom || dateTo
                    ? " dla wybranych filtrow"
                    : ""}
                  .
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-center gap-4 p-4 rounded-lg border hover:bg-muted/30 transition-colors"
                  >
                    {/* Status Icon */}
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted/50">
                      <StatusIcon status={payment.status} />
                    </div>

                    {/* Payment Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-sm">
                          Subskrypcja {payment.planName}
                        </p>
                        <Badge
                          variant="outline"
                          className={`text-xs ${statusColor(payment.status)}`}
                        >
                          {statusLabel(payment.status)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(payment.paidAt || payment.createdAt)}
                        </span>
                        {payment.periodStart && payment.periodEnd && (
                          <span>
                            Okres: {formatShortDate(payment.periodStart)} -{" "}
                            {formatShortDate(payment.periodEnd)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Amount */}
                    <div className="text-right">
                      <p className="font-semibold">
                        {parseFloat(payment.amount).toFixed(2)} {payment.currency}
                      </p>
                    </div>

                    {/* Download Receipt */}
                    {payment.status === "succeeded" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDownloadReceipt(payment.id)}
                        title="Pobierz potwierdzenie"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 && (
              <div className="flex items-center justify-between pt-4 mt-4 border-t">
                <p className="text-sm text-muted-foreground">
                  Strona {pagination.page} z {pagination.totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Poprzednia
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() =>
                      setPage((p) =>
                        Math.min(pagination.totalPages, p + 1),
                      )
                    }
                  >
                    Nastepna
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Link back to subscription */}
      <div className="text-center">
        <Button variant="link" asChild>
          <Link href="/dashboard/subscription">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Powrot do zarzadzania subskrypcja
          </Link>
        </Button>
      </div>
    </div>
  );
}
