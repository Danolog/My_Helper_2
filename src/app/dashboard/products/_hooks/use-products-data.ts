"use client";

import { useState, useEffect, useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";
import { getNetworkErrorMessage } from "@/lib/fetch-with-retry";
import { useFormRecovery } from "@/hooks/use-form-recovery";
import { useTabSync } from "@/hooks/use-tab-sync";
import { mutationFetch } from "@/lib/api-client";
import type { Product, ProductCategory, LowStockNotification } from "../_types";

type ProductFormState = {
  name: string;
  category: string;
  quantity: string;
  minQuantity: string;
  unit: string;
  pricePerUnit: string;
}

export interface UseProductsDataReturn {
  // Data
  productsData: Product[];
  categories: ProductCategory[];
  lowStockNotifications: LowStockNotification[];
  filteredProducts: Product[];
  lowStockProducts: Product[];
  uniqueCategories: string[];
  categoryNames: string[];

  // Loading / error
  loading: boolean;
  categoriesLoading: boolean;
  fetchError: { message: string; isNetwork: boolean; isTimeout: boolean } | null;

  // Filter / sort state
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  categoryFilter: string;
  setCategoryFilter: (c: string) => void;
  sortBy: string;
  setSortBy: (s: string) => void;

  // Product dialog state
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  editingProduct: Product | null;
  saving: boolean;
  formName: string;
  setFormName: (v: string) => void;
  formCategory: string;
  setFormCategory: (v: string) => void;
  formQuantity: string;
  setFormQuantity: (v: string) => void;
  formMinQuantity: string;
  setFormMinQuantity: (v: string) => void;
  formUnit: string;
  setFormUnit: (v: string) => void;
  formPricePerUnit: string;
  setFormPricePerUnit: (v: string) => void;
  formErrors: Record<string, string>;
  setFormErrors: Dispatch<SetStateAction<Record<string, string>>>;
  clearFieldError: (field: string) => void;

  // Form recovery
  productWasRecovered: boolean;
  handleRestoreProductForm: () => void;
  clearProductSavedForm: () => void;

  // Delete dialog state
  deleteDialogOpen: boolean;
  setDeleteDialogOpen: (open: boolean) => void;
  productToDelete: Product | null;
  setProductToDelete: (p: Product | null) => void;

  // Actions
  openAddDialog: () => void;
  openEditDialog: (product: Product) => void;
  handleSave: () => Promise<void>;
  handleDelete: () => Promise<void>;
  retryFetch: () => Promise<void>;
  fetchProducts: (signal?: AbortSignal) => Promise<void>;
  fetchCategories: (signal?: AbortSignal) => Promise<void>;
}

export function useProductsData(salonId: string | null): UseProductsDataReturn {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // Data state
  const [productsData, setProductsData] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<{
    message: string;
    isNetwork: boolean;
    isTimeout: boolean;
  } | null>(null);

  // Filter / sort state (initialized from URL search params)
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const [categoryFilter, setCategoryFilter] = useState<string>(
    searchParams.get("category") || "all",
  );
  const [sortBy, setSortBy] = useState<string>(
    searchParams.get("sort") || "name-asc",
  );

  // Sync search/filter state to URL for persistence
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (categoryFilter && categoryFilter !== "all")
      params.set("category", categoryFilter);
    if (sortBy && sortBy !== "name-asc") params.set("sort", sortBy);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [searchQuery, categoryFilter, sortBy, router, pathname]);

  // Categories state
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("");
  const [formQuantity, setFormQuantity] = useState("");
  const [formMinQuantity, setFormMinQuantity] = useState("");
  const [formUnit, setFormUnit] = useState("");
  const [formPricePerUnit, setFormPricePerUnit] = useState("");

  // Form validation errors
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Form recovery for product creation dialog
  const {
    wasRecovered: productWasRecovered,
    getRecoveredState: getProductRecoveredState,
    saveFormState: saveProductFormState,
    clearSavedForm: clearProductSavedForm,
    setDirty: setProductDirty,
  } = useFormRecovery<ProductFormState>({
    storageKey: "add-product-form",
    warnOnUnload: true,
  });

  // Auto-open dialog when recovered data is found
  useEffect(() => {
    if (productWasRecovered) {
      setDialogOpen(true);
    }
  }, [productWasRecovered]);

  // Save product form state on changes (debounced inside hook)
  useEffect(() => {
    if (dialogOpen && !editingProduct) {
      const hasData =
        !!formName ||
        !!formCategory ||
        !!formQuantity ||
        !!formMinQuantity ||
        !!formPricePerUnit;
      if (hasData) {
        saveProductFormState({
          name: formName,
          category: formCategory,
          quantity: formQuantity,
          minQuantity: formMinQuantity,
          unit: formUnit,
          pricePerUnit: formPricePerUnit,
        });
      }
      setProductDirty(hasData);
    }
  }, [
    formName,
    formCategory,
    formQuantity,
    formMinQuantity,
    formUnit,
    formPricePerUnit,
    dialogOpen,
    editingProduct,
    saveProductFormState,
    setProductDirty,
  ]);

  // Recovery handler: restores product form fields from localStorage
  const handleRestoreProductForm = useCallback(() => {
    const saved = getProductRecoveredState();
    if (saved) {
      setFormName(saved.name || "");
      setFormCategory(saved.category || "");
      setFormQuantity(saved.quantity || "");
      setFormMinQuantity(saved.minQuantity || "");
      setFormUnit(saved.unit || "szt.");
      setFormPricePerUnit(saved.pricePerUnit || "");
    }
  }, [getProductRecoveredState]);

  // Delete dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);

  // Notification state
  const [lowStockNotifications, setLowStockNotifications] = useState<
    LowStockNotification[]
  >([]);

  // ─── Fetch callbacks ─────────────────────────────────────────

  const fetchProducts = useCallback(
    async (signal?: AbortSignal) => {
      if (!salonId) return;
      try {
        const res = await fetch(
          `/api/products?salonId=${salonId}`,
          signal ? { signal } : {},
        );
        const data = await res.json();
        if (data.success) {
          setProductsData(data.data);
          setFetchError(null);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        const errInfo = getNetworkErrorMessage(error);
        setFetchError(errInfo);
      } finally {
        setLoading(false);
      }
    },
    [salonId],
  );

  const fetchCategories = useCallback(
    async (signal?: AbortSignal) => {
      if (!salonId) return;
      try {
        setCategoriesLoading(true);
        const res = await fetch(
          `/api/product-categories?salonId=${salonId}`,
          signal ? { signal } : {},
        );
        const data = await res.json();
        if (data.success) {
          setCategories(data.data);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      } finally {
        setCategoriesLoading(false);
      }
    },
    [salonId],
  );

  const fetchLowStockNotifications = useCallback(
    async (signal?: AbortSignal) => {
      if (!salonId) return;
      try {
        const res = await fetch(
          `/api/notifications?salonId=${salonId}&type=system&limit=10`,
          signal ? { signal } : {},
        );
        const data = await res.json();
        if (data.success) {
          // Filter for low-stock notifications only
          const lowStockNotifs = data.data.notifications.filter(
            (n: { message: string }) =>
              n.message.includes("Niski stan magazynowy"),
          );
          setLowStockNotifications(lowStockNotifs);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    },
    [salonId],
  );

  // Initial data fetch
  useEffect(() => {
    const abortController = new AbortController();

    fetchProducts(abortController.signal);
    fetchCategories(abortController.signal);
    fetchLowStockNotifications(abortController.signal);

    return () => abortController.abort();
  }, [fetchProducts, fetchCategories, fetchLowStockNotifications]);

  // Cross-tab sync: refetch when another tab modifies products
  const { notifyChange: notifyProductsChanged } = useTabSync(
    "products",
    fetchProducts,
  );

  // ─── Derived data ────────────────────────────────────────────

  const categoryNames = useMemo(
    () => categories.map((c) => c.name),
    [categories],
  );

  const filteredProducts = useMemo(
    () =>
      productsData
        .filter((p) => {
          const trimmedQuery = searchQuery.trim().toLowerCase();
          const matchesSearch =
            !trimmedQuery ||
            p.name.toLowerCase().includes(trimmedQuery) ||
            (p.category && p.category.toLowerCase().includes(trimmedQuery));
          const matchesCategory =
            categoryFilter === "all" || p.category === categoryFilter;
          return matchesSearch && matchesCategory;
        })
        .sort((a, b) => {
          switch (sortBy) {
            case "name-asc":
              return a.name.localeCompare(b.name, "pl");
            case "name-desc":
              return b.name.localeCompare(a.name, "pl");
            case "quantity-asc":
              return (
                parseFloat(a.quantity || "0") - parseFloat(b.quantity || "0")
              );
            case "quantity-desc":
              return (
                parseFloat(b.quantity || "0") - parseFloat(a.quantity || "0")
              );
            case "category-asc":
              return (a.category || "").localeCompare(b.category || "", "pl");
            case "category-desc":
              return (b.category || "").localeCompare(a.category || "", "pl");
            case "price-asc":
              return (
                parseFloat(a.pricePerUnit || "0") -
                parseFloat(b.pricePerUnit || "0")
              );
            case "price-desc":
              return (
                parseFloat(b.pricePerUnit || "0") -
                parseFloat(a.pricePerUnit || "0")
              );
            default:
              return 0;
          }
        }),
    [productsData, searchQuery, categoryFilter, sortBy],
  );

  const uniqueCategories = useMemo(
    () =>
      Array.from(
        new Set(productsData.map((p) => p.category).filter(Boolean)),
      ) as string[],
    [productsData],
  );

  const lowStockProducts = useMemo(
    () =>
      productsData.filter((p) => {
        if (!p.minQuantity) return false;
        return parseFloat(p.quantity || "0") <= parseFloat(p.minQuantity);
      }),
    [productsData],
  );

  // ─── Form helpers ────────────────────────────────────────────

  const clearFieldError = useCallback((field: string) => {
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const validateProductForm = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    if (!formName.trim()) {
      errors.name = "Wpisz nazwe produktu, np. Szampon nawilzajacy";
    }
    if (formQuantity) {
      if (
        isNaN(Number(formQuantity)) ||
        isNaN(parseFloat(formQuantity))
      ) {
        errors.quantity = "Ilosc musi byc liczba calkowita, np. 10";
      } else if (parseFloat(formQuantity) < 0) {
        errors.quantity =
          "Ilosc nie moze byc ujemna. Wpisz wartosc 0 lub wieksza";
      }
    }
    if (formMinQuantity) {
      if (
        isNaN(Number(formMinQuantity)) ||
        isNaN(parseFloat(formMinQuantity))
      ) {
        errors.minQuantity = "Minimalny stan musi byc liczba, np. 5";
      } else if (parseFloat(formMinQuantity) < 0) {
        errors.minQuantity =
          "Minimalny stan nie moze byc ujemny. Wpisz wartosc 0 lub wieksza";
      }
    }
    if (formPricePerUnit) {
      if (
        isNaN(Number(formPricePerUnit)) ||
        isNaN(parseFloat(formPricePerUnit))
      ) {
        errors.pricePerUnit = "Cena jednostkowa musi byc liczba, np. 25.00";
      } else if (parseFloat(formPricePerUnit) < 0) {
        errors.pricePerUnit =
          "Cena jednostkowa nie moze byc ujemna. Wpisz wartosc 0 lub wieksza";
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formName, formQuantity, formMinQuantity, formPricePerUnit]);

  // ─── Dialog openers ──────────────────────────────────────────

  const openAddDialog = useCallback(() => {
    setEditingProduct(null);
    setFormName("");
    setFormCategory("");
    setFormQuantity("");
    setFormMinQuantity("");
    setFormUnit("szt.");
    setFormPricePerUnit("");
    setFormErrors({});
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((product: Product) => {
    setEditingProduct(product);
    setFormName(product.name);
    setFormCategory(product.category || "");
    setFormQuantity(product.quantity || "0");
    setFormMinQuantity(product.minQuantity || "");
    setFormUnit(product.unit || "szt.");
    setFormPricePerUnit(product.pricePerUnit || "");
    setFormErrors({});
    setDialogOpen(true);
  }, []);

  // ─── CRUD handlers ──────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!validateProductForm()) {
      toast.error("Popraw zaznaczone pola formularza");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        salonId: salonId!,
        name: formName.trim(),
        category: formCategory || null,
        quantity: parseFloat(formQuantity) || 0,
        minQuantity: formMinQuantity ? parseFloat(formMinQuantity) : null,
        unit: formUnit || null,
        pricePerUnit: formPricePerUnit ? parseFloat(formPricePerUnit) : null,
      };

      let res: Response;
      if (editingProduct) {
        res = await mutationFetch(`/api/products/${editingProduct.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await mutationFetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json();
      if (data.success) {
        toast.success(
          editingProduct
            ? `Produkt "${formName}" zaktualizowany`
            : `Produkt "${formName}" dodany`,
        );
        // Show low-stock alert toast if notification was sent
        if (data.lowStockAlert?.notificationSent) {
          toast.warning(
            `Niski stan magazynowy: "${formName}" - wyslano powiadomienie`,
            { duration: 6000 },
          );
        }
        setDialogOpen(false);
        clearProductSavedForm();
        fetchProducts();
        fetchCategories();
        fetchLowStockNotifications();
        notifyProductsChanged();
      } else {
        toast.error(data.error || "Nie udalo sie zapisac produktu");
      }
    } catch (error) {
      const errInfo = getNetworkErrorMessage(error);
      toast.error(
        errInfo.isNetwork
          ? errInfo.message
          : "Blad podczas zapisywania produktu",
        {
          action: {
            label: "Sprobuj ponownie",
            onClick: () => handleSave(),
          },
        },
      );
    } finally {
      setSaving(false);
    }
  }, [
    validateProductForm,
    salonId,
    formName,
    formCategory,
    formQuantity,
    formMinQuantity,
    formUnit,
    formPricePerUnit,
    editingProduct,
    clearProductSavedForm,
    fetchProducts,
    fetchCategories,
    fetchLowStockNotifications,
    notifyProductsChanged,
  ]);

  const handleDelete = useCallback(async () => {
    if (!productToDelete) return;

    try {
      const res = await mutationFetch(`/api/products/${productToDelete.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Produkt "${productToDelete.name}" usuniety`);
        fetchProducts();
        fetchCategories();
        notifyProductsChanged();
      } else {
        toast.error(data.error || "Nie udalo sie usunac produktu");
      }
    } catch {
      toast.error("Blad podczas usuwania produktu");
    } finally {
      setDeleteDialogOpen(false);
      setProductToDelete(null);
    }
  }, [
    productToDelete,
    fetchProducts,
    fetchCategories,
    notifyProductsChanged,
  ]);

  // Retry handler for NetworkErrorHandler
  const retryFetch = useCallback(async () => {
    setFetchError(null);
    setLoading(true);
    await fetchProducts();
  }, [fetchProducts]);

  return {
    productsData,
    categories,
    lowStockNotifications,
    filteredProducts,
    lowStockProducts,
    uniqueCategories,
    categoryNames,

    loading,
    categoriesLoading,
    fetchError,

    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    sortBy,
    setSortBy,

    dialogOpen,
    setDialogOpen,
    editingProduct,
    saving,
    formName,
    setFormName,
    formCategory,
    setFormCategory,
    formQuantity,
    setFormQuantity,
    formMinQuantity,
    setFormMinQuantity,
    formUnit,
    setFormUnit,
    formPricePerUnit,
    setFormPricePerUnit,
    formErrors,
    setFormErrors,
    clearFieldError,

    productWasRecovered,
    handleRestoreProductForm,
    clearProductSavedForm,

    deleteDialogOpen,
    setDeleteDialogOpen,
    productToDelete,
    setProductToDelete,

    openAddDialog,
    openEditDialog,
    handleSave,
    handleDelete,
    retryFetch,
    fetchProducts,
    fetchCategories,
  };
}
