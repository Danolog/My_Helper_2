"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  TrendingUp,
  Tag,
  RefreshCw,
  BarChart3,
  Percent,
  Users,
  Ticket,
  CheckCircle2,
  XCircle,
  DollarSign,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";
import { useSalonId } from "@/hooks/use-salon-id";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import { generateReportPDF } from "@/lib/pdf-export";

interface PromotionData {
  promotionId: string;
  promotionName: string;
  promotionType: string;
  promotionValue: string;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  totalUsageCount: number;
  completedCount: number;
  cancelledCount: number;
  totalDiscountGiven: string;
  totalRevenueGenerated: string;
  totalBasePriceBeforeDiscount: string;
  uniqueClients: number;
  promoCodes: string[];
  roi: string;
  conversionRate: string;
}

interface ReportData {
  summary: {
    totalPromotions: number;
    activePromotions: number;
    totalPromoUsage: number;
    totalCompletedWithPromo: number;
    totalDiscountGiven: string;
    totalRevenueFromPromos: string;
    overallROI: string;
    avgNoPromoPrice: string;
    totalNoPromoAppointments: number;
  };
  promotions: PromotionData[];
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
  };
}

function getPromoTypeBadge(type: string) {
  const typeLabels: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    percentage: { label: "Procentowa", variant: "default" },
    fixed: { label: "Kwotowa", variant: "secondary" },
    package: { label: "Pakiet", variant: "outline" },
    buy2get1: { label: "2+1 gratis", variant: "default" },
    happy_hours: { label: "Happy Hours", variant: "secondary" },
    first_visit: { label: "Pierwsza wizyta", variant: "outline" },
  };
  const info = typeLabels[type] || { label: type, variant: "outline" as const };
  return <Badge variant={info.variant}>{info.label}</Badge>;
}

function formatROI(roi: string) {
  const val = parseFloat(roi);
  if (val > 0) return <span className="text-green-700 font-bold">+{roi}%</span>;
  if (val < 0) return <span className="text-red-600 font-bold">{roi}%</span>;
  return <span className="text-muted-foreground">0%</span>;
}

export default function PromotionsReportPage() {
  const { data: _session } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default date range: last 90 days (promotions need wider window)
  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const [dateFrom, setDateFrom] = useState(
    ninetyDaysAgo.toISOString().split("T")[0]
  );
  const [dateTo, setDateTo] = useState(today.toISOString().split("T")[0]);

  const fetchReport = useCallback(async () => {
    if (!salonId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        salonId: salonId!,
      });
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);

      const res = await fetch(`/api/reports/promotions?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Nie udalo sie pobrac raportu");
      }
      const json = await res.json();
      if (!json.success) {
        throw new Error("Nie udalo sie pobrac raportu. Sprobuj ponownie pozniej.");
      }
      setReportData(json.data);
    } catch {
      setError("Nie udalo sie zaladowac raportu. Sprobuj ponownie pozniej.");
    } finally {
      setLoading(false);
    }
  }, [salonId, dateFrom, dateTo]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleExportCSV = async () => {
    if (!salonId) return;
    try {
      const params = new URLSearchParams({
        salonId: salonId!,
        format: "csv",
      });
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);

      const res = await fetch(`/api/reports/promotions?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Failed to export report");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `raport-promocji-${dateFrom || "all"}-${dateTo || "all"}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Raport wyeksportowany do CSV");
    } catch {
      toast.error("Nie udalo sie wyeksportowac raportu");
    }
  };

  const handleExportPDF = () => {
    if (!reportData) return;
    try {
      generateReportPDF({
        title: "Raport efektywnosci promocji",
        subtitle: "ROI i skutecznosc promocji w wybranym okresie",
        dateRange: dateFrom && dateTo ? { from: dateFrom, to: dateTo } : undefined,
        summaryCards: [
          { label: "Laczna kwota znizek", value: `${parseFloat(reportData.summary.totalDiscountGiven).toFixed(2)} PLN` },
          { label: "Przychod z promocji", value: `${parseFloat(reportData.summary.totalRevenueFromPromos).toFixed(2)} PLN` },
          { label: "Uzycie promocji", value: `${reportData.summary.totalPromoUsage}` },
          { label: "ROI", value: `${reportData.summary.overallROI}%` },
        ],
        tables: [
          ...(reportData.promotions.length > 0
            ? [
                {
                  title: "Szczegoly promocji",
                  headers: ["Promocja", "Typ", "Uzycie", "Ukonczone", "Anulowane", "Koszt znizek", "Przychod", "ROI", "Klienci"],
                  rows: reportData.promotions.map((promo) => [
                    promo.promotionName,
                    promo.promotionType,
                    `${promo.totalUsageCount}`,
                    `${promo.completedCount}`,
                    `${promo.cancelledCount}`,
                    `${parseFloat(promo.totalDiscountGiven).toFixed(2)} PLN`,
                    `${parseFloat(promo.totalRevenueGenerated).toFixed(2)} PLN`,
                    `${promo.roi}%`,
                    `${promo.uniqueClients}`,
                  ]),
                  footerRow: [
                    "RAZEM",
                    "",
                    `${reportData.summary.totalPromoUsage}`,
                    `${reportData.summary.totalCompletedWithPromo}`,
                    "",
                    `${parseFloat(reportData.summary.totalDiscountGiven).toFixed(2)} PLN`,
                    `${parseFloat(reportData.summary.totalRevenueFromPromos).toFixed(2)} PLN`,
                    `${reportData.summary.overallROI}%`,
                    "",
                  ],
                },
              ]
            : []),
        ],
        filename: `raport-promocji-${dateFrom || "all"}-${dateTo || "all"}.pdf`,
      });
      toast.success("Raport wyeksportowany do PDF");
    } catch {
      toast.error("Nie udalo sie wyeksportowac raportu do PDF");
    }
  };

  // Calculate max usage for bar chart scaling
  const maxUsage =
    reportData?.promotions
      ? Math.max(...reportData.promotions.map((p) => p.totalUsageCount), 1)
      : 1;

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
            <Tag className="h-6 w-6 text-purple-600" />
            Raport efektywnosci promocji
          </h1>
          <p className="text-muted-foreground text-sm">
            ROI i skutecznosc promocji w wybranym okresie
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleExportPDF}
            disabled={!reportData || reportData.promotions.length === 0}
          >
            <FileText className="h-4 w-4 mr-2" />
            Eksport PDF
          </Button>
          <Button
            variant="outline"
            onClick={handleExportCSV}
            disabled={!reportData || reportData.promotions.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Eksport CSV
          </Button>
        </div>
      </div>

      {/* Date range filter */}
      <DateRangeFilter
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onApply={fetchReport}
        loading={loading}
      />

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Loading */}
      {(salonLoading || loading) && (
        <div className="flex justify-center items-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">
            Generowanie raportu...
          </span>
        </div>
      )}

      {/* Report content */}
      {reportData && !loading && !salonLoading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Laczna kwota znizek
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <Percent className="h-5 w-5 text-orange-600" />
                  {parseFloat(reportData.summary.totalDiscountGiven).toFixed(2)} PLN
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Przychod z promocji
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <DollarSign className="h-5 w-5 text-green-600" />
                  {parseFloat(reportData.summary.totalRevenueFromPromos).toFixed(
                    2
                  )}{" "}
                  PLN
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Uzycie promocji
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <Ticket className="h-5 w-5 text-blue-600" />
                  {reportData.summary.totalPromoUsage}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {reportData.summary.totalCompletedWithPromo} ukonczonych
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  ROI
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold flex items-center gap-1">
                  <TrendingUp className="h-5 w-5 text-purple-600" />
                  {formatROI(reportData.summary.overallROI)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {reportData.summary.activePromotions}/{reportData.summary.totalPromotions} aktywnych
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Promotion usage chart */}
          {reportData.promotions.length > 0 && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Uzycie promocji
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {reportData.promotions.map((promo) => (
                    <div key={promo.promotionId} className="flex items-center gap-3">
                      <span className="text-sm w-40 truncate shrink-0" title={promo.promotionName}>
                        {promo.promotionName}
                      </span>
                      <div className="flex-1 bg-muted rounded-full h-6 relative overflow-hidden">
                        <div
                          className="bg-purple-500 h-6 rounded-full flex items-center transition-all"
                          style={{
                            width: `${Math.max(
                              (promo.totalUsageCount / maxUsage) * 100,
                              2
                            )}%`,
                          }}
                        >
                          {promo.totalUsageCount / maxUsage > 0.2 && (
                            <span className="text-xs text-white font-medium pl-2 whitespace-nowrap">
                              {promo.totalUsageCount}x
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-medium w-16 text-right shrink-0">
                        {promo.totalUsageCount}x
                      </span>
                      <Badge variant={promo.isActive ? "default" : "secondary"} className="shrink-0">
                        {promo.isActive ? "Aktywna" : "Nieaktywna"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Detailed promotion table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Szczegoly promocji
              </CardTitle>
            </CardHeader>
            <CardContent>
              {reportData.promotions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Tag className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Brak promocji do wyswietlenia</p>
                  <p className="text-sm mt-1">
                    Dodaj promocje w sekcji Promocje
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-2 font-medium">
                          Promocja
                        </th>
                        <th className="text-center py-3 px-2 font-medium">
                          Typ
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Uzycie
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          <CheckCircle2 className="h-3 w-3 inline mr-1" />
                          Ukonczone
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          <XCircle className="h-3 w-3 inline mr-1" />
                          Anulowane
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Koszt znizek
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          Przychod
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          ROI
                        </th>
                        <th className="text-right py-3 px-2 font-medium">
                          <Users className="h-3 w-3 inline mr-1" />
                          Klienci
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.promotions.map((promo) => (
                        <tr
                          key={promo.promotionId}
                          className="border-b hover:bg-muted/50"
                        >
                          <td className="py-3 px-2">
                            <div className="font-medium">{promo.promotionName}</div>
                            {promo.promoCodes.length > 0 && (
                              <div className="text-xs text-muted-foreground mt-1">
                                Kody: {promo.promoCodes.join(", ")}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-2 text-center">
                            {getPromoTypeBadge(promo.promotionType)}
                          </td>
                          <td className="py-3 px-2 text-right font-medium">
                            {promo.totalUsageCount}
                          </td>
                          <td className="py-3 px-2 text-right text-green-700">
                            {promo.completedCount}
                          </td>
                          <td className="py-3 px-2 text-right text-red-600">
                            {promo.cancelledCount}
                          </td>
                          <td className="py-3 px-2 text-right text-orange-700">
                            {parseFloat(promo.totalDiscountGiven).toFixed(2)} PLN
                          </td>
                          <td className="py-3 px-2 text-right font-medium text-green-700">
                            {parseFloat(promo.totalRevenueGenerated).toFixed(2)}{" "}
                            PLN
                          </td>
                          <td className="py-3 px-2 text-right">
                            {formatROI(promo.roi)}
                          </td>
                          <td className="py-3 px-2 text-right">
                            {promo.uniqueClients}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 font-bold">
                        <td className="py-3 px-2">RAZEM</td>
                        <td className="py-3 px-2" />
                        <td className="py-3 px-2 text-right">
                          {reportData.summary.totalPromoUsage}
                        </td>
                        <td className="py-3 px-2 text-right text-green-700">
                          {reportData.summary.totalCompletedWithPromo}
                        </td>
                        <td className="py-3 px-2" />
                        <td className="py-3 px-2 text-right text-orange-700">
                          {parseFloat(
                            reportData.summary.totalDiscountGiven
                          ).toFixed(2)}{" "}
                          PLN
                        </td>
                        <td className="py-3 px-2 text-right text-green-700">
                          {parseFloat(
                            reportData.summary.totalRevenueFromPromos
                          ).toFixed(2)}{" "}
                          PLN
                        </td>
                        <td className="py-3 px-2 text-right">
                          {formatROI(reportData.summary.overallROI)}
                        </td>
                        <td className="py-3 px-2" />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Comparison card: promo vs no-promo */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Porownanie: z promocja vs bez promocji
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h3 className="font-medium flex items-center gap-2">
                    <Tag className="h-4 w-4 text-purple-600" />
                    Z promocja
                  </h3>
                  <div className="text-sm space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Wizyty ukonczone:</span>
                      <span className="font-medium">
                        {reportData.summary.totalCompletedWithPromo}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Przychod:</span>
                      <span className="font-medium text-green-700">
                        {parseFloat(
                          reportData.summary.totalRevenueFromPromos
                        ).toFixed(2)}{" "}
                        PLN
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Znizki udzielone:</span>
                      <span className="font-medium text-orange-700">
                        -{parseFloat(
                          reportData.summary.totalDiscountGiven
                        ).toFixed(2)}{" "}
                        PLN
                      </span>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <h3 className="font-medium flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-green-600" />
                    Bez promocji
                  </h3>
                  <div className="text-sm space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Wizyty ukonczone:</span>
                      <span className="font-medium">
                        {reportData.summary.totalNoPromoAppointments}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Przychod:</span>
                      <span className="font-medium text-green-700">
                        {(
                          parseFloat(reportData.summary.avgNoPromoPrice) *
                          reportData.summary.totalNoPromoAppointments
                        ).toFixed(2)}{" "}
                        PLN
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Srednia cena:</span>
                      <span className="font-medium">
                        {parseFloat(reportData.summary.avgNoPromoPrice).toFixed(
                          2
                        )}{" "}
                        PLN
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
