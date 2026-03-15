"use client";

import dynamic from "next/dynamic";
import { RefreshCw } from "lucide-react";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { PopularityFilters } from "./_components/PopularityFilters";
import { PopularityHeader } from "./_components/PopularityHeader";
import { usePopularityData } from "./_hooks/use-popularity-data";

const PopularityChart = dynamic(
  () => import("./_components/PopularityChart").then((m) => m.PopularityChart),
);
const PopularityTable = dynamic(
  () => import("./_components/PopularityTable").then((m) => m.PopularityTable),
);

export default function EmployeePopularityReportPage() {
  const {
    reportData,
    loading,
    salonLoading,
    error,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    fetchReport,
    handleExportCSV,
    handleExportPDF,
    maxBookings,
  } = usePopularityData();

  return (
    <div className="container mx-auto p-6">
      <PopularityHeader
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
          <PopularityFilters reportData={reportData} />

          <PopularityChart
            employees={reportData.employees}
            maxBookings={maxBookings}
          />

          <PopularityTable reportData={reportData} />
        </>
      )}
    </div>
  );
}
