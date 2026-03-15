"use client";

import { RefreshCw } from "lucide-react";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { useProfitabilityData } from "./_hooks/use-profitability-data";
import { ProfitabilityHeader } from "./_components/ProfitabilityHeader";
import { ProfitabilityFilters } from "./_components/ProfitabilityFilters";
import { ProfitabilityChart } from "./_components/ProfitabilityChart";
import { ProfitabilityTable } from "./_components/ProfitabilityTable";

export default function ServiceProfitabilityPage() {
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
  } = useProfitabilityData();

  return (
    <div className="container mx-auto p-6">
      <ProfitabilityHeader
        reportData={reportData}
        onExportPDF={handleExportPDF}
        onExportCSV={handleExportCSV}
      />

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
      {reportData && !loading && (
        <>
          <ProfitabilityFilters
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />

          {activeTab === "summary" && (
            <ProfitabilityChart reportData={reportData} />
          )}

          {activeTab === "details" && (
            <ProfitabilityTable reportData={reportData} />
          )}
        </>
      )}
    </div>
  );
}
