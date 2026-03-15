"use client";

import Link from "next/link";
import { Lock, Plus, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePromotionsData } from "./_hooks/use-promotions-data";
import { usePromotionForm } from "./_hooks/use-promotion-form";
import { PromotionSummaryCards } from "./_components/promotion-summary-cards";
import { PromotionList } from "./_components/promotion-list";
import dynamic from "next/dynamic";

const PromotionDialog = dynamic(() => import("./_components/promotion-dialog").then((m) => m.PromotionDialog));
const DeletePromotionDialog = dynamic(() => import("./_components/delete-promotion-dialog").then((m) => m.DeletePromotionDialog));

export default function PromotionsPage() {
  const {
    session,
    isPending,
    salonId,
    promotionsList,
    servicesList,
    loading,
    deleteTarget,
    deleting,
    setDeleteTarget,
    fetchPromotions,
    handleDelete,
    handleToggleActive,
    notifyPromotionsChanged,
  } = usePromotionsData();

  const form = usePromotionForm();

  const handleSaveAndRefresh = () => {
    form.handleSave(salonId, () => {
      fetchPromotions();
      notifyPromotionsChanged();
    });
  };

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-screen">Loading...</div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Wymagane logowanie</h1>
          <p className="text-muted-foreground">
            Zaloguj sie, aby zarzadzac promocjami
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Promocje</h1>
          <p className="text-muted-foreground mt-1">
            Zarzadzaj promocjami i rabatami salonu
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/promo-codes">
              <Ticket className="w-4 h-4 mr-2" />
              Kody promocyjne
            </Link>
          </Button>
          <Button onClick={form.openCreateDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Nowa promocja
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <PromotionSummaryCards promotionsList={promotionsList} />

      {/* Promotions list */}
      <PromotionList
        promotionsList={promotionsList}
        servicesList={servicesList}
        loading={loading}
        onCreateNew={form.openCreateDialog}
        onEdit={form.openEditDialog}
        onDelete={setDeleteTarget}
        onToggleActive={handleToggleActive}
      />

      {/* Create/Edit Dialog */}
      <PromotionDialog
        open={form.dialogOpen}
        onOpenChange={form.setDialogOpen}
        editingPromotion={form.editingPromotion}
        formName={form.formName}
        formType={form.formType}
        formValue={form.formValue}
        formStartDate={form.formStartDate}
        formEndDate={form.formEndDate}
        formIsActive={form.formIsActive}
        formSelectedServiceIds={form.formSelectedServiceIds}
        formHappyHoursStart={form.formHappyHoursStart}
        formHappyHoursEnd={form.formHappyHoursEnd}
        formHappyHoursDays={form.formHappyHoursDays}
        formValueError={form.formValueError}
        saving={form.saving}
        promoWasRecovered={form.promoWasRecovered}
        servicesList={servicesList}
        onNameChange={form.setFormName}
        onTypeChange={form.handleTypeChange}
        onValueChange={form.handleValueChange}
        onStartDateChange={form.setFormStartDate}
        onEndDateChange={form.setFormEndDate}
        onIsActiveChange={form.setFormIsActive}
        onToggleHappyHoursDay={form.toggleHappyHoursDay}
        onToggleServiceSelection={form.toggleServiceSelection}
        onHappyHoursStartChange={form.setFormHappyHoursStart}
        onHappyHoursEndChange={form.setFormHappyHoursEnd}
        onSave={handleSaveAndRefresh}
        onRestoreForm={form.handleRestorePromoForm}
        onDismissRecovery={form.clearPromoSavedForm}
      />

      {/* Delete confirmation dialog */}
      <DeletePromotionDialog
        deleteTarget={deleteTarget}
        deleting={deleting}
        onOpenChange={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
