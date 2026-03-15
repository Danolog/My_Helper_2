"use client";

import dynamic from "next/dynamic";
import { Lock } from "lucide-react";
import { PromoCodesFilters } from "./_components/PromoCodesFilters";
import { PromoCodesHeader } from "./_components/PromoCodesHeader";
import { PromoCodesTable } from "./_components/PromoCodesTable";
import { usePromoCodesData } from "./_hooks/use-promo-codes-data";

const PromoCodeDialog = dynamic(
  () => import("./_components/PromoCodeDialog").then((m) => m.PromoCodeDialog),
);
const DeletePromoCodeDialog = dynamic(
  () => import("./_components/PromoCodeDialog").then((m) => m.DeletePromoCodeDialog),
);

export default function PromoCodesPage() {
  const {
    session,
    isPending,
    codesList,
    promotionsList,
    loading,
    dialogOpen,
    setDialogOpen,
    editingCode,
    formCode,
    setFormCode,
    formAutoGenerate,
    setFormAutoGenerate,
    formPromotionId,
    setFormPromotionId,
    formUsageLimit,
    setFormUsageLimit,
    formExpiresAt,
    setFormExpiresAt,
    saving,
    deleteTarget,
    setDeleteTarget,
    deleting,
    openCreateDialog,
    openEditDialog,
    handleSave,
    handleDelete,
    copyToClipboard,
  } = usePromoCodesData();

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-screen">
        Loading...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <div className="mb-8">
            <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h1 className="text-2xl font-bold mb-2">Wymagane logowanie</h1>
            <p className="text-muted-foreground mb-6">
              Zaloguj sie, aby zarzadzac kodami promocyjnymi
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <PromoCodesHeader onCreateClick={openCreateDialog} />

      <PromoCodesFilters codesList={codesList} />

      <PromoCodesTable
        codesList={codesList}
        loading={loading}
        onCreateClick={openCreateDialog}
        onEditClick={openEditDialog}
        onDeleteClick={setDeleteTarget}
        onCopyClick={copyToClipboard}
      />

      <PromoCodeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingCode={editingCode}
        formCode={formCode}
        onFormCodeChange={setFormCode}
        formAutoGenerate={formAutoGenerate}
        onFormAutoGenerateChange={setFormAutoGenerate}
        formPromotionId={formPromotionId}
        onFormPromotionIdChange={setFormPromotionId}
        formUsageLimit={formUsageLimit}
        onFormUsageLimitChange={setFormUsageLimit}
        formExpiresAt={formExpiresAt}
        onFormExpiresAtChange={setFormExpiresAt}
        promotionsList={promotionsList}
        saving={saving}
        onSave={handleSave}
      />

      <DeletePromoCodeDialog
        deleteTarget={deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        deleting={deleting}
        onDelete={handleDelete}
      />
    </div>
  );
}
