"use client";

import { RefreshCw } from "lucide-react";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { useRevenueData } from "./_hooks/use-revenue-data";
import { ReportHeader } from "./_components/report-header";
import { EmployeeFilterCard } from "./_components/employee-filter-card";
import { SummaryCards } from "./_components/summary-cards";
import { TabNavigation } from "./_components/tab-navigation";
import dynamic from "next/dynamic";

const ServiceBreakdownTab = dynamic(
  () => import("./_components/service-breakdown-tab").then((m) => m.ServiceBreakdownTab),
);
const EmployeeBreakdownTab = dynamic(
  () => import("./_components/employee-breakdown-tab").then((m) => m.EmployeeBreakdownTab),
);
const TrendTab = dynamic(
  () => import("./_components/trend-tab").then((m) => m.TrendTab),
);

export default function RevenueReportPage() {
  const {
    reportData,
    loading,
    salonLoading,
    error,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    selectedEmployeeIds,
    setSelectedEmployeeIds,
    activeTab,
    setActiveTab,
    fetchReport,
    handleExport,
    handleExportPDF,
  } = useRevenueData();

  return (
    <div className="container mx-auto p-6">
      <ReportHeader
        reportData={reportData}
        onExportPDF={handleExportPDF}
        onExportExcel={() => handleExport("xlsx")}
        onExportCSV={() => handleExport("csv")}
      />

      <DateRangeFilter
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onApply={fetchReport}
        loading={loading}
      />

      <EmployeeFilterCard
        selectedEmployeeIds={selectedEmployeeIds}
        onSelectionChange={setSelectedEmployeeIds}
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
          <SummaryCards reportData={reportData} />
          <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

          {activeTab === "service" && (
            <ServiceBreakdownTab reportData={reportData} />
          )}
          {activeTab === "employee" && (
            <EmployeeBreakdownTab reportData={reportData} />
          )}
          {activeTab === "trend" && (
            <TrendTab reportData={reportData} />
          )}
        </>
      )}
    </div>
  );
}
