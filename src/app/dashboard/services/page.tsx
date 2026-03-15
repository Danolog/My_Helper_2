"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  Scissors,
  Plus,
  Clock,
  DollarSign,
  ChevronRight,
  Trash2,
  FolderOpen,
  Pencil,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { NetworkErrorHandler } from "@/components/network-error-handler";
import { getNetworkErrorMessage } from "@/lib/fetch-with-retry";
import { useFormRecovery } from "@/hooks/use-form-recovery";
import { FormRecoveryBanner } from "@/components/form-recovery-banner";
import { useTabSync } from "@/hooks/use-tab-sync";
import { useSalonId } from "@/hooks/use-salon-id";
import { EmptyState } from "@/components/ui/empty-state";

interface ServiceCategory {
  id: string;
  salonId: string;
  name: string;
  sortOrder: number | null;
  createdAt: string;
}

interface Service {
  id: string;
  salonId: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  basePrice: string;
  baseDuration: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  category: ServiceCategory | null;
}

export default function ServicesPage() {
  const { data: session, isPending } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();
  const router = useRouter();
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Delete service state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState<Service | null>(null);
  const [deletingService, setDeletingService] = useState(false);

  // Category management state
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [categoryFormName, setCategoryFormName] = useState("");
  const [savingCategory, setSavingCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ServiceCategory | null>(null);
  const [deleteCategoryDialogOpen, setDeleteCategoryDialogOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<ServiceCategory | null>(null);
  const [deletingCategory, setDeletingCategory] = useState(false);

  // Service form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategoryId, setFormCategoryId] = useState<string>("");
  const [formPrice, setFormPrice] = useState("");
  const [formDuration, setFormDuration] = useState("");

  // Form validation errors
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Form recovery for service creation dialog
  const {
    wasRecovered: serviceWasRecovered,
    getRecoveredState: getServiceRecoveredState,
    saveFormState: saveServiceFormState,
    clearSavedForm: clearServiceSavedForm,
    setDirty: setServiceDirty,
  } = useFormRecovery<{
    name: string;
    description: string;
    categoryId: string;
    price: string;
    duration: string;
  }>({
    storageKey: "add-service-form",
    warnOnUnload: true,
  });

  // Auto-open dialog when recovered data is found
  useEffect(() => {
    if (serviceWasRecovered) {
      setDialogOpen(true);
    }
  }, [serviceWasRecovered]);

  // Save service form state on changes (debounced inside hook)
  useEffect(() => {
    const hasData = !!formName || !!formDescription || !!formPrice || !!formDuration;
    if (hasData) {
      saveServiceFormState({
        name: formName,
        description: formDescription,
        categoryId: formCategoryId,
        price: formPrice,
        duration: formDuration,
      });
    }
    setServiceDirty(hasData);
  }, [formName, formDescription, formCategoryId, formPrice, formDuration, saveServiceFormState, setServiceDirty]);

  // Recovery handler: restores service form fields from localStorage
  const handleRestoreServiceForm = () => {
    const saved = getServiceRecoveredState();
    if (saved) {
      setFormName(saved.name || "");
      setFormDescription(saved.description || "");
      setFormCategoryId(saved.categoryId || "");
      setFormPrice(saved.price || "");
      setFormDuration(saved.duration || "");
    }
  };

  // Network error state
  const [fetchError, setFetchError] = useState<{ message: string; isNetwork: boolean; isTimeout: boolean } | null>(null);

  const fetchServices = useCallback(async (signal?: AbortSignal) => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/services?salonId=${salonId}`, signal ? { signal } : {});
      const data = await res.json();
      if (data.success) {
        setServices(data.data);
        setFetchError(null);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      console.error("Failed to fetch services:", error);
      const errInfo = getNetworkErrorMessage(error);
      setFetchError(errInfo);
    }
  }, [salonId]);

  const fetchCategories = useCallback(async (signal?: AbortSignal) => {
    if (!salonId) return;
    try {
      const res = await fetch(
        `/api/service-categories?salonId=${salonId}`,
        signal ? { signal } : {}
      );
      const data = await res.json();
      if (data.success) {
        setCategories(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      console.error("Failed to fetch categories:", error);
    }
  }, [salonId]);

  useEffect(() => {
    const abortController = new AbortController();

    async function loadData() {
      setLoading(true);
      await Promise.all([
        fetchServices(abortController.signal),
        fetchCategories(abortController.signal),
      ]);
      setLoading(false);
    }
    loadData();

    return () => abortController.abort();
  }, [fetchServices, fetchCategories]);

  // Cross-tab sync: refetch when another tab modifies services
  const { notifyChange: notifyServicesChanged } = useTabSync("services", () => {
    fetchServices();
    fetchCategories();
  });

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setFormCategoryId("");
    setFormPrice("");
    setFormDuration("");
    setFormErrors({});
    clearServiceSavedForm();
  };

  const clearFieldError = (field: string) => {
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validateServiceForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!formName.trim()) {
      errors.name = "Wpisz nazwe uslugi, np. Strzyzenie damskie";
    }
    if (!formPrice) {
      errors.price = "Podaj cene uslugi w PLN, np. 50.00";
    } else if (isNaN(parseFloat(formPrice)) || isNaN(Number(formPrice))) {
      errors.price = "Cena musi byc liczba. Wpisz wartosc, np. 50.00";
    } else if (parseFloat(formPrice) < 0) {
      errors.price = "Cena nie moze byc ujemna. Wpisz wartosc wieksza lub rowna 0";
    }
    if (!formDuration) {
      errors.duration = "Podaj czas trwania w minutach, np. 30";
    } else if (isNaN(parseInt(formDuration, 10)) || isNaN(Number(formDuration))) {
      errors.duration = "Czas trwania musi byc liczba minut, np. 30 lub 60";
    } else if (parseInt(formDuration, 10) <= 0) {
      errors.duration = "Czas trwania musi byc wiekszy niz 0 minut";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveService = async () => {
    if (!validateServiceForm()) {
      toast.error("Popraw zaznaczone pola formularza");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId: salonId!,
          categoryId: formCategoryId || null,
          name: formName.trim(),
          description: formDescription.trim() || null,
          basePrice: formPrice,
          baseDuration: formDuration,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(`Usluga "${formName}" zostala dodana`);
        clearServiceSavedForm();
        resetForm();
        setDialogOpen(false);
        await fetchServices();
        notifyServicesChanged();
      } else {
        toast.error(data.error || "Nie udalo sie dodac uslugi");
      }
    } catch (error) {
      console.error("Failed to save service:", error);
      const errInfo = getNetworkErrorMessage(error);
      toast.error(errInfo.isNetwork
        ? errInfo.message
        : "Blad podczas zapisywania uslugi", {
        action: {
          label: "Sprobuj ponownie",
          onClick: () => handleSaveService(),
        },
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteService = async () => {
    if (!serviceToDelete) return;
    setDeletingService(true);
    try {
      const res = await fetch(`/api/services/${serviceToDelete.id}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (data.success) {
        toast.success(`Usluga "${serviceToDelete.name}" zostala usunieta`);
        await fetchServices();
        notifyServicesChanged();
      } else {
        toast.error(data.error || "Nie udalo sie usunac uslugi");
      }
    } catch (error) {
      console.error("Failed to delete service:", error);
      toast.error("Blad podczas usuwania uslugi");
    } finally {
      setDeletingService(false);
      setDeleteDialogOpen(false);
      setServiceToDelete(null);
    }
  };

  // Category CRUD
  const resetCategoryForm = () => {
    setCategoryFormName("");
    setEditingCategory(null);
  };

  const openCategoryDialog = (category?: ServiceCategory) => {
    if (category) {
      setEditingCategory(category);
      setCategoryFormName(category.name);
    } else {
      resetCategoryForm();
    }
    setCategoryDialogOpen(true);
  };

  const handleSaveCategory = async () => {
    if (!categoryFormName.trim()) {
      toast.error("Wpisz nazwe kategorii, np. Fryzjerstwo lub Kosmetyka");
      return;
    }

    setSavingCategory(true);
    try {
      if (editingCategory) {
        // Update existing category
        const res = await fetch(`/api/service-categories/${editingCategory.id}`, {
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
        const res = await fetch("/api/service-categories", {
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
    } catch (error) {
      console.error("Failed to save category:", error);
      toast.error("Blad podczas zapisywania kategorii");
    } finally {
      setSavingCategory(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!categoryToDelete) return;
    setDeletingCategory(true);
    try {
      const res = await fetch(`/api/service-categories/${categoryToDelete.id}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (data.success) {
        toast.success(`Kategoria "${categoryToDelete.name}" zostala usunieta`);
        await fetchCategories();
      } else {
        toast.error(data.error || "Nie mozna usunac kategorii");
      }
    } catch (error) {
      console.error("Failed to delete category:", error);
      toast.error("Blad podczas usuwania kategorii");
    } finally {
      setDeletingCategory(false);
      setDeleteCategoryDialogOpen(false);
      setCategoryToDelete(null);
    }
  };

  // Assign a service to a category
  const handleAssignCategory = async (serviceId: string, categoryId: string | null) => {
    try {
      const res = await fetch(`/api/services/${serviceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Kategoria uslugi zostala zmieniona");
        await fetchServices();
      } else {
        toast.error(data.error || "Nie udalo sie zmienic kategorii");
      }
    } catch (error) {
      console.error("Failed to assign category:", error);
      toast.error("Blad podczas przypisywania kategorii");
    }
  };

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

  const formatPrice = (price: string) => {
    return parseFloat(price).toFixed(2);
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hrs}h ${mins}min` : `${hrs}h`;
  };

  // Group services by category
  const getServicesByCategory = () => {
    const grouped: { category: ServiceCategory | null; services: Service[] }[] = [];

    // Categorized services
    for (const cat of categories) {
      const catServices = services.filter((s) => s.categoryId === cat.id);
      grouped.push({ category: cat, services: catServices });
    }

    // Uncategorized services
    const uncategorized = services.filter((s) => !s.categoryId);
    if (uncategorized.length > 0) {
      grouped.push({ category: null, services: uncategorized });
    }

    return grouped;
  };

  // Count services per category
  const getServiceCountForCategory = (categoryId: string) => {
    return services.filter((s) => s.categoryId === categoryId).length;
  };

  const renderServiceCard = (service: Service) => (
    <Card
      key={service.id}
      className="hover:shadow-md transition-shadow cursor-pointer"
      data-testid={`service-card-${service.id}`}
      onClick={() => router.push(`/dashboard/services/${service.id}`)}
    >
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-base">{service.name}</span>
            <Badge variant={service.isActive ? "default" : "secondary"}>
              {service.isActive ? "Aktywna" : "Nieaktywna"}
            </Badge>
            {service.category && (
              <Badge variant="outline">{service.category.name}</Badge>
            )}
          </div>
          {service.description && (
            <p className="text-sm text-muted-foreground mb-2">
              {service.description}
            </p>
          )}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5" />
              {formatPrice(service.basePrice)} PLN
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {formatDuration(service.baseDuration)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Category quick-assign dropdown */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="mr-1"
          >
            <Select
              value={service.categoryId || "__none"}
              onValueChange={(value) =>
                handleAssignCategory(service.id, value === "__none" ? null : value)
              }
            >
              <SelectTrigger
                className="h-8 w-8 p-0 border-0 bg-transparent [&>svg]:hidden"
                data-testid={`assign-category-${service.id}`}
              >
                <Tag className="h-4 w-4 text-muted-foreground" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Bez kategorii</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              setServiceToDelete(service);
              setDeleteDialogOpen(true);
            }}
            data-testid={`delete-service-${service.id}`}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );

  const groupedServices = getServicesByCategory();

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
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-service-btn">
              <Plus className="h-4 w-4 mr-2" />
              Dodaj usluge
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Dodaj nowa usluge</DialogTitle>
              <DialogDescription>
                Wypelnij formularz, aby dodac nowa usluge do oferty salonu.
              </DialogDescription>
            </DialogHeader>
            {serviceWasRecovered && (
              <FormRecoveryBanner
                onRestore={handleRestoreServiceForm}
                onDismiss={clearServiceSavedForm}
              />
            )}
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="service-name">Nazwa uslugi *</Label>
                <Input
                  id="service-name"
                  placeholder="np. Strzyzenie meskie"
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    if (e.target.value.trim()) clearFieldError("name");
                  }}
                  required
                  aria-invalid={!!formErrors.name}
                  className={formErrors.name ? "border-destructive" : ""}
                  data-testid="service-name-input"
                />
                {formErrors.name && (
                  <p className="text-sm text-destructive" data-testid="error-service-name">
                    {formErrors.name}
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="service-description">Opis</Label>
                <Textarea
                  id="service-description"
                  placeholder="Krotki opis uslugi..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={3}
                  data-testid="service-description-input"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="service-category">Kategoria</Label>
                <Select
                  value={formCategoryId}
                  onValueChange={setFormCategoryId}
                >
                  <SelectTrigger
                    id="service-category"
                    data-testid="service-category-select"
                  >
                    <SelectValue placeholder="Wybierz kategorie" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        Brak kategorii - dodaj je w zakladce Kategorie
                      </SelectItem>
                    ) : (
                      categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="service-price">Cena bazowa (PLN) *</Label>
                  <Input
                    id="service-price"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={formPrice}
                    onChange={(e) => {
                      setFormPrice(e.target.value);
                      const val = e.target.value;
                      if (val && !isNaN(Number(val)) && parseFloat(val) >= 0) {
                        clearFieldError("price");
                      } else if (val && (isNaN(Number(val)))) {
                        setFormErrors((prev) => ({ ...prev, price: "Cena musi byc liczba" }));
                      } else if (val && parseFloat(val) < 0) {
                        setFormErrors((prev) => ({ ...prev, price: "Cena nie moze byc ujemna" }));
                      }
                    }}
                    onKeyDown={(e) => {
                      // Block letters and special chars except numeric input helpers
                      if (
                        !/[0-9]/.test(e.key) &&
                        !["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", ".", ",", "-"].includes(e.key) &&
                        !e.ctrlKey && !e.metaKey
                      ) {
                        e.preventDefault();
                      }
                      // Block minus key for price (no negatives)
                      if (e.key === "-") {
                        e.preventDefault();
                      }
                    }}
                    required
                    aria-invalid={!!formErrors.price}
                    className={formErrors.price ? "border-destructive" : ""}
                    data-testid="service-price-input"
                  />
                  {formErrors.price && (
                    <p className="text-sm text-destructive" data-testid="error-service-price">
                      {formErrors.price}
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="service-duration">
                    Czas trwania (min) *
                  </Label>
                  <Input
                    id="service-duration"
                    type="number"
                    min="1"
                    step="5"
                    placeholder="30"
                    value={formDuration}
                    onChange={(e) => {
                      setFormDuration(e.target.value);
                      const val = e.target.value;
                      if (val && !isNaN(Number(val)) && parseInt(val, 10) > 0) {
                        clearFieldError("duration");
                      } else if (val && isNaN(Number(val))) {
                        setFormErrors((prev) => ({ ...prev, duration: "Czas trwania musi byc liczba" }));
                      } else if (val && parseInt(val, 10) <= 0) {
                        setFormErrors((prev) => ({ ...prev, duration: "Czas trwania musi byc wiekszy niz 0" }));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (
                        !/[0-9]/.test(e.key) &&
                        !["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key) &&
                        !e.ctrlKey && !e.metaKey
                      ) {
                        e.preventDefault();
                      }
                    }}
                    required
                    aria-invalid={!!formErrors.duration}
                    className={formErrors.duration ? "border-destructive" : ""}
                    data-testid="service-duration-input"
                  />
                  {formErrors.duration && (
                    <p className="text-sm text-destructive" data-testid="error-service-duration">
                      {formErrors.duration}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  resetForm();
                  setDialogOpen(false);
                }}
              >
                Anuluj
              </Button>
              <Button
                onClick={handleSaveService}
                disabled={saving}
                data-testid="save-service-btn"
              >
                {saving ? "Zapisywanie..." : "Zapisz usluge"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="services" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="services" data-testid="tab-services">
            <Scissors className="h-4 w-4 mr-2" />
            Uslugi ({services.length})
          </TabsTrigger>
          <TabsTrigger value="categories" data-testid="tab-categories">
            <FolderOpen className="h-4 w-4 mr-2" />
            Kategorie ({categories.length})
          </TabsTrigger>
        </TabsList>

        {/* Services Tab */}
        <TabsContent value="services">
          {fetchError ? (
            <NetworkErrorHandler
              message={fetchError.message}
              isNetworkError={fetchError.isNetwork}
              isTimeout={fetchError.isTimeout}
              onRetry={async () => {
                setFetchError(null);
                setLoading(true);
                await fetchServices();
                await fetchCategories();
                setLoading(false);
              }}
              isRetrying={loading}
            />
          ) : loading ? (
            <div className="flex justify-center items-center h-48">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : services.length === 0 ? (
            <EmptyState
              icon={Scissors}
              title="Brak uslug"
              description="Dodaj pierwsza usluge, aby rozpoczac."
              action={{
                label: "Dodaj usluge",
                icon: Plus,
                onClick: () => setDialogOpen(true),
                "data-testid": "empty-state-add-btn",
              }}
            />
          ) : categories.length > 0 ? (
            // Grouped by category view
            <div className="space-y-6">
              {groupedServices.map((group) => (
                <div key={group.category?.id || "uncategorized"}>
                  <div className="flex items-center gap-2 mb-3">
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                    <h2 className="text-lg font-semibold" data-testid={`category-group-${group.category?.id || "uncategorized"}`}>
                      {group.category?.name || "Bez kategorii"}
                    </h2>
                    <Badge variant="secondary" className="text-xs">
                      {group.services.length}
                    </Badge>
                  </div>
                  {group.services.length > 0 ? (
                    <div className="space-y-3 ml-2">
                      {group.services.map(renderServiceCard)}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground ml-6 mb-4">
                      Brak uslug w tej kategorii
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            // Flat view when no categories exist
            <div className="space-y-3">
              {services.map(renderServiceCard)}
            </div>
          )}
        </TabsContent>

        {/* Categories Tab */}
        <TabsContent value="categories">
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-muted-foreground">
              Zarzadzaj kategoriami uslug salonu
            </p>
            <Button
              onClick={() => openCategoryDialog()}
              data-testid="add-category-btn"
            >
              <Plus className="h-4 w-4 mr-2" />
              Dodaj kategorie
            </Button>
          </div>

          {categories.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FolderOpen className="w-12 h-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-4">
                  Brak kategorii. Dodaj pierwsza kategorie, aby organizowac uslugi.
                </p>
                <Button
                  onClick={() => openCategoryDialog()}
                  data-testid="empty-state-add-category-btn"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Dodaj kategorie
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {categories.map((category) => {
                const serviceCount = getServiceCountForCategory(category.id);
                return (
                  <Card
                    key={category.id}
                    data-testid={`category-card-${category.id}`}
                  >
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-3">
                        <FolderOpen className="h-5 w-5 text-primary" />
                        <div>
                          <span className="font-medium" data-testid={`category-name-${category.id}`}>
                            {category.name}
                          </span>
                          <p className="text-sm text-muted-foreground">
                            {serviceCount === 0
                              ? "Brak uslug"
                              : serviceCount === 1
                              ? "1 usluga"
                              : `${serviceCount} uslug`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openCategoryDialog(category)}
                          data-testid={`edit-category-${category.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setCategoryToDelete(category);
                            setDeleteCategoryDialogOpen(true);
                          }}
                          data-testid={`delete-category-${category.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add/Edit Category Dialog */}
      <Dialog
        open={categoryDialogOpen}
        onOpenChange={(open) => {
          setCategoryDialogOpen(open);
          if (!open) resetCategoryForm();
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? "Edytuj kategorie" : "Dodaj nowa kategorie"}
            </DialogTitle>
            <DialogDescription>
              {editingCategory
                ? "Zmien nazwe kategorii uslug."
                : "Podaj nazwe nowej kategorii uslug."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="category-name">Nazwa kategorii *</Label>
              <Input
                id="category-name"
                placeholder="np. Uslugi fryzjerskie"
                value={categoryFormName}
                onChange={(e) => setCategoryFormName(e.target.value)}
                data-testid="category-name-input"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSaveCategory();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                resetCategoryForm();
                setCategoryDialogOpen(false);
              }}
            >
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
      <AlertDialog
        open={deleteCategoryDialogOpen}
        onOpenChange={(open) => {
          setDeleteCategoryDialogOpen(open);
          if (!open) setCategoryToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunac kategorie?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                if (!categoryToDelete) return "";
                const count = getServiceCountForCategory(categoryToDelete.id);
                if (count > 0) {
                  return `Nie mozna usunac kategorii "${categoryToDelete.name}" - ${count} uslug jest do niej przypisanych. Najpierw przenies uslugi do innej kategorii.`;
                }
                return `Czy na pewno chcesz usunac kategorie "${categoryToDelete.name}"? Ta operacja jest nieodwracalna.`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="cancel-delete-category-btn">
              Anuluj
            </AlertDialogCancel>
            {categoryToDelete && getServiceCountForCategory(categoryToDelete.id) === 0 && (
              <AlertDialogAction
                onClick={handleDeleteCategory}
                disabled={deletingCategory}
                className="bg-destructive text-white hover:bg-destructive/90"
                data-testid="confirm-delete-category-btn"
              >
                {deletingCategory ? "Usuwanie..." : "Usun kategorie"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Service Confirmation Dialog */}
      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setServiceToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunac usluge?</AlertDialogTitle>
            <AlertDialogDescription>
              Czy na pewno chcesz usunac usluge &quot;{serviceToDelete?.name}
              &quot;? Ta operacja jest nieodwracalna. Zostan rowniez usuniete
              wszystkie warianty, przypisania pracownikow i indywidualne ceny
              powiazane z ta usluga. Istniejace wizyty zachowaja swoja historie.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="cancel-delete-service-btn">
              Anuluj
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteService}
              disabled={deletingService}
              className="bg-destructive text-white hover:bg-destructive/90"
              data-testid="confirm-delete-service-btn"
            >
              {deletingService ? "Usuwanie..." : "Usun usluge"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
