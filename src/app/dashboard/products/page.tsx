"use client";

import { useState } from "react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Lock, Plus, Package, Tag } from "lucide-react";
import { NetworkErrorHandler } from "@/components/network-error-handler";
import { useSalonId } from "@/hooks/use-salon-id";

import { useProductsData } from "./_hooks/use-products-data";
import { useCategoriesData } from "./_hooks/use-categories-data";
import { ProductFilters } from "./_components/product-filters";
import { ProductStats } from "./_components/product-stats";
import { LowStockWarning } from "./_components/low-stock-warning";
import { LowStockNotifications } from "./_components/low-stock-notifications";
import { ProductList } from "./_components/product-list";
import dynamic from "next/dynamic";

const ProductDialog = dynamic(() => import("./_components/product-dialog").then((m) => m.ProductDialog));
const DeleteProductDialog = dynamic(() => import("./_components/delete-product-dialog").then((m) => m.DeleteProductDialog));
const CategoriesTab = dynamic(() => import("./_components/categories-tab").then((m) => m.CategoriesTab));
const CategoryDialog = dynamic(() => import("./_components/category-dialog").then((m) => m.CategoryDialog));
const DeleteCategoryDialog = dynamic(() => import("./_components/delete-category-dialog").then((m) => m.DeleteCategoryDialog));

export default function ProductsPage() {
  const { data: session, isPending } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();
  const [activeTab, setActiveTab] = useState("products");

  const products = useProductsData(salonId);
  const categoriesActions = useCategoriesData(
    salonId,
    products.fetchCategories,
    products.fetchProducts,
  );

  // ─── Loading / auth gates ────────────────────────────────────

  if (isPending || salonLoading || products.loading) {
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
            Musisz sie zalogowac, aby zarzadzac magazynem
          </p>
        </div>
      </div>
    );
  }

  // ─── Main layout ─────────────────────────────────────────────

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Package className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="products-title">
              Magazyn produktow
            </h1>
            <p className="text-muted-foreground text-sm">
              Zarzadzaj produktami i stanem magazynowym
            </p>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="products" data-testid="products-tab">
            <Package className="h-4 w-4 mr-2" />
            Produkty
          </TabsTrigger>
          <TabsTrigger value="categories" data-testid="categories-tab">
            <Tag className="h-4 w-4 mr-2" />
            Kategorie
          </TabsTrigger>
        </TabsList>

        {/* ==================== PRODUCTS TAB ==================== */}
        <TabsContent value="products">
          {products.fetchError ? (
            <NetworkErrorHandler
              message={products.fetchError.message}
              isNetworkError={products.fetchError.isNetwork}
              isTimeout={products.fetchError.isTimeout}
              onRetry={products.retryFetch}
            />
          ) : (
            <>
              <div className="flex items-center justify-end mb-4">
                <Button
                  onClick={products.openAddDialog}
                  data-testid="add-product-btn"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Dodaj produkt
                </Button>
              </div>

              <LowStockWarning
                lowStockProducts={products.lowStockProducts}
              />

              <ProductFilters
                searchQuery={products.searchQuery}
                onSearchChange={products.setSearchQuery}
                categoryFilter={products.categoryFilter}
                onCategoryFilterChange={products.setCategoryFilter}
                sortBy={products.sortBy}
                onSortChange={products.setSortBy}
                uniqueCategories={products.uniqueCategories}
              />

              <ProductStats
                productsData={products.productsData}
                categories={products.categories}
                lowStockProducts={products.lowStockProducts}
              />

              <LowStockNotifications
                notifications={products.lowStockNotifications}
              />

              <ProductList
                filteredProducts={products.filteredProducts}
                totalCount={products.productsData.length}
                onEdit={products.openEditDialog}
                onDelete={(product) => {
                  products.setProductToDelete(product);
                  products.setDeleteDialogOpen(true);
                }}
              />
            </>
          )}
        </TabsContent>

        {/* ==================== CATEGORIES TAB ==================== */}
        <TabsContent value="categories">
          <CategoriesTab
            categories={products.categories}
            categoriesLoading={products.categoriesLoading}
            onAddCategory={categoriesActions.openAddCategoryDialog}
            onEditCategory={categoriesActions.openEditCategoryDialog}
            onDeleteCategory={(category) => {
              categoriesActions.setCategoryToDelete(category);
              categoriesActions.setDeleteCategoryDialogOpen(true);
            }}
          />
        </TabsContent>
      </Tabs>

      {/* ─── Dialogs ──────────────────────────────────────────── */}

      <ProductDialog
        open={products.dialogOpen}
        onOpenChange={products.setDialogOpen}
        editingProduct={products.editingProduct}
        saving={products.saving}
        formName={products.formName}
        onFormNameChange={products.setFormName}
        formCategory={products.formCategory}
        onFormCategoryChange={products.setFormCategory}
        formQuantity={products.formQuantity}
        onFormQuantityChange={products.setFormQuantity}
        formMinQuantity={products.formMinQuantity}
        onFormMinQuantityChange={products.setFormMinQuantity}
        formUnit={products.formUnit}
        onFormUnitChange={products.setFormUnit}
        formPricePerUnit={products.formPricePerUnit}
        onFormPricePerUnitChange={products.setFormPricePerUnit}
        formErrors={products.formErrors}
        setFormErrors={products.setFormErrors}
        clearFieldError={products.clearFieldError}
        categoryNames={products.categoryNames}
        productWasRecovered={products.productWasRecovered}
        onRestore={products.handleRestoreProductForm}
        onDismissRecovery={products.clearProductSavedForm}
        onSave={products.handleSave}
      />

      <DeleteProductDialog
        open={products.deleteDialogOpen}
        onOpenChange={products.setDeleteDialogOpen}
        product={products.productToDelete}
        onConfirm={products.handleDelete}
      />

      <CategoryDialog
        open={categoriesActions.categoryDialogOpen}
        onOpenChange={categoriesActions.setCategoryDialogOpen}
        editingCategory={categoriesActions.editingCategory}
        savingCategory={categoriesActions.savingCategory}
        categoryFormName={categoriesActions.categoryFormName}
        onCategoryFormNameChange={categoriesActions.setCategoryFormName}
        categoryFormErrors={categoriesActions.categoryFormErrors}
        clearCategoryFieldError={categoriesActions.clearCategoryFieldError}
        onSave={categoriesActions.handleSaveCategory}
      />

      <DeleteCategoryDialog
        open={categoriesActions.deleteCategoryDialogOpen}
        onOpenChange={categoriesActions.setDeleteCategoryDialogOpen}
        category={categoriesActions.categoryToDelete}
        onConfirm={categoriesActions.handleDeleteCategory}
      />
    </div>
  );
}
