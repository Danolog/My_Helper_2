"use client";

import { RefreshCw } from "lucide-react";
import { useYearlyComparisonData } from "./_hooks/use-yearly-comparison-data";
import { YearlyComparisonHeader } from "./_components/YearlyComparisonHeader";
import { YearlyComparisonFilters } from "./_components/YearlyComparisonFilters";
import { YearlyComparisonChart } from "./_components/YearlyComparisonChart";
import { YearlyComparisonTable } from "./_components/YearlyComparisonTable";

export default function YearlyComparisonPage() {
  const {
    comparisonData,
    loading,
    salonLoading,
    error,
    year1,
    setYear1,
    year2,
    setYear2,
    fetchComparison,
    handleExportPDF,
  } = useYearlyComparisonData();

  return (
    <div className="container mx-auto p-6">
      <YearlyComparisonHeader
        comparisonData={comparisonData}
        onExportPDF={handleExportPDF}
      />

      <YearlyComparisonFilters
        year1={year1}
        year2={year2}
        onYear1Change={setYear1}
        onYear2Change={setYear2}
        onGenerate={fetchComparison}
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
            Generowanie porownania rocznego...
          </span>
        </div>
      )}

      {/* Comparison content */}
      {comparisonData && !loading && !salonLoading && (
        <>
          <YearlyComparisonChart comparisonData={comparisonData} />
          <YearlyComparisonTable comparisonData={comparisonData} />
        </>
      )}
    </div>
  );
}
