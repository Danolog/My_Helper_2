"use client";

import { RefreshCw } from "lucide-react";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { PayrollFilters } from "./_components/PayrollFilters";
import { PayrollHeader } from "./_components/PayrollHeader";
import { PayrollSummary } from "./_components/PayrollSummary";
import { PayrollTable } from "./_components/PayrollTable";
import { usePayrollData } from "./_hooks/use-payroll-data";

export default function EmployeePayrollReportPage() {
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
    expandedEmployee,
    toggleEmployeeExpand,
    fetchReport,
    handleExport,
    handleExportPDF,
  } = usePayrollData();

  return (
    <div className="container mx-auto p-6">
      <PayrollHeader
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

      <PayrollFilters
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
      {reportData && !loading && (
        <>
          <PayrollSummary reportData={reportData} />
          <PayrollTable
            reportData={reportData}
            expandedEmployee={expandedEmployee}
            onToggleExpand={toggleEmployeeExpand}
          />
        </>
      )}
    </div>
  );
}
