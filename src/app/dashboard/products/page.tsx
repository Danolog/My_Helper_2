"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
} from "lucide-react";
import { toast } from "sonner";

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

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";
const NO_CATEGORY = "__none__";

const PRODUCT_CATEGORIES = [
  "Farby",
  "Odżywki",
  "Szampony",
  "Stylizacja",
  "Pielęgnacja",
  "Materiały jednorazowe",
  "Chemia",
  "Inne",
];

const UNITS = ["ml", "g", "szt.", "opak.", "l", "kg"];

export default function ProductsPage() {
  const { data: session, isPending } = useSession();
  const [productsData, setProductsData] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("name-asc");

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

  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch(`/api/products?salonId=${DEMO_SALON_ID}`);
      const data = await res.json();
      if (data.success) {
        setProductsData(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch products:", error);
      toast.error("Błąd podczas ładowania produktów");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLowStockNotifications = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/notifications?salonId=${DEMO_SALON_ID}&type=system&limit=10`
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
      console.error("Failed to fetch notifications:", error);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
    fetchLowStockNotifications();
  }, [fetchProducts, fetchLowStockNotifications]);

  const openAddDialog = () => {
    setEditingProduct(null);
    setFormName("");
    setFormCategory("");
    setFormQuantity("");
    setFormMinQuantity("");
    setFormUnit("szt.");
    setFormPricePerUnit("");
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
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error("Podaj nazwę produktu");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        salonId: DEMO_SALON_ID,
        name: formName.trim(),
        category: formCategory || null,
        quantity: parseFloat(formQuantity) || 0,
        minQuantity: formMinQuantity ? parseFloat(formMinQuantity) : null,
        unit: formUnit || null,
        pricePerUnit: formPricePerUnit ? parseFloat(formPricePerUnit) : null,
      };

      let res: Response;
      if (editingProduct) {
        res = await fetch(`/api/products/${editingProduct.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/products", {
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
            `Niski stan magazynowy: "${formName}" - wysłano powiadomienie`,
            { duration: 6000 }
          );
        }
        setDialogOpen(false);
        fetchProducts();
        fetchLowStockNotifications();
      } else {
        toast.error(data.error || "Nie udało się zapisać produktu");
      }
    } catch (error) {
      console.error("Failed to save product:", error);
      toast.error("Błąd podczas zapisywania produktu");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!productToDelete) return;

    try {
      const res = await fetch(`/api/products/${productToDelete.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Produkt "${productToDelete.name}" usunięty`);
        fetchProducts();
      } else {
        toast.error(data.error || "Nie udało się usunąć produktu");
      }
    } catch (error) {
      console.error("Failed to delete product:", error);
      toast.error("Błąd podczas usuwania produktu");
    } finally {
      setDeleteDialogOpen(false);
      setProductToDelete(null);
    }
  };

  // Filter and sort products
  const filteredProducts = productsData
    .filter((p) => {
      const matchesSearch =
        !searchQuery ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.category && p.category.toLowerCase().includes(searchQuery.toLowerCase()));
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

  // Get unique categories from data
  const uniqueCategories = Array.from(
    new Set(productsData.map((p) => p.category).filter(Boolean))
  ) as string[];

  // Low stock products
  const lowStockProducts = productsData.filter((p) => {
    if (!p.minQuantity) return false;
    return parseFloat(p.quantity || "0") <= parseFloat(p.minQuantity);
  });

  if (isPending || loading) {
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
            Musisz się zalogować, aby zarządzać magazynem
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
              Magazyn produktów
            </h1>
            <p className="text-muted-foreground text-sm">
              Zarządzaj produktami i stanem magazynowym
            </p>
          </div>
        </div>
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
            <SelectItem value="quantity-asc">Ilość rosnąco</SelectItem>
            <SelectItem value="quantity-desc">Ilość malejąco</SelectItem>
            <SelectItem value="category-asc">Kategoria A-Z</SelectItem>
            <SelectItem value="category-desc">Kategoria Z-A</SelectItem>
            <SelectItem value="price-asc">Cena rosnąco</SelectItem>
            <SelectItem value="price-desc">Cena malejąco</SelectItem>
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
              <p className="text-sm text-muted-foreground">Produktów łącznie</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <p className="text-2xl font-bold">{uniqueCategories.length}</p>
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
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-muted-foreground text-lg font-medium">
              {productsData.length === 0 ? "Brak produktów" : "Brak wyników"}
            </p>
            <p className="text-muted-foreground text-sm mt-1">
              {productsData.length === 0
                ? "Dodaj pierwszy produkt do magazynu"
                : "Zmień kryteria wyszukiwania"}
            </p>
          </CardContent>
        </Card>
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
                      <CardTitle className="text-base truncate" data-testid="product-name">
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
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add/Edit Product Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md" data-testid="product-dialog">
          <DialogHeader>
            <DialogTitle>
              {editingProduct ? "Edytuj produkt" : "Dodaj produkt"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="product-name">Nazwa produktu *</Label>
              <Input
                id="product-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="np. Farba Wella Koleston 6/0"
                data-testid="product-name-input"
              />
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
                  <SelectValue placeholder="Wybierz kategorię" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CATEGORY}>Bez kategorii</SelectItem>
                  {PRODUCT_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="product-quantity">Ilość</Label>
                <Input
                  id="product-quantity"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formQuantity}
                  onChange={(e) => setFormQuantity(e.target.value)}
                  placeholder="0"
                  data-testid="product-quantity-input"
                />
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
                  onChange={(e) => setFormMinQuantity(e.target.value)}
                  placeholder="opcjonalnie"
                  data-testid="product-min-quantity-input"
                />
              </div>
              <div>
                <Label htmlFor="product-price">Cena za jedn. (PLN)</Label>
                <Input
                  id="product-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formPricePerUnit}
                  onChange={(e) => setFormPricePerUnit(e.target.value)}
                  placeholder="opcjonalnie"
                  data-testid="product-price-input"
                />
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć produkt?</AlertDialogTitle>
            <AlertDialogDescription>
              Czy na pewno chcesz usunąć produkt{" "}
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
              Usuń
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
