"use client";

import { useSession } from "@/lib/auth-client";
import { Lock, Users } from "lucide-react";
import { useSalonId } from "@/hooks/use-salon-id";
import { useClientsData } from "./_hooks/use-clients-data";
import { ClientForm } from "./_components/ClientForm";
import { ClientFilters } from "./_components/ClientFilters";
import { ClientList } from "./_components/ClientList";

export default function ClientsPage() {
  const { data: session, isPending } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();

  const {
    clients,
    filteredClients,
    loading,
    fetchError,
    searchQuery,
    setSearchQuery,
    filtersOpen,
    setFiltersOpen,
    dateAddedFrom,
    setDateAddedFrom,
    dateAddedTo,
    setDateAddedTo,
    lastVisitFrom,
    setLastVisitFrom,
    lastVisitTo,
    setLastVisitTo,
    filterHasAllergies,
    setFilterHasAllergies,
    appliedFilters,
    hasActiveFilters,
    activeFilterCount,
    handleApplyFilters,
    handleClearFilters,
    dialogOpen,
    setDialogOpen,
    saving,
    formFirstName,
    setFormFirstName,
    formLastName,
    setFormLastName,
    formPhone,
    setFormPhone,
    formEmail,
    setFormEmail,
    formNotes,
    setFormNotes,
    formErrors,
    clearFieldError,
    clientWasRecovered,
    handleRestoreClientForm,
    clearClientSavedForm,
    resetForm,
    handleSaveClient,
    retryFetch,
  } = useClientsData(salonId);

  if (isPending || salonLoading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Wymagane logowanie</h1>
          <p className="text-muted-foreground mb-6">
            Musisz sie zalogowac, aby zarzadzac klientami
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Header with add client dialog */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <Users className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Klienci</h1>
            <p className="text-muted-foreground text-sm">
              Zarzadzaj baza klientow salonu
            </p>
          </div>
        </div>
        <ClientForm
          dialogOpen={dialogOpen}
          onOpenChange={setDialogOpen}
          saving={saving}
          formFirstName={formFirstName}
          onFirstNameChange={setFormFirstName}
          formLastName={formLastName}
          onLastNameChange={setFormLastName}
          formPhone={formPhone}
          onPhoneChange={setFormPhone}
          formEmail={formEmail}
          onEmailChange={setFormEmail}
          formNotes={formNotes}
          onNotesChange={setFormNotes}
          formErrors={formErrors}
          clearFieldError={clearFieldError}
          clientWasRecovered={clientWasRecovered}
          onRestore={handleRestoreClientForm}
          onDismissRecovery={clearClientSavedForm}
          onSave={handleSaveClient}
          onCancel={() => {
            resetForm();
            setDialogOpen(false);
          }}
        />
      </div>

      {/* Search, filters, and filter badges */}
      <ClientFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filtersOpen={filtersOpen}
        onFiltersOpenChange={setFiltersOpen}
        dateAddedFrom={dateAddedFrom}
        onDateAddedFromChange={setDateAddedFrom}
        dateAddedTo={dateAddedTo}
        onDateAddedToChange={setDateAddedTo}
        lastVisitFrom={lastVisitFrom}
        onLastVisitFromChange={setLastVisitFrom}
        lastVisitTo={lastVisitTo}
        onLastVisitToChange={setLastVisitTo}
        filterHasAllergies={filterHasAllergies}
        onFilterHasAllergiesChange={setFilterHasAllergies}
        appliedFilters={appliedFilters}
        hasActiveFilters={hasActiveFilters}
        activeFilterCount={activeFilterCount}
        onApplyFilters={handleApplyFilters}
        onClearFilters={handleClearFilters}
      />

      {/* Client list with loading, error, and empty states */}
      <ClientList
        clients={clients}
        filteredClients={filteredClients}
        loading={loading}
        fetchError={fetchError}
        hasActiveFilters={hasActiveFilters}
        searchQuery={searchQuery}
        onRetry={retryFetch}
        onAddClient={() => setDialogOpen(true)}
        onClearFilters={handleClearFilters}
      />
    </div>
  );
}
