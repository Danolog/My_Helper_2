"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Lock,
  Plus,
  Package,
  Edit,
  Trash2,
  AlertTriangle,
  Search,
  ArrowUpDown,
  Bell,
  History,
  Tag,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";
import { NetworkErrorHandler } from "@/components/network-error-handler";
import { getNetworkErrorMessage } from "@/lib/fetch-with-retry";
import { useFormRecovery } from "@/hooks/use-form-recovery";
import { FormRecoveryBanner } from "@/components/form-recovery-banner";
import { useTabSync } from "@/hooks/use-tab-sync";
import { useSalonId } from "@/hooks/use-salon-id";
import { EmptyState } from "@/components/ui/empty-state";
import { mutationFetch } from "@/lib/api-client";

interface Product {
  id: string;
  salonId: string;
  name: string;
  category: string | null;
  quantity: string | null;
  minQuantity: string | null;
  unit: string | null;
  pricePerUnit: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProductCategory {
  id: string;
  salonId: string;
  name: string;
  sortOrder: number | null;
  createdAt: string;
  productCount: number;
}

const NO_CATEGORY = "__none__";

const UNITS = ["ml", "g", "szt.", "opak.", "l", "kg"];

export default function ProductsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { data: session, isPending } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();
  const [productsData, setProductsData] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const [categoryFilter, setCategoryFilter] = useState<string>(searchParams.get("category") || "all");
  const [sortBy, setSortBy] = useState<string>(searchParams.get("sort") || "name-asc");
  const [activeTab, setActiveTab] = useState("products");

  // Sync search/filter state to URL for persistence
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("q", searchQuery.trim());
    if (categoryFilter && categoryFilter !== "all") params.set("category", categoryFilter);
    if (sortBy && sortBy !== "name-asc") params.set("sort", sortBy);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [searchQuery, categoryFilter, sortBy, router, pathname]);

  // Categories state
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const [categoryFormName, setCategoryFormName] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryFormErrors, setCategoryFormErrors] = useState<Record<string, string>>({});
  const [deleteCategoryDialogOpen, setDeleteCategoryDialogOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<ProductCategory | null>(null);

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
  } = useFormRecovery<{
    name: string;
    category: string;
    quantity: string;
    minQuantity: string;
    unit: string;
    pricePerUnit: string;
  }>({
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
      const hasData = !!formName || !!formCategory || !!formQuantity || !!formMinQuantity || !!formPricePerUnit;
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
  }, [formName, formCategory, formQuantity, formMinQuantity, formUnit, formPricePerUnit, dialogOpen, editingProduct, saveProductFormState, setProductDirty]);

  // Recovery handler: restores product form fields from localStorage
  const handleRestoreProductForm = () => {
    const saved = getProductRecoveredState();
    if (saved) {
      setFormName(saved.name || "");
      setFormCategory(saved.category || "");
      setFormQuantity(saved.quantity || "");
      setFormMinQuantity(saved.minQuantity || "");
      setFormUnit(saved.unit || "szt.");
      setFormPricePerUnit(saved.pricePerUnit || "");
    }
  };

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);

  // Notification state
  interface LowStockNotification {
    id: string;
    message: string;
    sentAt: string;
    createdAt: string;
  }
  const [lowStockNotifications, setLowStockNotifications] = useState<LowStockNotification[]>([]);
  const [fetchError, setFetchError] = useState<{ message: string; isNetwork: boolean; isTimeout: boolean } | null>(null);

  const fetchProducts = useCallback(async (signal?: AbortSignal) => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/products?salonId=${salonId}`, signal ? { signal } : {});
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
  }, [salonId]);

  const fetchCategories = useCallback(async (signal?: AbortSignal) => {
    if (!salonId) return;
    try {
      setCategoriesLoading(true);
      const res = await fetch(`/api/product-categories?salonId=${salonId}`, signal ? { signal } : {});
      const data = await res.json();
      if (data.success) {
        setCategories(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    } finally {
      setCategoriesLoading(false);
    }
  }, [salonId]);

  const fetchLowStockNotifications = useCallback(async (signal?: AbortSignal) => {
    if (!salonId) return;
    try {
      const res = await fetch(
        `/api/notifications?salonId=${salonId}&type=system&limit=10`,
        signal ? { signal } : {}
      );
      const data = await res.json();
      if (data.success) {
        // Filter for low-stock notifications only
        const lowStockNotifs = data.data.notifications.filter(
          (n: { message: string }) => n.message.includes("Niski stan magazynowy")
        );
        setLowStockNotifications(lowStockNotifs);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [salonId]);

  useEffect(() => {
    const abortController = new AbortController();

    fetchProducts(abortController.signal);
    fetchCategories(abortController.signal);
    fetchLowStockNotifications(abortController.signal);

    return () => abortController.abort();
  }, [fetchProducts, fetchCategories, fetchLowStockNotifications]);

  // Cross-tab sync: refetch when another tab modifies products
  const { notifyChange: notifyProductsChanged } = useTabSync("products", fetchProducts);

  // Category names from DB for product category select
  const categoryNames = categories.map((c) => c.name);

  const clearFieldError = (field: string) => {
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validateProductForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!formName.trim()) {
      errors.name = "Wpisz nazwe produktu, np. Szampon nawilzajacy";
    }
    if (formQuantity) {
      if (isNaN(Number(formQuantity)) || isNaN(parseFloat(formQuantity))) {
        errors.quantity = "Ilosc musi byc liczba calkowita, np. 10";
      } else if (parseFloat(formQuantity) < 0) {
        errors.quantity = "Ilosc nie moze byc ujemna. Wpisz wartosc 0 lub wieksza";
      }
    }
    if (formMinQuantity) {
      if (isNaN(Number(formMinQuantity)) || isNaN(parseFloat(formMinQuantity))) {
        errors.minQuantity = "Minimalny stan musi byc liczba, np. 5";
      } else if (parseFloat(formMinQuantity) < 0) {
        errors.minQuantity = "Minimalny stan nie moze byc ujemny. Wpisz wartosc 0 lub wieksza";
      }
    }
    if (formPricePerUnit) {
      if (isNaN(Number(formPricePerUnit)) || isNaN(parseFloat(formPricePerUnit))) {
        errors.pricePerUnit = "Cena jednostkowa musi byc liczba, np. 25.00";
      } else if (parseFloat(formPricePerUnit) < 0) {
        errors.pricePerUnit = "Cena jednostkowa nie moze byc ujemna. Wpisz wartosc 0 lub wieksza";
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const openAddDialog = () => {
    setEditingProduct(null);
    setFormName("");
    setFormCategory("");
    setFormQuantity("");
    setFormMinQuantity("");
    setFormUnit("szt.");
    setFormPricePerUnit("");
    setFormErrors({});
    setDialogOpen(true);
  };

  const openEditDialog = (product: Product) => {
    setEditingProduct(product);
    setFormName(product.name);
    setFormCategory(product.category || "");
    setFormQuantity(product.quantity || "0");
    setFormMinQuantity(product.minQuantity || "");
    setFormUnit(product.unit || "szt.");
    setFormPricePerUnit(product.pricePerUnit || "");
    setFormErrors({});
    setDialogOpen(true);
  };

  const handleSave = async () => {
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
            : `Produkt "${formName}" dodany`
        );
        // Show low-stock alert toast if notification was sent
        if (data.lowStockAlert?.notificationSent) {
          toast.warning(
            `Niski stan magazynowy: "${formName}" - wyslano powiadomienie`,
            { duration: 6000 }
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
      toast.error(errInfo.isNetwork
        ? errInfo.message
        : "Blad podczas zapisywania produktu", {
        action: {
          label: "Sprobuj ponownie",
          onClick: () => handleSave(),
        },
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
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
  };

  // Category CRUD handlers
  const clearCategoryFieldError = (field: string) => {
    setCategoryFormErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const openAddCategoryDialog = () => {
    setEditingCategory(null);
    setCategoryFormName("");
    setCategoryFormErrors({});
    setCategoryDialogOpen(true);
  };

  const openEditCategoryDialog = (category: ProductCategory) => {
    setEditingCategory(category);
    setCategoryFormName(category.name);
    setCategoryFormErrors({});
    setCategoryDialogOpen(true);
  };

  const handleSaveCategory = async () => {
    const errors: Record<string, string> = {};
    if (!categoryFormName.trim()) {
      errors.categoryName = "Wpisz nazwe kategorii, np. Kosmetyki lub Narzedzia";
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
        res = await mutationFetch(`/api/product-categories/${editingCategory.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: categoryFormName.trim() }),
        });
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
            : `Kategoria "${categoryFormName.trim()}" dodana`
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
  };

  const handleDeleteCategory = async () => {
    if (!categoryToDelete) return;

    try {
      const res = await mutationFetch(`/api/product-categories/${categoryToDelete.id}`, {
        method: "DELETE",
      });
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
  };

  // Filter and sort products
  const filteredProducts = productsData
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
          return parseFloat(a.quantity || "0") - parseFloat(b.quantity || "0");
        case "quantity-desc":
          return parseFloat(b.quantity || "0") - parseFloat(a.quantity || "0");
        case "category-asc":
          return (a.category || "").localeCompare(b.category || "", "pl");
        case "category-desc":
          return (b.category || "").localeCompare(a.category || "", "pl");
        case "price-asc":
          return parseFloat(a.pricePerUnit || "0") - parseFloat(b.pricePerUnit || "0");
        case "price-desc":
          return parseFloat(b.pricePerUnit || "0") - parseFloat(a.pricePerUnit || "0");
        default:
          return 0;
      }
    });

  // Get unique categories from data for the filter dropdown
  const uniqueCategories = Array.from(
    new Set(productsData.map((p) => p.category).filter(Boolean))
  ) as string[];

  // Low stock products
  const lowStockProducts = productsData.filter((p) => {
    if (!p.minQuantity) return false;
    return parseFloat(p.quantity || "0") <= parseFloat(p.minQuantity);
  });

  if (isPending || salonLoading || loading) {
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
          {fetchError ? (
            <NetworkErrorHandler
              message={fetchError.message}
              isNetworkError={fetchError.isNetwork}
              isTimeout={fetchError.isTimeout}
              onRetry={async () => {
                setFetchError(null);
                setLoading(true);
                await fetchProducts();
              }}
            />
          ) : (<>
          <div className="flex items-center justify-end mb-4">
            <Button onClick={openAddDialog} data-testid="add-product-btn">
              <Plus className="h-4 w-4 mr-2" />
              Dodaj produkt
            </Button>
          </div>

          {/* Low stock warning */}
          {lowStockProducts.length > 0 && (
            <div
              className="flex items-start gap-3 p-4 mb-6 rounded-lg border border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30"
              data-testid="low-stock-warning"
            >
              <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-orange-800 dark:text-orange-300">
                  Niski stan magazynowy ({lowStockProducts.length})
                </p>
                <p className="text-sm text-orange-700 dark:text-orange-400 mt-1">
                  {lowStockProducts.map((p) => p.name).join(", ")}
                </p>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex gap-3 mb-6">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Szukaj produktu..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                maxLength={200}
                data-testid="product-search"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-48" data-testid="category-filter">
                <SelectValue placeholder="Kategoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Wszystkie kategorie</SelectItem>
                {uniqueCategories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-52" data-testid="sort-select">
                <ArrowUpDown className="h-4 w-4 mr-2 shrink-0" />
                <SelectValue placeholder="Sortuj" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name-asc">Nazwa A-Z</SelectItem>
                <SelectItem value="name-desc">Nazwa Z-A</SelectItem>
                <SelectItem value="quantity-asc">Ilosc rosnaco</SelectItem>
                <SelectItem value="quantity-desc">Ilosc malejaco</SelectItem>
                <SelectItem value="category-asc">Kategoria A-Z</SelectItem>
                <SelectItem value="category-desc">Kategoria Z-A</SelectItem>
                <SelectItem value="price-asc">Cena rosnaco</SelectItem>
                <SelectItem value="price-desc">Cena malejaco</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-2xl font-bold" data-testid="total-products-count">
                    {productsData.length}
                  </p>
                  <p className="text-sm text-muted-foreground">Produktow lacznie</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-2xl font-bold">{categories.length}</p>
                  <p className="text-sm text-muted-foreground">Kategorii</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-2xl font-bold text-orange-600" data-testid="low-stock-count">
                    {lowStockProducts.length}
                  </p>
                  <p className="text-sm text-muted-foreground">Niski stan</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent low-stock notifications */}
          {lowStockNotifications.length > 0 && (
            <Card className="mb-6" data-testid="low-stock-notifications">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Bell className="h-4 w-4 text-orange-500" />
                  Ostatnie powiadomienia o niskim stanie
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {lowStockNotifications.slice(0, 5).map((notif) => (
                    <div
                      key={notif.id}
                      className="flex items-start gap-2 text-sm p-2 rounded-md bg-muted/50"
                      data-testid={`notification-${notif.id}`}
                    >
                      <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{notif.message.replace(/\[product:[^\]]+\]/, "").trim()}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(notif.sentAt || notif.createdAt).toLocaleString("pl-PL")}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Products list */}
          {filteredProducts.length === 0 ? (
            <EmptyState
              icon={Package}
              title={productsData.length === 0 ? "Brak produktow" : "Brak wynikow"}
              description={productsData.length === 0
                ? "Dodaj pierwszy produkt do magazynu."
                : "Zmien kryteria wyszukiwania."}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="products-grid">
              {filteredProducts.map((product) => {
                const qty = parseFloat(product.quantity || "0");
                const minQty = product.minQuantity
                  ? parseFloat(product.minQuantity)
                  : null;
                const isLowStock = minQty !== null && qty <= minQty;

                return (
                  <Card
                    key={product.id}
                    className={`relative ${isLowStock ? "border-orange-300 dark:border-orange-700" : ""}`}
                    data-testid={`product-card-${product.id}`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <CardTitle
                            className="text-base truncate cursor-pointer hover:text-primary transition-colors"
                            onClick={() => router.push(`/dashboard/products/${product.id}`)}
                            data-testid="product-name"
                          >
                            {product.name}
                          </CardTitle>
                          {product.category && (
                            <Badge variant="secondary" className="mt-1 text-xs">
                              {product.category}
                            </Badge>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0 ml-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEditDialog(product)}
                            data-testid={`edit-product-${product.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => {
                              setProductToDelete(product);
                              setDeleteDialogOpen(true);
                            }}
                            data-testid={`delete-product-${product.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Stan:</span>
                          <span
                            className={`text-sm font-medium ${isLowStock ? "text-orange-600" : ""}`}
                            data-testid="product-quantity"
                          >
                            {qty} {product.unit || "szt."}
                            {isLowStock && (
                              <AlertTriangle className="inline h-3.5 w-3.5 ml-1 text-orange-500" />
                            )}
                          </span>
                        </div>
                        {minQty !== null && (
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">
                              Min. stan:
                            </span>
                            <span className="text-sm">
                              {minQty} {product.unit || "szt."}
                            </span>
                          </div>
                        )}
                        {product.pricePerUnit && (
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-muted-foreground">
                              Cena/jedn.:
                            </span>
                            <span className="text-sm">
                              {parseFloat(product.pricePerUnit).toFixed(2)} PLN
                            </span>
                          </div>
                        )}
                        <div className="pt-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full text-xs text-muted-foreground hover:text-primary"
                            onClick={() => router.push(`/dashboard/products/${product.id}`)}
                            data-testid={`usage-history-${product.id}`}
                          >
                            <History className="h-3.5 w-3.5 mr-1" />
                            Historia zuzycia
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          </>)}
        </TabsContent>

        {/* ==================== CATEGORIES TAB ==================== */}
        <TabsContent value="categories">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold" data-testid="categories-title">
                Kategorie produktow
              </h2>
              <p className="text-sm text-muted-foreground">
                Organizuj produkty wedlug typow
              </p>
            </div>
            <Button onClick={openAddCategoryDialog} data-testid="add-category-btn">
              <Plus className="h-4 w-4 mr-2" />
              Dodaj kategorie
            </Button>
          </div>

          {categoriesLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : categories.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FolderOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                <p className="text-muted-foreground text-lg font-medium">
                  Brak kategorii
                </p>
                <p className="text-muted-foreground text-sm mt-1">
                  Dodaj pierwsza kategorie, aby organizowac produkty
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3" data-testid="categories-list">
              {categories.map((category) => (
                <Card key={category.id} data-testid={`category-card-${category.id}`}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Tag className="h-5 w-5 text-primary shrink-0" />
                        <div>
                          <p className="font-medium" data-testid={`category-name-${category.id}`}>
                            {category.name}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {category.productCount === 0
                              ? "Brak produktow"
                              : `${category.productCount} ${category.productCount === 1 ? "produkt" : category.productCount < 5 ? "produkty" : "produktow"}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEditCategoryDialog(category)}
                          data-testid={`edit-category-${category.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => {
                            setCategoryToDelete(category);
                            setDeleteCategoryDialogOpen(true);
                          }}
                          disabled={category.productCount > 0}
                          title={category.productCount > 0 ? "Nie mozna usunac kategorii z produktami" : "Usun kategorie"}
                          data-testid={`delete-category-${category.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add/Edit Product Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md" data-testid="product-dialog">
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? "Edytuj produkt" : "Dodaj produkt"}
            </DialogTitle>
          </DialogHeader>
          {productWasRecovered && !editingProduct && (
            <FormRecoveryBanner
              onRestore={handleRestoreProductForm}
              onDismiss={clearProductSavedForm}
            />
          )}
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="product-name">Nazwa produktu *</Label>
              <Input
                id="product-name"
                value={formName}
                onChange={(e) => {
                  setFormName(e.target.value);
                  if (e.target.value.trim()) clearFieldError("name");
                }}
                placeholder="np. Farba Wella Koleston 6/0"
                required
                aria-invalid={!!formErrors.name}
                className={formErrors.name ? "border-destructive" : ""}
                data-testid="product-name-input"
              />
              {formErrors.name && (
                <p className="text-sm text-destructive" data-testid="error-product-name">
                  {formErrors.name}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="product-category">Kategoria</Label>
              <Select
                value={formCategory || NO_CATEGORY}
                onValueChange={(val) =>
                  setFormCategory(val === NO_CATEGORY ? "" : val)
                }
              >
                <SelectTrigger data-testid="product-category-select">
                  <SelectValue placeholder="Wybierz kategorie" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CATEGORY}>Bez kategorii</SelectItem>
                  {categoryNames.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="product-quantity">Ilosc</Label>
                <Input
                  id="product-quantity"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formQuantity}
                  onChange={(e) => {
                    setFormQuantity(e.target.value);
                    const val = e.target.value;
                    if (val === "" || (!isNaN(Number(val)) && parseFloat(val) >= 0)) {
                      clearFieldError("quantity");
                    } else if (val && isNaN(Number(val))) {
                      setFormErrors((prev) => ({ ...prev, quantity: "Ilosc musi byc liczba" }));
                    } else if (val && parseFloat(val) < 0) {
                      setFormErrors((prev) => ({ ...prev, quantity: "Ilosc nie moze byc ujemna" }));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (
                      !/[0-9]/.test(e.key) &&
                      !["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", ".", ","].includes(e.key) &&
                      !e.ctrlKey && !e.metaKey
                    ) {
                      e.preventDefault();
                    }
                    if (e.key === "-") e.preventDefault();
                  }}
                  placeholder="0"
                  aria-invalid={!!formErrors.quantity}
                  className={formErrors.quantity ? "border-destructive" : ""}
                  data-testid="product-quantity-input"
                />
                {formErrors.quantity && (
                  <p className="text-sm text-destructive mt-1" data-testid="error-product-quantity">
                    {formErrors.quantity}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="product-unit">Jednostka</Label>
                <Select
                  value={formUnit || "szt."}
                  onValueChange={setFormUnit}
                >
                  <SelectTrigger data-testid="product-unit-select">
                    <SelectValue placeholder="Jednostka" />
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="product-min-quantity">Min. stan</Label>
                <Input
                  id="product-min-quantity"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formMinQuantity}
                  onChange={(e) => {
                    setFormMinQuantity(e.target.value);
                    const val = e.target.value;
                    if (val === "" || (!isNaN(Number(val)) && parseFloat(val) >= 0)) {
                      clearFieldError("minQuantity");
                    } else if (val && isNaN(Number(val))) {
                      setFormErrors((prev) => ({ ...prev, minQuantity: "Minimalny stan musi byc liczba" }));
                    } else if (val && parseFloat(val) < 0) {
                      setFormErrors((prev) => ({ ...prev, minQuantity: "Minimalny stan nie moze byc ujemny" }));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (
                      !/[0-9]/.test(e.key) &&
                      !["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", ".", ","].includes(e.key) &&
                      !e.ctrlKey && !e.metaKey
                    ) {
                      e.preventDefault();
                    }
                    if (e.key === "-") e.preventDefault();
                  }}
                  placeholder="opcjonalnie"
                  aria-invalid={!!formErrors.minQuantity}
                  className={formErrors.minQuantity ? "border-destructive" : ""}
                  data-testid="product-min-quantity-input"
                />
                {formErrors.minQuantity && (
                  <p className="text-sm text-destructive mt-1" data-testid="error-product-min-quantity">
                    {formErrors.minQuantity}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="product-price">Cena za jedn. (PLN)</Label>
                <Input
                  id="product-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formPricePerUnit}
                  onChange={(e) => {
                    setFormPricePerUnit(e.target.value);
                    const val = e.target.value;
                    if (val === "" || (!isNaN(Number(val)) && parseFloat(val) >= 0)) {
                      clearFieldError("pricePerUnit");
                    } else if (val && isNaN(Number(val))) {
                      setFormErrors((prev) => ({ ...prev, pricePerUnit: "Cena musi byc liczba" }));
                    } else if (val && parseFloat(val) < 0) {
                      setFormErrors((prev) => ({ ...prev, pricePerUnit: "Cena nie moze byc ujemna" }));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (
                      !/[0-9]/.test(e.key) &&
                      !["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", ".", ","].includes(e.key) &&
                      !e.ctrlKey && !e.metaKey
                    ) {
                      e.preventDefault();
                    }
                    if (e.key === "-") e.preventDefault();
                  }}
                  placeholder="opcjonalnie"
                  aria-invalid={!!formErrors.pricePerUnit}
                  className={formErrors.pricePerUnit ? "border-destructive" : ""}
                  data-testid="product-price-input"
                />
                {formErrors.pricePerUnit && (
                  <p className="text-sm text-destructive mt-1" data-testid="error-product-price">
                    {formErrors.pricePerUnit}
                  </p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Anuluj
            </Button>
            <Button onClick={handleSave} disabled={saving} data-testid="save-product-btn">
              {saving
                ? "Zapisywanie..."
                : editingProduct
                  ? "Zapisz zmiany"
                  : "Dodaj produkt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Product Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunac produkt?</AlertDialogTitle>
            <AlertDialogDescription>
              Czy na pewno chcesz usunac produkt{" "}
              <strong>{productToDelete?.name}</strong>? Ta operacja jest
              nieodwracalna.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="confirm-delete-product"
            >
              Usun
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add/Edit Category Dialog */}
      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-w-sm" data-testid="category-dialog">
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? "Zmien nazwe kategorii" : "Dodaj kategorie"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="category-name">Nazwa kategorii *</Label>
              <Input
                id="category-name"
                value={categoryFormName}
                onChange={(e) => {
                  setCategoryFormName(e.target.value);
                  if (e.target.value.trim()) clearCategoryFieldError("categoryName");
                }}
                placeholder="np. Farby do wlosow"
                aria-invalid={!!categoryFormErrors.categoryName}
                className={categoryFormErrors.categoryName ? "border-destructive" : ""}
                data-testid="category-name-input"
              />
              {categoryFormErrors.categoryName && (
                <p className="text-sm text-destructive mt-1" data-testid="error-category-name">
                  {categoryFormErrors.categoryName}
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCategoryDialogOpen(false)}>
              Anuluj
            </Button>
            <Button
              onClick={handleSaveCategory}
              disabled={savingCategory}
              data-testid="save-category-btn"
            >
              {savingCategory
                ? "Zapisywanie..."
                : editingCategory
                  ? "Zapisz zmiany"
                  : "Dodaj kategorie"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Category Confirmation Dialog */}
      <AlertDialog open={deleteCategoryDialogOpen} onOpenChange={setDeleteCategoryDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunac kategorie?</AlertDialogTitle>
            <AlertDialogDescription>
              Czy na pewno chcesz usunac kategorie{" "}
              <strong>{categoryToDelete?.name}</strong>? Ta operacja jest
              nieodwracalna.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCategory}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="confirm-delete-category"
            >
              Usun
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
