"use client";

import { RefreshCw } from "lucide-react";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { useMaterialsData } from "./_hooks/use-materials-data";
import { ReportHeader } from "./_components/report-header";
import { SummaryCards } from "./_components/summary-cards";
import { SecondaryStats } from "./_components/secondary-stats";
import { TabNavigation } from "./_components/tab-navigation";
import { ProductSummaryTab } from "./_components/product-summary-tab";
import { DetailsTab } from "./_components/details-tab";

export default function MaterialsProfitLossPage() {
  const {
    reportData,
    loading,
    salonLoading,
    error,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    activeTab,
    setActiveTab,
    fetchReport,
    handleExportCSV,
    handleExportPDF,
  } = useMaterialsData();

  return (
    <div className="container mx-auto p-6">
      <ReportHeader
        reportData={reportData}
        onExportPDF={handleExportPDF}
        onExportCSV={handleExportCSV}
      />

      <DateRangeFilter
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onApply={fetchReport}
        loading={loading}
      />

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Loading state */}
      {(salonLoading || loading) && (
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
          <SummaryCards totals={reportData.totals} />
          <SecondaryStats totals={reportData.totals} />

          <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

          {activeTab === "summary" && (
            <ProductSummaryTab
              summary={reportData.summary}
              totals={reportData.totals}
            />
          )}

          {activeTab === "details" && (
            <DetailsTab
              details={reportData.details}
              totals={reportData.totals}
            />
          )}
        </>
      )}
    </div>
  );
}
