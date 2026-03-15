"use client";

import { InvoicesFilters } from "./_components/invoices-filters";
import { InvoicesHeader } from "./_components/invoices-header";
import { InvoicesTable } from "./_components/invoices-table";
import { useInvoicesData } from "./_hooks/use-invoices-data";

export default function InvoicesPage() {
  const {
    session,
    isPending,
    invoicesList,
    summary,
    loading,
    expandedId,
    dateFrom,
    dateTo,
    typeFilter,
    searchQuery,
    router,
    setDateFrom,
    setDateTo,
    setTypeFilter,
    setSearchQuery,
    fetchInvoices,
    toggleExpand,
    getPaymentMethodLabel,
  } = useInvoicesData();

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-64">Loading...</div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto p-6 text-center">
        <p>Musisz byc zalogowany aby zobaczyc faktury.</p>
      </div>
    );
  }

  const hasFilters =
    !!searchQuery.trim() || !!dateFrom || !!dateTo || (!!typeFilter && typeFilter !== "all");

  return (
    <div className="container mx-auto p-6">
      <InvoicesHeader />

      <InvoicesFilters
        dateFrom={dateFrom}
        dateTo={dateTo}
        typeFilter={typeFilter}
        searchQuery={searchQuery}
        summary={summary}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onTypeFilterChange={setTypeFilter}
        onSearchQueryChange={setSearchQuery}
        onRefresh={fetchInvoices}
      />

      <InvoicesTable
        invoicesList={invoicesList}
        loading={loading}
        expandedId={expandedId}
        hasFilters={hasFilters}
        onToggleExpand={toggleExpand}
        onNavigateToInvoice={(id) => router.push(`/dashboard/invoices/${id}`)}
        getPaymentMethodLabel={getPaymentMethodLabel}
      />
    </div>
  );
}
