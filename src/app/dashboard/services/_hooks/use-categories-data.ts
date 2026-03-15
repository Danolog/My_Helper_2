"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import type { ServiceCategory } from "../_types";

export interface UseCategoriesDataReturn {
  // Dialog state
  categoryDialogOpen: boolean;
  setCategoryDialogOpen: (open: boolean) => void;
  categoryFormName: string;
  setCategoryFormName: (v: string) => void;
  savingCategory: boolean;
  editingCategory: ServiceCategory | null;

  // Delete dialog state
  deleteCategoryDialogOpen: boolean;
  setDeleteCategoryDialogOpen: (open: boolean) => void;
  categoryToDelete: ServiceCategory | null;
  setCategoryToDelete: (c: ServiceCategory | null) => void;
  deletingCategory: boolean;

  // Actions
  openCategoryDialog: (category?: ServiceCategory) => void;
  resetCategoryForm: () => void;
  handleSaveCategory: () => Promise<void>;
  handleDeleteCategory: () => Promise<void>;
}

/**
 * Hook for managing service category CRUD operations.
 *
 * Delegates data refetching to the parent via callback props so that
 * the services list stays in sync after category mutations.
 */
export function useCategoriesData(
  salonId: string | null,
  categories: ServiceCategory[],
  fetchCategories: () => Promise<void>,
  fetchServices: () => Promise<void>,
): UseCategoriesDataReturn {
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [categoryFormName, setCategoryFormName] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ServiceCategory | null>(null);

  const [deleteCategoryDialogOpen, setDeleteCategoryDialogOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<ServiceCategory | null>(null);
  const [deletingCategory, setDeletingCategory] = useState(false);

  const resetCategoryForm = useCallback(() => {
    setCategoryFormName("");
    setEditingCategory(null);
  }, []);

  const openCategoryDialog = useCallback((category?: ServiceCategory) => {
    if (category) {
      setEditingCategory(category);
      setCategoryFormName(category.name);
    } else {
      resetCategoryForm();
    }
    setCategoryDialogOpen(true);
  }, [resetCategoryForm]);

  const handleSaveCategory = useCallback(async () => {
    if (!categoryFormName.trim()) {
      toast.error("Wpisz nazwe kategorii, np. Fryzjerstwo lub Kosmetyka");
      return;
    }

    setSavingCategory(true);
    try {
      if (editingCategory) {
        // Update existing category
        const res = await mutationFetch(`/api/service-categories/${editingCategory.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: categoryFormName.trim() }),
        });
        const data = await res.json();

        if (data.success) {
          toast.success(`Kategoria zmieniona na "${categoryFormName.trim()}"`);
          resetCategoryForm();
          setCategoryDialogOpen(false);
          await Promise.all([fetchCategories(), fetchServices()]);
        } else {
          toast.error(data.error || "Nie udalo sie zaktualizowac kategorii");
        }
      } else {
        // Create new category
        const res = await mutationFetch("/api/service-categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            salonId: salonId!,
            name: categoryFormName.trim(),
            sortOrder: categories.length,
          }),
        });
        const data = await res.json();

        if (data.success) {
          toast.success(`Kategoria "${categoryFormName.trim()}" zostala dodana`);
          resetCategoryForm();
          setCategoryDialogOpen(false);
          await fetchCategories();
        } else {
          toast.error(data.error || "Nie udalo sie dodac kategorii");
        }
      }
    } catch {
      toast.error("Blad podczas zapisywania kategorii");
    } finally {
      setSavingCategory(false);
    }
  }, [
    categoryFormName,
    editingCategory,
    salonId,
    categories.length,
    resetCategoryForm,
    fetchCategories,
    fetchServices,
  ]);

  const handleDeleteCategory = useCallback(async () => {
    if (!categoryToDelete) return;
    setDeletingCategory(true);
    try {
      const res = await mutationFetch(`/api/service-categories/${categoryToDelete.id}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (data.success) {
        toast.success(`Kategoria "${categoryToDelete.name}" zostala usunieta`);
        await fetchCategories();
      } else {
        toast.error(data.error || "Nie mozna usunac kategorii");
      }
    } catch {
      toast.error("Blad podczas usuwania kategorii");
    } finally {
      setDeletingCategory(false);
      setDeleteCategoryDialogOpen(false);
      setCategoryToDelete(null);
    }
  }, [categoryToDelete, fetchCategories]);

  return {
    categoryDialogOpen,
    setCategoryDialogOpen,
    categoryFormName,
    setCategoryFormName,
    savingCategory,
    editingCategory,

    deleteCategoryDialogOpen,
    setDeleteCategoryDialogOpen,
    categoryToDelete,
    setCategoryToDelete,
    deletingCategory,

    openCategoryDialog,
    resetCategoryForm,
    handleSaveCategory,
    handleDeleteCategory,
  };
}
