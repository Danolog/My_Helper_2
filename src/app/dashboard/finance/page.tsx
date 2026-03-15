"use client";

import {
  DollarSign,
  CalendarDays,
  Settings,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FinanceDetails } from "./_components/finance-details";
import { FinanceHeader } from "./_components/finance-header";
import { FinanceOverview } from "./_components/finance-overview";
import { FinanceRateDialog } from "./_components/finance-rate-dialog";
import { FinanceSettings } from "./_components/finance-settings";
import { useFinanceData } from "./_hooks/use-finance-data";

export default function FinancePage() {
  const {
    session,
    isPending,
    data,
    loading,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    selectedEmployee,
    setSelectedEmployee,
    fetchCommissions,
    employeeRates,
    ratesLoading,
    editingRate,
    newRate,
    setNewRate,
    savingRate,
    handleSaveRate,
    openRateEditor,
    closeRateEditor,
  } = useFinanceData();

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-64">Loading...</div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto p-6 text-center">
        <p>Musisz byc zalogowany aby zobaczyc finanse.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <FinanceHeader />

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">
            <DollarSign className="h-4 w-4 mr-2" />
            Przeglad prowizji
          </TabsTrigger>
          <TabsTrigger value="details" data-testid="tab-details">
            <CalendarDays className="h-4 w-4 mr-2" />
            Szczegoly
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">
            <Settings className="h-4 w-4 mr-2" />
            Stawki prowizji
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <FinanceOverview
            data={data}
            loading={loading}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            onRefresh={fetchCommissions}
          />
        </TabsContent>

        <TabsContent value="details">
          <FinanceDetails
            data={data}
            loading={loading}
            dateFrom={dateFrom}
            dateTo={dateTo}
            selectedEmployee={selectedEmployee}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            onSelectedEmployeeChange={setSelectedEmployee}
            onFilter={fetchCommissions}
          />
        </TabsContent>

        <TabsContent value="settings">
          <FinanceSettings
            employeeRates={employeeRates}
            ratesLoading={ratesLoading}
            onEditRate={openRateEditor}
          />
        </TabsContent>
      </Tabs>

      <FinanceRateDialog
        editingRate={editingRate}
        newRate={newRate}
        savingRate={savingRate}
        onNewRateChange={setNewRate}
        onSave={handleSaveRate}
        onClose={closeRateEditor}
      />
    </div>
  );
}
