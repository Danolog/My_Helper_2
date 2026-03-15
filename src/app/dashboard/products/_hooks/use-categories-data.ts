"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import type { ProductCategory } from "../_types";

export interface UseCategoriesDataReturn {
  categoryDialogOpen: boolean;
  setCategoryDialogOpen: (open: boolean) => void;
  editingCategory: ProductCategory | null;
  categoryFormName: string;
  setCategoryFormName: (v: string) => void;
  savingCategory: boolean;
  categoryFormErrors: Record<string, string>;
  clearCategoryFieldError: (field: string) => void;
  deleteCategoryDialogOpen: boolean;
  setDeleteCategoryDialogOpen: (open: boolean) => void;
  categoryToDelete: ProductCategory | null;
  setCategoryToDelete: (c: ProductCategory | null) => void;

  openAddCategoryDialog: () => void;
  openEditCategoryDialog: (category: ProductCategory) => void;
  handleSaveCategory: () => Promise<void>;
  handleDeleteCategory: () => Promise<void>;
}

export function useCategoriesData(
  salonId: string | null,
  fetchCategories: (signal?: AbortSignal) => Promise<void>,
  fetchProducts: (signal?: AbortSignal) => Promise<void>,
): UseCategoriesDataReturn {
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] =
    useState<ProductCategory | null>(null);
  const [categoryFormName, setCategoryFormName] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryFormErrors, setCategoryFormErrors] = useState<
    Record<string, string>
  >({});
  const [deleteCategoryDialogOpen, setDeleteCategoryDialogOpen] =
    useState(false);
  const [categoryToDelete, setCategoryToDelete] =
    useState<ProductCategory | null>(null);

  const clearCategoryFieldError = useCallback((field: string) => {
    setCategoryFormErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const openAddCategoryDialog = useCallback(() => {
    setEditingCategory(null);
    setCategoryFormName("");
    setCategoryFormErrors({});
    setCategoryDialogOpen(true);
  }, []);

  const openEditCategoryDialog = useCallback((category: ProductCategory) => {
    setEditingCategory(category);
    setCategoryFormName(category.name);
    setCategoryFormErrors({});
    setCategoryDialogOpen(true);
  }, []);

  const handleSaveCategory = useCallback(async () => {
    const errors: Record<string, string> = {};
    if (!categoryFormName.trim()) {
      errors.categoryName =
        "Wpisz nazwe kategorii, np. Kosmetyki lub Narzedzia";
    }
    setCategoryFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Popraw zaznaczone pola formularza");
      return;
    }

    setSavingCategory(true);
    try {
      let res: Response;
      if (editingCategory) {
        res = await mutationFetch(
          `/api/product-categories/${editingCategory.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: categoryFormName.trim() }),
          },
        );
      } else {
        res = await mutationFetch("/api/product-categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            salonId: salonId!,
            name: categoryFormName.trim(),
          }),
        });
      }

      const data = await res.json();
      if (data.success) {
        toast.success(
          editingCategory
            ? `Kategoria zmieniona na "${categoryFormName.trim()}"`
            : `Kategoria "${categoryFormName.trim()}" dodana`,
        );
        setCategoryDialogOpen(false);
        fetchCategories();
        fetchProducts(); // Refresh products in case category was renamed
      } else {
        toast.error(data.error || "Nie udalo sie zapisac kategorii");
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
    fetchCategories,
    fetchProducts,
  ]);

  const handleDeleteCategory = useCallback(async () => {
    if (!categoryToDelete) return;

    try {
      const res = await mutationFetch(
        `/api/product-categories/${categoryToDelete.id}`,
        {
          method: "DELETE",
        },
      );
      const data = await res.json();
      if (data.success) {
        toast.success(`Kategoria "${categoryToDelete.name}" usunieta`);
        fetchCategories();
      } else {
        toast.error(data.error || "Nie udalo sie usunac kategorii");
      }
    } catch {
      toast.error("Blad podczas usuwania kategorii");
    } finally {
      setDeleteCategoryDialogOpen(false);
      setCategoryToDelete(null);
    }
  }, [categoryToDelete, fetchCategories]);

  return {
    categoryDialogOpen,
    setCategoryDialogOpen,
    editingCategory,
    categoryFormName,
    setCategoryFormName,
    savingCategory,
    categoryFormErrors,
    clearCategoryFieldError,
    deleteCategoryDialogOpen,
    setDeleteCategoryDialogOpen,
    categoryToDelete,
    setCategoryToDelete,

    openAddCategoryDialog,
    openEditCategoryDialog,
    handleSaveCategory,
    handleDeleteCategory,
  };
}
