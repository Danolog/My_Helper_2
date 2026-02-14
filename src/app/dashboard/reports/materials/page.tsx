"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Package,
  Download,
  Calendar,
  TrendingUp,
  BarChart3,
  DollarSign,
  Search,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

interface ProductSummary {
  productId: string;
  productName: string;
  category: string | null;
  unit: string | null;
  pricePerUnit: string | null;
  currentStock: string | null;
  totalUsed: number;
  totalCost: number;
  usageCount: number;
}

interface DetailRecord {
  id: string;
  product: {
    id: string;
    name: string;
    category: string | null;
    unit: string | null;
    pricePerUnit: string | null;
  };
  quantityUsed: string;
  cost: string;
  date: string;
  appointment: {
    id: string;
    date: string;
    status: string;
  };
  employee: string | null;
  service: string | null;
}

interface ReportData {
  summary: ProductSummary[];
  details: DetailRecord[];
  totals: {
    totalCost: string;
    totalUsages: number;
    uniqueProducts: number;
  };
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
  };
}

export default function MaterialsReportPage() {
  const { data: session } = useSession();
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default date range: last 30 days
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [dateFrom, setDateFrom] = useState(
    thirtyDaysAgo.toISOString().split("T")[0]
  );
  const [dateTo, setDateTo] = useState(today.toISOString().split("T")[0]);
  const [activeTab, setActiveTab] = useState<"summary" | "details">("summary");

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        salonId: DEMO_SALON_ID,
      });
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);

      const res = await fetch(`/api/reports/materials?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Failed to fetch report");
      }
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || "Failed to fetch report");
      }
      setReportData(json.data);
    } catch (err) {
      console.error("[Materials Report] Error:", err);
      setError(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleExportCSV = async () => {
    try {
      const params = new URLSearchParams({
        salonId: DEMO_SALON_ID,
        format: "csv",
      });
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);

      const res = await fetch(`/api/reports/materials?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Failed to export report");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `raport-zuzycie-materialow-${dateFrom || "all"}-${dateTo || "all"}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Raport wyeksportowany do CSV");
    } catch (err) {
      console.error("[Materials Report] Export error:", err);
      toast.error("Nie udalo sie wyeksportowac raportu");
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDateShort = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Raport zuzycia materialow
          </h1>
          <p className="text-muted-foreground text-sm">
            Analiza zuzycia produktow w wybranym okresie
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleExportCSV}
          disabled={!reportData || reportData.summary.length === 0}
        >
          <Download className="h-4 w-4 mr-2" />
          Eksport CSV
        </Button>
      </div>

      {/* Date range filter */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-1 block">
                <Calendar className="h-3 w-3 inline mr-1" />
                Data od
              </label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium mb-1 block">
                <Calendar className="h-3 w-3 inline mr-1" />
                Data do
              </label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <Button onClick={fetchReport} disabled={loading}>
              <Search className="h-4 w-4 mr-2" />
              {loading ? "Ladowanie..." : "Generuj raport"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">
            Generowanie raportu...
          </span>
        </div>
      )}

      {/* Report content */}
      {reportData && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Calkowity koszt
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <DollarSign className="h-5 w-5 text-green-600" />
                  {parseFloat(reportData.totals.totalCost).toFixed(2)} PLN
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Liczba uzyc
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                  {reportData.totals.totalUsages}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Unikalne produkty
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <Package className="h-5 w-5 text-purple-600" />
                  {reportData.totals.uniqueProducts}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tab switch */}
          <div className="flex gap-2 mb-4">
            <Button
              variant={activeTab === "summary" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("summary")}
            >
              Podsumowanie wg produktu
            </Button>
            <Button
              variant={activeTab === "details" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveTab("details")}
            >
              Szczegolowe zuzycie
            </Button>
          </div>

          {/* Summary tab */}
          {activeTab === "summary" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Zuzycie wg produktu
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.summary.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Brak danych o zuzyciu w wybranym okresie</p>
                    <p className="text-sm mt-1">
                      Zmien zakres dat lub sprawdz czy produkty sa
                      uzywane podczas wizyt
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 px-2 font-medium">
                            Produkt
                          </th>
                          <th className="text-left py-3 px-2 font-medium">
                            Kategoria
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Zuzycie
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Cena/jedn.
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Koszt
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Aktualny stan
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Liczba uzyc
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.summary.map((item) => (
                          <tr
                            key={item.productId}
                            className="border-b hover:bg-muted/50"
                          >
                            <td className="py-3 px-2 font-medium">
                              {item.productName}
                            </td>
                            <td className="py-3 px-2">
                              {item.category ? (
                                <Badge variant="outline">
                                  {item.category}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">
                                  -
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-2 text-right">
                              {item.totalUsed.toFixed(2)}{" "}
                              {item.unit || "szt."}
                            </td>
                            <td className="py-3 px-2 text-right">
                              {parseFloat(item.pricePerUnit || "0").toFixed(2)}{" "}
                              PLN
                            </td>
                            <td className="py-3 px-2 text-right font-medium">
                              {item.totalCost.toFixed(2)} PLN
                            </td>
                            <td className="py-3 px-2 text-right">
                              {parseFloat(item.currentStock || "0").toFixed(2)}{" "}
                              {item.unit || "szt."}
                            </td>
                            <td className="py-3 px-2 text-right">
                              {item.usageCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 font-bold">
                          <td className="py-3 px-2" colSpan={4}>
                            RAZEM
                          </td>
                          <td className="py-3 px-2 text-right">
                            {parseFloat(
                              reportData.totals.totalCost
                            ).toFixed(2)}{" "}
                            PLN
                          </td>
                          <td className="py-3 px-2"></td>
                          <td className="py-3 px-2 text-right">
                            {reportData.totals.totalUsages}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Details tab */}
          {activeTab === "details" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Szczegolowe zuzycie materialow
                </CardTitle>
              </CardHeader>
              <CardContent>
                {reportData.details.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Brak szczegolowych danych w wybranym okresie</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-3 px-2 font-medium">
                            Data
                          </th>
                          <th className="text-left py-3 px-2 font-medium">
                            Produkt
                          </th>
                          <th className="text-left py-3 px-2 font-medium">
                            Usluga
                          </th>
                          <th className="text-left py-3 px-2 font-medium">
                            Pracownik
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Zuzycie
                          </th>
                          <th className="text-right py-3 px-2 font-medium">
                            Koszt
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.details.map((record) => (
                          <tr
                            key={record.id}
                            className="border-b hover:bg-muted/50"
                          >
                            <td className="py-3 px-2">
                              {formatDate(record.date)}
                            </td>
                            <td className="py-3 px-2 font-medium">
                              {record.product.name}
                            </td>
                            <td className="py-3 px-2">
                              {record.service || "-"}
                            </td>
                            <td className="py-3 px-2">
                              {record.employee || "-"}
                            </td>
                            <td className="py-3 px-2 text-right">
                              {parseFloat(record.quantityUsed).toFixed(2)}{" "}
                              {record.product.unit || "szt."}
                            </td>
                            <td className="py-3 px-2 text-right font-medium">
                              {parseFloat(record.cost).toFixed(2)} PLN
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 font-bold">
                          <td className="py-3 px-2" colSpan={4}>
                            RAZEM
                          </td>
                          <td className="py-3 px-2"></td>
                          <td className="py-3 px-2 text-right">
                            {parseFloat(
                              reportData.totals.totalCost
                            ).toFixed(2)}{" "}
                            PLN
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
