"use client";

import { RefreshCw } from "lucide-react";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { useCancellationReport } from "./_hooks/use-cancellation-report";
import { ReportHeader } from "./_components/report-header";
import { ComparisonPeriodFilter } from "./_components/comparison-period-filter";
import { EmployeeFilterCard } from "./_components/employee-filter-card";
import { SummaryCards } from "./_components/summary-cards";
import { PeriodComparisonCard } from "./_components/period-comparison-card";
import { TabNavigation } from "./_components/tab-navigation";
import { LostRevenueTab } from "./_components/lost-revenue-tab";
import { ReasonTab } from "./_components/reason-tab";
import { EmployeeTab } from "./_components/employee-tab";
import { ServiceTab } from "./_components/service-tab";
import { DayOfWeekTab } from "./_components/day-of-week-tab";
import { TrendTab } from "./_components/trend-tab";

export default function CancellationReportPage() {
  const {
    reportData,
    loading,
    salonLoading,
    error,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    showComparison,
    setShowComparison,
    compareDateFrom,
    setCompareDateFrom,
    compareDateTo,
    setCompareDateTo,
    selectedEmployeeIds,
    setSelectedEmployeeIds,
    activeTab,
    setActiveTab,
    fetchReport,
    handleExportCSV,
    handleExportPDF,
  } = useCancellationReport();

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

      <ComparisonPeriodFilter
        showComparison={showComparison}
        onToggleComparison={() => setShowComparison(!showComparison)}
        compareDateFrom={compareDateFrom}
        onCompareDateFromChange={setCompareDateFrom}
        compareDateTo={compareDateTo}
        onCompareDateToChange={setCompareDateTo}
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
          <PeriodComparisonCard reportData={reportData} />
          <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

          {activeTab === "lostrevenue" && (
            <LostRevenueTab reportData={reportData} />
          )}
          {activeTab === "reason" && <ReasonTab reportData={reportData} />}
          {activeTab === "employee" && (
            <EmployeeTab reportData={reportData} />
          )}
          {activeTab === "service" && <ServiceTab reportData={reportData} />}
          {activeTab === "dayofweek" && (
            <DayOfWeekTab reportData={reportData} />
          )}
          {activeTab === "trend" && <TrendTab reportData={reportData} />}
        </>
      )}
    </div>
  );
}
