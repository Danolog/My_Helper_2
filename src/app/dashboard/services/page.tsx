"use client";

import { Lock, Scissors, FolderOpen } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSalonId } from "@/hooks/use-salon-id";
import { useSession } from "@/lib/auth-client";
import { AddServiceDialog } from "./_components/add-service-dialog";
import { CategoriesTab } from "./_components/categories-tab";
import { CategoryDialog } from "./_components/category-dialog";
import { DeleteCategoryDialog } from "./_components/delete-category-dialog";
import { DeleteServiceDialog } from "./_components/delete-service-dialog";
import { ServicesTab } from "./_components/services-tab";
import { useCategoriesData } from "./_hooks/use-categories-data";
import { useServicesData } from "./_hooks/use-services-data";

export default function ServicesPage() {
  const { data: session, isPending } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();

  const servicesData = useServicesData(salonId);
  const categoriesActions = useCategoriesData(
    salonId,
    servicesData.categories,
    servicesData.fetchCategories,
    servicesData.fetchServices,
  );

  // ─── Loading / auth gates ────────────────────────────────────

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
            Musisz sie zalogowac, aby zarzadzac uslugami
          </p>
        </div>
      </div>
    );
  }

  // ─── Main layout ─────────────────────────────────────────────

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <Scissors className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Uslugi</h1>
            <p className="text-muted-foreground text-sm">
              Zarzadzaj oferta uslug salonu
            </p>
          </div>
        </div>
        <AddServiceDialog
          open={servicesData.dialogOpen}
          onOpenChange={servicesData.setDialogOpen}
          saving={servicesData.saving}
          categories={servicesData.categories}
          formName={servicesData.formName}
          onFormNameChange={servicesData.setFormName}
          formDescription={servicesData.formDescription}
          onFormDescriptionChange={servicesData.setFormDescription}
          formCategoryId={servicesData.formCategoryId}
          onFormCategoryIdChange={servicesData.setFormCategoryId}
          formPrice={servicesData.formPrice}
          onFormPriceChange={servicesData.setFormPrice}
          formDuration={servicesData.formDuration}
          onFormDurationChange={servicesData.setFormDuration}
          formErrors={servicesData.formErrors}
          setFormErrors={servicesData.setFormErrors}
          clearFieldError={servicesData.clearFieldError}
          serviceWasRecovered={servicesData.serviceWasRecovered}
          onRestore={servicesData.handleRestoreServiceForm}
          onDismissRecovery={servicesData.clearServiceSavedForm}
          onSave={servicesData.handleSaveService}
          onCancel={() => {
            servicesData.resetForm();
            servicesData.setDialogOpen(false);
          }}
        />
      </div>

      <Tabs defaultValue="services" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="services" data-testid="tab-services">
            <Scissors className="h-4 w-4 mr-2" />
            Uslugi ({servicesData.services.length})
          </TabsTrigger>
          <TabsTrigger value="categories" data-testid="tab-categories">
            <FolderOpen className="h-4 w-4 mr-2" />
            Kategorie ({servicesData.categories.length})
          </TabsTrigger>
        </TabsList>

        {/* Services Tab */}
        <TabsContent value="services">
          <ServicesTab
            services={servicesData.services}
            categories={servicesData.categories}
            groupedServices={servicesData.groupedServices}
            loading={servicesData.loading}
            fetchError={servicesData.fetchError}
            onRetry={servicesData.retryFetch}
            onOpenAddDialog={() => servicesData.setDialogOpen(true)}
            onAssignCategory={servicesData.handleAssignCategory}
            onDeleteService={(service) => {
              servicesData.setServiceToDelete(service);
              servicesData.setDeleteDialogOpen(true);
            }}
          />
        </TabsContent>

        {/* Categories Tab */}
        <TabsContent value="categories">
          <CategoriesTab
            categories={servicesData.categories}
            getServiceCountForCategory={servicesData.getServiceCountForCategory}
            onAddCategory={() => categoriesActions.openCategoryDialog()}
            onEditCategory={(category) => categoriesActions.openCategoryDialog(category)}
            onDeleteCategory={(category) => {
              categoriesActions.setCategoryToDelete(category);
              categoriesActions.setDeleteCategoryDialogOpen(true);
            }}
          />
        </TabsContent>
      </Tabs>

      {/* ─── Dialogs ──────────────────────────────────────────── */}

      <CategoryDialog
        open={categoriesActions.categoryDialogOpen}
        onOpenChange={(open) => {
          categoriesActions.setCategoryDialogOpen(open);
          if (!open) categoriesActions.resetCategoryForm();
        }}
        editingCategory={categoriesActions.editingCategory}
        savingCategory={categoriesActions.savingCategory}
        categoryFormName={categoriesActions.categoryFormName}
        onCategoryFormNameChange={categoriesActions.setCategoryFormName}
        onSave={categoriesActions.handleSaveCategory}
        onCancel={() => {
          categoriesActions.resetCategoryForm();
          categoriesActions.setCategoryDialogOpen(false);
        }}
      />

      <DeleteCategoryDialog
        open={categoriesActions.deleteCategoryDialogOpen}
        onOpenChange={(open) => {
          categoriesActions.setDeleteCategoryDialogOpen(open);
          if (!open) categoriesActions.setCategoryToDelete(null);
        }}
        category={categoriesActions.categoryToDelete}
        deletingCategory={categoriesActions.deletingCategory}
        serviceCount={
          categoriesActions.categoryToDelete
            ? servicesData.getServiceCountForCategory(categoriesActions.categoryToDelete.id)
            : 0
        }
        onConfirm={categoriesActions.handleDeleteCategory}
      />

      <DeleteServiceDialog
        open={servicesData.deleteDialogOpen}
        onOpenChange={(open) => {
          servicesData.setDeleteDialogOpen(open);
          if (!open) servicesData.setServiceToDelete(null);
        }}
        service={servicesData.serviceToDelete}
        deletingService={servicesData.deletingService}
        onConfirm={servicesData.handleDeleteService}
      />
    </div>
  );
}
