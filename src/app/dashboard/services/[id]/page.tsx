"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Image from "next/image";
import Link from "next/link";
import {
  Lock,
  Scissors,
  Plus,
  Clock,
  DollarSign,
  ArrowLeft,
  Trash2,
  Edit2,
  Layers,
  Users,
  Image as ImageIcon,
  Package,
  Sparkles,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useSalonId } from "@/hooks/use-salon-id";

interface ServiceVariant {
  id: string;
  serviceId: string;
  name: string;
  priceModifier: string;
  durationModifier: number;
  createdAt: string;
}

interface ServiceCategory {
  id: string;
  salonId: string;
  name: string;
  sortOrder: number | null;
  createdAt: string;
}

interface ServiceDetail {
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
  variants: ServiceVariant[];
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  color: string | null;
}

interface EmployeePrice {
  id: string;
  employeeId: string;
  serviceId: string;
  variantId: string | null;
  customPrice: string;
  createdAt: string;
  employee: Employee | null;
  variant: ServiceVariant | null;
}

interface Product {
  id: string;
  name: string;
  category: string | null;
  unit: string | null;
  quantity: string | null;
  minQuantity: string | null;
}

interface ServiceProductLink {
  id: string;
  serviceId: string;
  productId: string;
  defaultQuantity: string;
  createdAt: string;
  productName: string | null;
  productCategory: string | null;
  productUnit: string | null;
  productQuantity: string | null;
  productMinQuantity: string | null;
}

interface GalleryPhoto {
  id: string;
  afterPhotoUrl: string | null;
  beforePhotoUrl: string | null;
  description: string | null;
  employeeFirstName: string | null;
  employeeLastName: string | null;
  serviceName: string | null;
  createdAt: string;
}

export default function ServiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const serviceId = params.id as string;
  const { data: session, isPending } = useSession();
  const { salonId, loading: salonLoading } = useSalonId();
  const [service, setService] = useState<ServiceDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Variant form state
  const [variantDialogOpen, setVariantDialogOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ServiceVariant | null>(null);
  const [variantName, setVariantName] = useState("");
  const [variantPriceModifier, setVariantPriceModifier] = useState("0");
  const [variantDurationModifier, setVariantDurationModifier] = useState("0");
  const [savingVariant, setSavingVariant] = useState(false);
  const [variantErrors, setVariantErrors] = useState<Record<string, string>>({});

  // Employee assignment state
  const [assignedEmployeeIds, setAssignedEmployeeIds] = useState<Set<string>>(new Set());
  const [togglingAssignment, setTogglingAssignment] = useState<string | null>(null);

  // Employee pricing state
  const [employeePrices, setEmployeePrices] = useState<EmployeePrice[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [empPriceDialogOpen, setEmpPriceDialogOpen] = useState(false);
  const [empPriceEmployeeId, setEmpPriceEmployeeId] = useState("");
  const [empPriceCustomPrice, setEmpPriceCustomPrice] = useState("");
  const [savingEmpPrice, setSavingEmpPrice] = useState(false);

  // Edit service state
  const [editServiceDialogOpen, setEditServiceDialogOpen] = useState(false);
  const [editServiceName, setEditServiceName] = useState("");
  const [editServiceDescription, setEditServiceDescription] = useState("");
  const [editServicePrice, setEditServicePrice] = useState("");
  const [editServiceDuration, setEditServiceDuration] = useState("");
  const [editServiceIsActive, setEditServiceIsActive] = useState(true);
  const [savingService, setSavingService] = useState(false);

  // Edit service field errors
  const [editServiceErrors, setEditServiceErrors] = useState<Record<string, string>>({});

  // Delete service state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingService, setDeletingService] = useState(false);

  // Service product links state (auto-deduction)
  const [serviceProductLinks, setServiceProductLinks] = useState<ServiceProductLink[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [productLinkDialogOpen, setProductLinkDialogOpen] = useState(false);
  const [productLinkProductId, setProductLinkProductId] = useState("");
  const [productLinkQuantity, setProductLinkQuantity] = useState("1");
  const [savingProductLink, setSavingProductLink] = useState(false);

  // Gallery photos state
  const [galleryPhotos, setGalleryPhotos] = useState<GalleryPhoto[]>([]);

  // AI description generation state
  const [generatingDescription, setGeneratingDescription] = useState(false);

  const fetchService = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      const res = await fetch(`/api/services/${serviceId}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setService(data.data);
      } else {
        toast.error("Nie znaleziono uslugi");
        router.replace("/dashboard/services");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      toast.error("Blad podczas ladowania uslugi");
    } finally {
      setLoading(false);
    }
  }, [serviceId, router]);

  const fetchEmployeeAssignments = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      const res = await fetch(`/api/services/${serviceId}/employee-assignments`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        const ids = new Set<string>(
          data.data.map((a: { employeeId: string }) => a.employeeId)
        );
        setAssignedEmployeeIds(ids);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [serviceId]);

  const fetchEmployeePrices = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      const res = await fetch(`/api/services/${serviceId}/employee-prices`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setEmployeePrices(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [serviceId]);

  const fetchEmployees = useCallback(async (signal: AbortSignal | null = null) => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/employees?salonId=${salonId}&activeOnly=true`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setAllEmployees(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [salonId]);

  const fetchServiceProductLinks = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      const res = await fetch(`/api/services/${serviceId}/products`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setServiceProductLinks(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [serviceId]);

  const fetchAllProducts = useCallback(async (signal: AbortSignal | null = null) => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/products?salonId=${salonId}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setAllProducts(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [salonId]);

  const fetchGalleryPhotos = useCallback(async (signal: AbortSignal | null = null) => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/gallery?salonId=${salonId}&serviceId=${serviceId}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setGalleryPhotos(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [salonId, serviceId]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadData() {
      setLoading(true);
      await Promise.all([
        fetchService(controller.signal),
        fetchEmployeeAssignments(controller.signal),
        fetchEmployeePrices(controller.signal),
        fetchEmployees(controller.signal),
        fetchGalleryPhotos(controller.signal),
        fetchServiceProductLinks(controller.signal),
        fetchAllProducts(controller.signal),
      ]);
      setLoading(false);
    }
    loadData();
    return () => controller.abort();
  }, [fetchService, fetchEmployeeAssignments, fetchEmployeePrices, fetchEmployees, fetchGalleryPhotos, fetchServiceProductLinks, fetchAllProducts]);

  const handleToggleEmployeeAssignment = async (employeeId: string, isCurrentlyAssigned: boolean) => {
    setTogglingAssignment(employeeId);
    try {
      if (isCurrentlyAssigned) {
        // Unassign
        const res = await fetch(
          `/api/services/${serviceId}/employee-assignments?employeeId=${employeeId}`,
          { method: "DELETE" }
        );
        const data = await res.json();
        if (data.success) {
          setAssignedEmployeeIds((prev) => {
            const next = new Set(prev);
            next.delete(employeeId);
            return next;
          });
          const emp = allEmployees.find((e) => e.id === employeeId);
          toast.success(
            `${emp ? `${emp.firstName} ${emp.lastName}` : "Pracownik"} odlaczony od uslugi`
          );
        } else {
          toast.error(data.error || "Nie udalo sie odlaczyc pracownika");
        }
      } else {
        // Assign
        const res = await fetch(`/api/services/${serviceId}/employee-assignments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId }),
        });
        const data = await res.json();
        if (data.success) {
          setAssignedEmployeeIds((prev) => new Set([...prev, employeeId]));
          const emp = allEmployees.find((e) => e.id === employeeId);
          toast.success(
            `${emp ? `${emp.firstName} ${emp.lastName}` : "Pracownik"} przypisany do uslugi`
          );
        } else {
          toast.error(data.error || "Nie udalo sie przypisac pracownika");
        }
      }
    } catch {
      toast.error("Blad podczas zmiany przypisania pracownika");
    } finally {
      setTogglingAssignment(null);
    }
  };

  const clearVariantError = (field: string) => {
    setVariantErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const resetVariantForm = () => {
    setVariantName("");
    setVariantPriceModifier("0");
    setVariantDurationModifier("0");
    setEditingVariant(null);
    setVariantErrors({});
  };

  const openEditVariant = (variant: ServiceVariant) => {
    setEditingVariant(variant);
    setVariantName(variant.name);
    setVariantPriceModifier(variant.priceModifier);
    setVariantDurationModifier(variant.durationModifier.toString());
    setVariantDialogOpen(true);
  };

  const handleSaveVariant = async () => {
    const errors: Record<string, string> = {};
    if (!variantName.trim()) {
      errors.variantName = "Wpisz nazwe wariantu, np. Krotkie wlosy";
    }
    if (variantPriceModifier && isNaN(Number(variantPriceModifier))) {
      errors.variantPriceModifier = "Modyfikator ceny musi byc liczba, np. 10.00 lub -5.00";
    }
    if (variantDurationModifier && isNaN(Number(variantDurationModifier))) {
      errors.variantDurationModifier = "Modyfikator czasu musi byc liczba minut, np. 15 lub -10";
    }
    setVariantErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Popraw zaznaczone pola formularza");
      return;
    }

    setSavingVariant(true);
    try {
      const url = editingVariant
        ? `/api/services/${serviceId}/variants/${editingVariant.id}`
        : `/api/services/${serviceId}/variants`;

      const method = editingVariant ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: variantName.trim(),
          priceModifier: parseFloat(variantPriceModifier) || 0,
          durationModifier: parseInt(variantDurationModifier, 10) || 0,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(
          editingVariant
            ? `Wariant "${variantName}" zaktualizowany`
            : `Wariant "${variantName}" dodany`
        );
        resetVariantForm();
        setVariantDialogOpen(false);
        await fetchService();
      } else {
        toast.error(data.error || "Nie udalo sie zapisac wariantu");
      }
    } catch {
      toast.error("Blad podczas zapisywania wariantu");
    } finally {
      setSavingVariant(false);
    }
  };

  const handleDeleteVariant = async (variant: ServiceVariant) => {
    if (!confirm(`Czy na pewno chcesz usunac wariant "${variant.name}"?`)) {
      return;
    }

    try {
      const res = await fetch(
        `/api/services/${serviceId}/variants/${variant.id}`,
        { method: "DELETE" }
      );

      const data = await res.json();

      if (data.success) {
        toast.success(`Wariant "${variant.name}" usuniety`);
        await fetchService();
      } else {
        toast.error(data.error || "Nie udalo sie usunac wariantu");
      }
    } catch {
      toast.error("Blad podczas usuwania wariantu");
    }
  };

  // Edit service handlers
  const clearEditServiceError = (field: string) => {
    setEditServiceErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const openEditServiceDialog = () => {
    if (!service) return;
    setEditServiceName(service.name);
    setEditServiceDescription(service.description || "");
    setEditServicePrice(parseFloat(service.basePrice).toString());
    setEditServiceDuration(service.baseDuration.toString());
    setEditServiceIsActive(service.isActive);
    setEditServiceErrors({});
    setEditServiceDialogOpen(true);
  };

  const handleSaveService = async () => {
    const errors: Record<string, string> = {};
    if (!editServiceName.trim()) {
      errors.name = "Wpisz nazwe uslugi, np. Strzyzenie damskie";
    }
    if (!editServicePrice || parseFloat(editServicePrice) < 0) {
      errors.price = "Podaj cene bazowa w PLN (wartosc >= 0), np. 50.00";
    }
    if (!editServiceDuration || parseInt(editServiceDuration, 10) <= 0) {
      errors.duration = "Podaj czas trwania w minutach (> 0), np. 30";
    }
    setEditServiceErrors(errors);
    if (Object.keys(errors).length > 0) {
      toast.error("Popraw zaznaczone pola formularza");
      return;
    }

    setSavingService(true);
    try {
      const res = await fetch(`/api/services/${serviceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editServiceName.trim(),
          description: editServiceDescription.trim() || null,
          basePrice: parseFloat(editServicePrice),
          baseDuration: parseInt(editServiceDuration, 10),
          isActive: editServiceIsActive,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(`Usluga "${editServiceName.trim()}" zaktualizowana`);
        setEditServiceDialogOpen(false);
        await fetchService();
      } else {
        toast.error(data.error || "Nie udalo sie zapisac uslugi");
      }
    } catch {
      toast.error("Blad podczas zapisywania uslugi");
    } finally {
      setSavingService(false);
    }
  };

  // Delete service handler
  const handleDeleteService = async () => {
    setDeletingService(true);
    try {
      const res = await fetch(`/api/services/${serviceId}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (data.success) {
        toast.success(`Usluga "${service?.name}" zostala usunieta`);
        router.replace("/dashboard/services");
      } else {
        toast.error(data.error || "Nie udalo sie usunac uslugi");
      }
    } catch {
      toast.error("Blad podczas usuwania uslugi");
    } finally {
      setDeletingService(false);
      setDeleteDialogOpen(false);
    }
  };

  // AI description generation handler
  const handleGenerateDescription = async () => {
    if (!service) return;
    setGeneratingDescription(true);
    try {
      const res = await fetch("/api/ai/content/generate-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceName: editServiceName || service.name,
          categoryName: service.category?.name || undefined,
          basePrice: parseFloat(editServicePrice || service.basePrice),
          baseDuration: parseInt(editServiceDuration || service.baseDuration.toString(), 10),
        }),
      });

      const data = await res.json();

      if (res.status === 403 && data.code === "PLAN_UPGRADE_REQUIRED") {
        toast.error("Generowanie opisow AI wymaga Planu Pro");
        return;
      }

      if (!res.ok || !data.success) {
        toast.error(data.error || "Nie udalo sie wygenerowac opisu");
        return;
      }

      setEditServiceDescription(data.description);
      toast.success("Opis wygenerowany przez AI");
    } catch {
      toast.error("Blad podczas generowania opisu AI");
    } finally {
      setGeneratingDescription(false);
    }
  };

  // Employee pricing handlers
  const resetEmpPriceForm = () => {
    setEmpPriceEmployeeId("");
    setEmpPriceCustomPrice("");
  };

  const handleSaveEmployeePrice = async () => {
    if (!empPriceEmployeeId) {
      toast.error("Wybierz pracownika");
      return;
    }
    if (!empPriceCustomPrice) {
      toast.error("Cena jest wymagana");
      return;
    }
    if (isNaN(Number(empPriceCustomPrice)) || isNaN(parseFloat(empPriceCustomPrice))) {
      toast.error("Cena musi byc liczba");
      return;
    }
    if (parseFloat(empPriceCustomPrice) < 0) {
      toast.error("Cena nie moze byc ujemna");
      return;
    }

    setSavingEmpPrice(true);
    try {
      const res = await fetch(`/api/services/${serviceId}/employee-prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: empPriceEmployeeId,
          customPrice: empPriceCustomPrice,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const employee = allEmployees.find((e) => e.id === empPriceEmployeeId);
        const empName = employee
          ? `${employee.firstName} ${employee.lastName}`
          : "pracownika";
        toast.success(
          data.updated
            ? `Cena dla ${empName} zaktualizowana`
            : `Cena dla ${empName} ustawiona`
        );
        resetEmpPriceForm();
        setEmpPriceDialogOpen(false);
        await fetchEmployeePrices();
      } else {
        toast.error(data.error || "Nie udalo sie zapisac ceny");
      }
    } catch {
      toast.error("Blad podczas zapisywania ceny pracownika");
    } finally {
      setSavingEmpPrice(false);
    }
  };

  const handleDeleteEmployeePrice = async (price: EmployeePrice) => {
    const empName = price.employee
      ? `${price.employee.firstName} ${price.employee.lastName}`
      : "tego pracownika";

    if (!confirm(`Czy na pewno chcesz usunac indywidualna cene dla ${empName}?`)) {
      return;
    }

    try {
      const res = await fetch(
        `/api/services/${serviceId}/employee-prices?priceId=${price.id}`,
        { method: "DELETE" }
      );

      const data = await res.json();

      if (data.success) {
        toast.success(`Indywidualna cena dla ${empName} usunieta`);
        await fetchEmployeePrices();
      } else {
        toast.error(data.error || "Nie udalo sie usunac ceny");
      }
    } catch {
      toast.error("Blad podczas usuwania ceny pracownika");
    }
  };

  // Service product link handlers
  const resetProductLinkForm = () => {
    setProductLinkProductId("");
    setProductLinkQuantity("1");
  };

  const handleSaveProductLink = async () => {
    if (!productLinkProductId) {
      toast.error("Wybierz produkt");
      return;
    }
    if (!productLinkQuantity || parseFloat(productLinkQuantity) <= 0) {
      toast.error("Podaj prawidlowa ilosc");
      return;
    }

    setSavingProductLink(true);
    try {
      const res = await fetch(`/api/services/${serviceId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: productLinkProductId,
          defaultQuantity: parseFloat(productLinkQuantity),
        }),
      });

      const data = await res.json();

      if (data.success) {
        const product = allProducts.find((p) => p.id === productLinkProductId);
        const productName = product ? product.name : "produkt";
        toast.success(
          data.updated
            ? `Ilosc dla "${productName}" zaktualizowana`
            : `Produkt "${productName}" powiazany z usluga`
        );
        resetProductLinkForm();
        setProductLinkDialogOpen(false);
        await fetchServiceProductLinks();
      } else {
        toast.error(data.error || "Nie udalo sie powiazac produktu");
      }
    } catch {
      toast.error("Blad podczas wiazania produktu z usluga");
    } finally {
      setSavingProductLink(false);
    }
  };

  const handleDeleteProductLink = async (link: ServiceProductLink) => {
    const productName = link.productName || "ten produkt";

    if (!confirm(`Czy na pewno chcesz usunac powiazanie z "${productName}"?`)) {
      return;
    }

    try {
      const res = await fetch(
        `/api/services/${serviceId}/products?linkId=${link.id}`,
        { method: "DELETE" }
      );

      const data = await res.json();

      if (data.success) {
        toast.success(`Powiazanie z "${productName}" usuniete`);
        await fetchServiceProductLinks();
      } else {
        toast.error(data.error || "Nie udalo sie usunac powiazania");
      }
    } catch {
      toast.error("Blad podczas usuwania powiazania");
    }
  };

  const formatPrice = (price: string) => {
    return parseFloat(price).toFixed(2);
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hrs}h ${mins}min` : `${hrs}h`;
  };

  const formatModifier = (value: string | number, prefix: string = "", suffix: string = "") => {
    const num = typeof value === "string" ? parseFloat(value) : value;
    if (num === 0) return `${prefix}0${suffix}`;
    return num > 0 ? `${prefix}+${num}${suffix}` : `${prefix}${num}${suffix}`;
  };

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
            Musisz sie zalogowac, aby zarzadzac uslugami
          </p>
        </div>
      </div>
    );
  }

  if (!service) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <p className="text-muted-foreground">Nie znaleziono uslugi</p>
      </div>
    );
  }

  // Get employees that don't already have custom pricing (for the "add" dialog)
  const employeesWithoutCustomPrice = allEmployees.filter(
    (emp) => !employeePrices.some((ep) => ep.employeeId === emp.id && !ep.variantId)
  );

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push("/dashboard/services")}
          data-testid="back-to-services-btn"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3 flex-1">
          <Scissors className="w-8 h-8 text-primary" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold" data-testid="service-name">
                {service.name}
              </h1>
              <Badge variant={service.isActive ? "default" : "secondary"}>
                {service.isActive ? "Aktywna" : "Nieaktywna"}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                onClick={openEditServiceDialog}
                data-testid="edit-service-btn"
              >
                <Edit2 className="h-4 w-4" />
              </Button>
              <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    data-testid="delete-service-btn"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Usunac usluge?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Czy na pewno chcesz usunac usluge &quot;{service.name}&quot;?
                      Ta operacja jest nieodwracalna. Zostan rowniez usuniete
                      wszystkie warianty, przypisania pracownikow i indywidualne ceny
                      powiazane z ta usluga. Istniejace wizyty zachowaja swoja historie.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="cancel-delete-btn">
                      Anuluj
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteService}
                      disabled={deletingService}
                      className="bg-destructive text-white hover:bg-destructive/90"
                      data-testid="confirm-delete-btn"
                    >
                      {deletingService ? "Usuwanie..." : "Usun usluge"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            {service.category && (
              <Badge variant="outline" className="mt-1">
                {service.category.name}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Service Details */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Szczegoly uslugi</CardTitle>
        </CardHeader>
        <CardContent>
          {service.description && (
            <p className="text-muted-foreground mb-4">{service.description}</p>
          )}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium" data-testid="service-base-price">
                {formatPrice(service.basePrice)} PLN
              </span>
              <span className="text-sm text-muted-foreground">(cena bazowa)</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium" data-testid="service-base-duration">
                {formatDuration(service.baseDuration)}
              </span>
              <span className="text-sm text-muted-foreground">(czas bazowy)</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Variants Section */}
      <Card className="mb-6" data-testid="variants-section">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Warianty uslugi</CardTitle>
            <Badge variant="outline" data-testid="variants-count">
              {service.variants.length}
            </Badge>
          </div>
          <Dialog
            open={variantDialogOpen}
            onOpenChange={(open) => {
              setVariantDialogOpen(open);
              if (!open) resetVariantForm();
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" data-testid="add-variant-btn">
                <Plus className="h-4 w-4 mr-2" />
                Dodaj wariant
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[450px]">
              <DialogHeader>
                <DialogTitle>
                  {editingVariant ? "Edytuj wariant" : "Dodaj nowy wariant"}
                </DialogTitle>
                <DialogDescription>
                  {editingVariant
                    ? "Zmien szczegoly wariantu uslugi."
                    : "Dodaj wariant uslugi, np. 'Krotkie wlosy', 'Dlugie wlosy'."}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="variant-name">Nazwa wariantu *</Label>
                  <Input
                    id="variant-name"
                    placeholder="np. Krotkie wlosy"
                    value={variantName}
                    onChange={(e) => {
                      setVariantName(e.target.value);
                      if (e.target.value.trim()) clearVariantError("variantName");
                    }}
                    aria-invalid={!!variantErrors.variantName}
                    className={variantErrors.variantName ? "border-destructive" : ""}
                    data-testid="variant-name-input"
                  />
                  {variantErrors.variantName && (
                    <p className="text-sm text-destructive" data-testid="error-variant-name">
                      {variantErrors.variantName}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="variant-price-modifier">
                      Modyfikator ceny (PLN)
                    </Label>
                    <Input
                      id="variant-price-modifier"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={variantPriceModifier}
                      onChange={(e) => {
                        setVariantPriceModifier(e.target.value);
                        const val = e.target.value;
                        if (val === "" || !isNaN(Number(val))) {
                          setVariantErrors((prev) => {
                            const next = { ...prev };
                            delete next.variantPriceModifier;
                            return next;
                          });
                        } else {
                          setVariantErrors((prev) => ({ ...prev, variantPriceModifier: "Modyfikator ceny musi byc liczba" }));
                        }
                      }}
                      onKeyDown={(e) => {
                        if (
                          !/[0-9]/.test(e.key) &&
                          !["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", ".", ",", "-"].includes(e.key) &&
                          !e.ctrlKey && !e.metaKey
                        ) {
                          e.preventDefault();
                        }
                      }}
                      aria-invalid={!!variantErrors.variantPriceModifier}
                      className={variantErrors.variantPriceModifier ? "border-destructive" : ""}
                      data-testid="variant-price-modifier-input"
                    />
                    {variantErrors.variantPriceModifier && (
                      <p className="text-sm text-destructive">{variantErrors.variantPriceModifier}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Dodatnia wartosc podwyzsza cene, ujemna obniza
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="variant-duration-modifier">
                      Modyfikator czasu (min)
                    </Label>
                    <Input
                      id="variant-duration-modifier"
                      type="number"
                      step="5"
                      placeholder="0"
                      value={variantDurationModifier}
                      onChange={(e) => {
                        setVariantDurationModifier(e.target.value);
                        const val = e.target.value;
                        if (val === "" || !isNaN(Number(val))) {
                          setVariantErrors((prev) => {
                            const next = { ...prev };
                            delete next.variantDurationModifier;
                            return next;
                          });
                        } else {
                          setVariantErrors((prev) => ({ ...prev, variantDurationModifier: "Modyfikator czasu musi byc liczba" }));
                        }
                      }}
                      onKeyDown={(e) => {
                        if (
                          !/[0-9]/.test(e.key) &&
                          !["Backspace", "Delete", "Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "-"].includes(e.key) &&
                          !e.ctrlKey && !e.metaKey
                        ) {
                          e.preventDefault();
                        }
                      }}
                      aria-invalid={!!variantErrors.variantDurationModifier}
                      className={variantErrors.variantDurationModifier ? "border-destructive" : ""}
                      data-testid="variant-duration-modifier-input"
                    />
                    <p className="text-xs text-muted-foreground">
                      Dodatnia wartosc wydluza czas, ujemna skraca
                    </p>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    resetVariantForm();
                    setVariantDialogOpen(false);
                  }}
                >
                  Anuluj
                </Button>
                <Button
                  onClick={handleSaveVariant}
                  disabled={savingVariant}
                  data-testid="save-variant-btn"
                >
                  {savingVariant
                    ? "Zapisywanie..."
                    : editingVariant
                    ? "Zapisz zmiany"
                    : "Dodaj wariant"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {service.variants.length === 0 ? (
            <div className="text-center py-8">
              <Layers className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4" data-testid="no-variants-message">
                Brak wariantow. Dodaj warianty, np. &quot;Krotkie wlosy&quot;,
                &quot;Srednie wlosy&quot;, &quot;Dlugie wlosy&quot;.
              </p>
              <Button
                variant="outline"
                onClick={() => setVariantDialogOpen(true)}
                data-testid="empty-state-add-variant-btn"
              >
                <Plus className="h-4 w-4 mr-2" />
                Dodaj pierwszy wariant
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {service.variants.map((variant) => {
                const finalPrice =
                  parseFloat(service.basePrice) +
                  parseFloat(variant.priceModifier);
                const finalDuration =
                  service.baseDuration + variant.durationModifier;

                return (
                  <div
                    key={variant.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    data-testid={`variant-card-${variant.id}`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium" data-testid={`variant-name-${variant.id}`}>
                          {variant.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3.5 w-3.5" />
                          <span data-testid={`variant-price-${variant.id}`}>
                            {formatPrice(finalPrice.toString())} PLN
                          </span>
                          <span className="text-xs">
                            ({formatModifier(variant.priceModifier, "", " PLN")})
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          <span data-testid={`variant-duration-${variant.id}`}>
                            {formatDuration(finalDuration)}
                          </span>
                          <span className="text-xs">
                            ({formatModifier(variant.durationModifier, "", " min")})
                          </span>
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditVariant(variant)}
                        data-testid={`edit-variant-${variant.id}`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteVariant(variant)}
                        data-testid={`delete-variant-${variant.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Employee Assignment Section */}
      <Card className="mb-6" data-testid="employee-assignment-section">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Przypisani pracownicy</CardTitle>
            <Badge variant="outline" data-testid="assigned-employees-count">
              {assignedEmployeeIds.size}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Zaznacz pracownikow, ktorzy oferuja ta usluge. Tylko przypisani pracownicy beda dostepni podczas rezerwacji.
          </p>
        </CardHeader>
        <CardContent>
          {allEmployees.length === 0 ? (
            <div className="text-center py-8">
              <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground" data-testid="no-employees-message">
                Brak pracownikow w salonie. Dodaj pracownikow, aby moc ich przypisac do uslug.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {allEmployees.map((emp) => {
                const isAssigned = assignedEmployeeIds.has(emp.id);
                const isToggling = togglingAssignment === emp.id;
                return (
                  <div
                    key={emp.id}
                    className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${
                      isAssigned ? "bg-primary/5 border-primary/30" : "hover:bg-muted/50"
                    } ${isToggling ? "opacity-60" : ""}`}
                    data-testid={`employee-assignment-${emp.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id={`assign-emp-${emp.id}`}
                        checked={isAssigned}
                        disabled={isToggling}
                        onCheckedChange={() =>
                          handleToggleEmployeeAssignment(emp.id, isAssigned)
                        }
                        data-testid={`assign-checkbox-${emp.id}`}
                      />
                      <label
                        htmlFor={`assign-emp-${emp.id}`}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        {emp.color && (
                          <span
                            className="inline-block w-3 h-3 rounded-full"
                            style={{ backgroundColor: emp.color }}
                          />
                        )}
                        <span className="font-medium">
                          {emp.firstName} {emp.lastName}
                        </span>
                        {emp.role === "owner" && (
                          <Badge variant="outline" className="text-xs">
                            wlasciciel
                          </Badge>
                        )}
                      </label>
                    </div>
                    <div>
                      {isAssigned && (
                        <Badge variant="default" className="text-xs" data-testid={`assigned-badge-${emp.id}`}>
                          Przypisany
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Employee-Specific Pricing Section */}
      <Card data-testid="employee-pricing-section">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Ceny indywidualne pracownikow</CardTitle>
            <Badge variant="outline" data-testid="employee-prices-count">
              {employeePrices.length}
            </Badge>
          </div>
          <Dialog
            open={empPriceDialogOpen}
            onOpenChange={(open) => {
              setEmpPriceDialogOpen(open);
              if (!open) resetEmpPriceForm();
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" data-testid="add-employee-price-btn">
                <Plus className="h-4 w-4 mr-2" />
                Ustaw cene
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[450px]">
              <DialogHeader>
                <DialogTitle>Ustaw cene indywidualna</DialogTitle>
                <DialogDescription>
                  Ustaw indywidualna cene za ta usluge dla wybranego pracownika.
                  Cena ta bedzie wyswietlana zamiast ceny bazowej przy rezerwacji
                  wizyty u tego pracownika.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="emp-price-employee">Pracownik *</Label>
                  <Select
                    value={empPriceEmployeeId}
                    onValueChange={setEmpPriceEmployeeId}
                  >
                    <SelectTrigger
                      id="emp-price-employee"
                      data-testid="employee-price-select"
                    >
                      <SelectValue placeholder="Wybierz pracownika" />
                    </SelectTrigger>
                    <SelectContent>
                      {employeesWithoutCustomPrice.length === 0 ? (
                        <SelectItem value="__none" disabled>
                          Wszyscy pracownicy maja juz ceny
                        </SelectItem>
                      ) : (
                        employeesWithoutCustomPrice.map((emp) => (
                          <SelectItem key={emp.id} value={emp.id}>
                            <div className="flex items-center gap-2">
                              {emp.color && (
                                <span
                                  className="inline-block w-3 h-3 rounded-full"
                                  style={{ backgroundColor: emp.color }}
                                />
                              )}
                              {emp.firstName} {emp.lastName}
                              {emp.role === "owner" && (
                                <span className="text-xs text-muted-foreground">(wlasciciel)</span>
                              )}
                            </div>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="emp-price-value">Cena indywidualna (PLN) *</Label>
                  <Input
                    id="emp-price-value"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={service.basePrice}
                    value={empPriceCustomPrice}
                    onChange={(e) => setEmpPriceCustomPrice(e.target.value)}
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
                    data-testid="employee-price-input"
                  />
                  <p className="text-xs text-muted-foreground">
                    Cena bazowa uslugi: {formatPrice(service.basePrice)} PLN.
                    Wprowadz cene, ktora zamiast niej bedzie stosowana dla tego
                    pracownika.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    resetEmpPriceForm();
                    setEmpPriceDialogOpen(false);
                  }}
                >
                  Anuluj
                </Button>
                <Button
                  onClick={handleSaveEmployeePrice}
                  disabled={savingEmpPrice}
                  data-testid="save-employee-price-btn"
                >
                  {savingEmpPrice ? "Zapisywanie..." : "Zapisz cene"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {employeePrices.length === 0 ? (
            <div className="text-center py-8">
              <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4" data-testid="no-employee-prices-message">
                Brak indywidualnych cen. Wszyscy pracownicy stosuja cene bazowa (
                {formatPrice(service.basePrice)} PLN).
              </p>
              <Button
                variant="outline"
                onClick={() => setEmpPriceDialogOpen(true)}
                data-testid="empty-state-add-employee-price-btn"
              >
                <Plus className="h-4 w-4 mr-2" />
                Ustaw pierwsza cene indywidualna
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {employeePrices.map((ep) => {
                const basePrice = parseFloat(service.basePrice);
                const customPrice = parseFloat(ep.customPrice);
                const diff = customPrice - basePrice;
                const diffPercent = basePrice > 0 ? ((diff / basePrice) * 100).toFixed(0) : "0";

                return (
                  <div
                    key={ep.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    data-testid={`employee-price-card-${ep.id}`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {ep.employee?.color && (
                          <span
                            className="inline-block w-3 h-3 rounded-full"
                            style={{ backgroundColor: ep.employee.color }}
                          />
                        )}
                        <span className="font-medium" data-testid={`employee-price-name-${ep.id}`}>
                          {ep.employee
                            ? `${ep.employee.firstName} ${ep.employee.lastName}`
                            : "Nieznany pracownik"}
                        </span>
                        {ep.employee?.role === "owner" && (
                          <Badge variant="outline" className="text-xs">
                            wlasciciel
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3.5 w-3.5" />
                          <span
                            className="font-medium text-foreground"
                            data-testid={`employee-price-value-${ep.id}`}
                          >
                            {formatPrice(ep.customPrice)} PLN
                          </span>
                        </span>
                        <span
                          className={`text-xs ${
                            diff > 0
                              ? "text-red-500"
                              : diff < 0
                              ? "text-green-500"
                              : "text-muted-foreground"
                          }`}
                          data-testid={`employee-price-diff-${ep.id}`}
                        >
                          {diff > 0 ? "+" : ""}
                          {diff.toFixed(2)} PLN ({diff >= 0 ? "+" : ""}
                          {diffPercent}% od ceny bazowej)
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteEmployeePrice(ep)}
                        data-testid={`delete-employee-price-${ep.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked Products Section (Auto-deduction) */}
      <Card className="mt-6" data-testid="service-products-section">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Powiazane produkty</CardTitle>
            <Badge variant="outline" data-testid="service-products-count">
              {serviceProductLinks.length}
            </Badge>
          </div>
          <Dialog
            open={productLinkDialogOpen}
            onOpenChange={(open) => {
              setProductLinkDialogOpen(open);
              if (!open) resetProductLinkForm();
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" data-testid="add-product-link-btn">
                <Plus className="h-4 w-4 mr-2" />
                Dodaj produkt
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[450px]">
              <DialogHeader>
                <DialogTitle>Powiaz produkt z usluga</DialogTitle>
                <DialogDescription>
                  Po zakonczeniu wizyty z ta usluga, powiazane produkty zostana
                  automatycznie odliczone z magazynu o podana ilosc.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="product-link-product">Produkt *</Label>
                  <Select
                    value={productLinkProductId}
                    onValueChange={setProductLinkProductId}
                  >
                    <SelectTrigger
                      id="product-link-product"
                      data-testid="product-link-select"
                    >
                      <SelectValue placeholder="Wybierz produkt" />
                    </SelectTrigger>
                    <SelectContent>
                      {allProducts.length === 0 ? (
                        <SelectItem value="__none" disabled>
                          Brak produktow w magazynie
                        </SelectItem>
                      ) : (
                        allProducts.map((prod) => (
                          <SelectItem key={prod.id} value={prod.id}>
                            <div className="flex items-center gap-2">
                              <span>{prod.name}</span>
                              {prod.unit && (
                                <span className="text-xs text-muted-foreground">
                                  ({prod.unit})
                                </span>
                              )}
                              {prod.category && (
                                <span className="text-xs text-muted-foreground">
                                  [{prod.category}]
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="product-link-quantity">
                    Ilosc do odliczenia *
                  </Label>
                  <Input
                    id="product-link-quantity"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="1"
                    value={productLinkQuantity}
                    onChange={(e) => setProductLinkQuantity(e.target.value)}
                    data-testid="product-link-quantity-input"
                  />
                  <p className="text-xs text-muted-foreground">
                    Ile jednostek produktu zostanie automatycznie odliczone
                    z magazynu po zakonczeniu wizyty.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    resetProductLinkForm();
                    setProductLinkDialogOpen(false);
                  }}
                >
                  Anuluj
                </Button>
                <Button
                  onClick={handleSaveProductLink}
                  disabled={savingProductLink}
                  data-testid="save-product-link-btn"
                >
                  {savingProductLink ? "Zapisywanie..." : "Powiaz produkt"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Produkty powiazane z usluga sa automatycznie odliczane z magazynu po zakonczeniu wizyty.
          </p>
          {serviceProductLinks.length === 0 ? (
            <div className="text-center py-8">
              <Package className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4" data-testid="no-product-links-message">
                Brak powiazanych produktow. Dodaj produkty, ktore beda automatycznie
                odliczane z magazynu po zakonczeniu wizyty z ta usluga.
              </p>
              <Button
                variant="outline"
                onClick={() => setProductLinkDialogOpen(true)}
                data-testid="empty-state-add-product-link-btn"
              >
                <Plus className="h-4 w-4 mr-2" />
                Powiaz pierwszy produkt
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {serviceProductLinks.map((link) => {
                const currentQty = parseFloat(link.productQuantity || "0");
                const deductQty = parseFloat(link.defaultQuantity || "0");
                const minQty = link.productMinQuantity ? parseFloat(link.productMinQuantity) : null;
                const isLowStock = minQty !== null && currentQty <= minQty;

                return (
                  <div
                    key={link.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                    data-testid={`product-link-card-${link.id}`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium" data-testid={`product-link-name-${link.id}`}>
                          {link.productName || "Usuniety produkt"}
                        </span>
                        {link.productCategory && (
                          <Badge variant="outline" className="text-xs">
                            {link.productCategory}
                          </Badge>
                        )}
                        {isLowStock && (
                          <Badge variant="destructive" className="text-xs">
                            Niski stan
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span data-testid={`product-link-deduct-${link.id}`}>
                          Odliczenie: <span className="font-medium text-foreground">{deductQty}</span>{" "}
                          {link.productUnit || "szt."} / wizyta
                        </span>
                        <span data-testid={`product-link-stock-${link.id}`}>
                          Stan: <span className={`font-medium ${isLowStock ? "text-destructive" : "text-foreground"}`}>
                            {currentQty}
                          </span>{" "}
                          {link.productUnit || "szt."}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteProductLink(link)}
                        data-testid={`delete-product-link-${link.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gallery Photos Section */}
      <Card className="mt-6" data-testid="service-gallery-section">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Galeria zdjec</CardTitle>
            <Badge variant="outline" data-testid="gallery-photos-count">
              {galleryPhotos.length}
            </Badge>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link href={`/dashboard/gallery`}>
              <ImageIcon className="h-4 w-4 mr-2" />
              Otworz galerie
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {galleryPhotos.length === 0 ? (
            <div className="text-center py-8">
              <ImageIcon className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-2" data-testid="no-gallery-photos-message">
                Brak zdjec powiazanych z ta usluga.
              </p>
              <p className="text-xs text-muted-foreground">
                Dodaj zdjecia w galerii i oznacz je ta usluga, aby sie tutaj pojawily.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {galleryPhotos.map((photo) => (
                <div
                  key={photo.id}
                  className="relative group border rounded-lg overflow-hidden"
                  data-testid={`service-gallery-photo-${photo.id}`}
                >
                  <div className="aspect-square relative">
                    {photo.afterPhotoUrl ? (
                      <Image
                        src={photo.afterPhotoUrl}
                        alt={photo.description || "Zdjecie uslugi"}
                        fill
                        className="object-cover"
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      />
                    ) : photo.beforePhotoUrl ? (
                      <Image
                        src={photo.beforePhotoUrl}
                        alt={photo.description || "Zdjecie uslugi"}
                        fill
                        className="object-cover"
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted">
                        <ImageIcon className="w-8 h-8 text-muted-foreground" />
                      </div>
                    )}
                    {/* Before/After badge */}
                    {photo.beforePhotoUrl && photo.afterPhotoUrl && (
                      <div className="absolute top-1 left-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                        Przed / Po
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    {photo.employeeFirstName && (
                      <p className="text-xs font-medium truncate">
                        {photo.employeeFirstName} {photo.employeeLastName}
                      </p>
                    )}
                    {photo.description && (
                      <p className="text-xs text-muted-foreground truncate">
                        {photo.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Service Dialog */}
      <Dialog
        open={editServiceDialogOpen}
        onOpenChange={(open) => {
          setEditServiceDialogOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edytuj usluge</DialogTitle>
            <DialogDescription>
              Zmien szczegoly uslugi. Pola oznaczone * sa wymagane.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-service-name">Nazwa uslugi *</Label>
              <Input
                id="edit-service-name"
                placeholder="np. Strzyzenie meskie"
                value={editServiceName}
                onChange={(e) => {
                  setEditServiceName(e.target.value);
                  if (e.target.value.trim()) clearEditServiceError("name");
                }}
                aria-invalid={!!editServiceErrors.name}
                className={editServiceErrors.name ? "border-destructive" : ""}
                data-testid="edit-service-name-input"
              />
              {editServiceErrors.name && (
                <p className="text-sm text-destructive" data-testid="error-edit-service-name">
                  {editServiceErrors.name}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-service-description">Opis</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateDescription}
                  disabled={generatingDescription || !editServiceName.trim()}
                  data-testid="generate-description-btn"
                  className="text-xs gap-1.5"
                >
                  {generatingDescription ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Generowanie...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      Generuj opis AI
                    </>
                  )}
                </Button>
              </div>
              <Textarea
                id="edit-service-description"
                placeholder="Opis uslugi (opcjonalny) - uzyj AI, aby wygenerowac profesjonalny opis"
                value={editServiceDescription}
                onChange={(e) => setEditServiceDescription(e.target.value)}
                data-testid="edit-service-description-input"
                rows={4}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-service-price">Cena bazowa (PLN) *</Label>
                <Input
                  id="edit-service-price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={editServicePrice}
                  onChange={(e) => {
                    setEditServicePrice(e.target.value);
                    if (e.target.value && parseFloat(e.target.value) >= 0) clearEditServiceError("price");
                  }}
                  aria-invalid={!!editServiceErrors.price}
                  className={editServiceErrors.price ? "border-destructive" : ""}
                  data-testid="edit-service-price-input"
                />
                {editServiceErrors.price && (
                  <p className="text-sm text-destructive" data-testid="error-edit-service-price">
                    {editServiceErrors.price}
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-service-duration">Czas trwania (min) *</Label>
                <Input
                  id="edit-service-duration"
                  type="number"
                  min="1"
                  step="5"
                  placeholder="30"
                  value={editServiceDuration}
                  onChange={(e) => {
                    setEditServiceDuration(e.target.value);
                    if (e.target.value && parseInt(e.target.value, 10) > 0) clearEditServiceError("duration");
                  }}
                  aria-invalid={!!editServiceErrors.duration}
                  className={editServiceErrors.duration ? "border-destructive" : ""}
                  data-testid="edit-service-duration-input"
                />
                {editServiceErrors.duration && (
                  <p className="text-sm text-destructive" data-testid="error-edit-service-duration">
                    {editServiceErrors.duration}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-service-active"
                checked={editServiceIsActive}
                onCheckedChange={(checked) => setEditServiceIsActive(checked)}
              />
              <Label htmlFor="edit-service-active" className="cursor-pointer">
                Usluga aktywna
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditServiceDialogOpen(false)}
            >
              Anuluj
            </Button>
            <Button
              onClick={handleSaveService}
              disabled={savingService}
              data-testid="save-service-edit-btn"
            >
              {savingService ? "Zapisywanie..." : "Zapisz zmiany"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
