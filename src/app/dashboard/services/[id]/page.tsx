"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Lock,
  Scissors,
  Plus,
  Clock,
  DollarSign,
  ArrowLeft,
  Trash2,
  Edit2,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

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

export default function ServiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const serviceId = params.id as string;
  const { data: session, isPending } = useSession();
  const [service, setService] = useState<ServiceDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Variant form state
  const [variantDialogOpen, setVariantDialogOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ServiceVariant | null>(null);
  const [variantName, setVariantName] = useState("");
  const [variantPriceModifier, setVariantPriceModifier] = useState("0");
  const [variantDurationModifier, setVariantDurationModifier] = useState("0");
  const [savingVariant, setSavingVariant] = useState(false);

  const fetchService = useCallback(async () => {
    try {
      const res = await fetch(`/api/services/${serviceId}`);
      const data = await res.json();
      if (data.success) {
        setService(data.data);
      } else {
        toast.error("Nie znaleziono uslugi");
        router.push("/dashboard/services");
      }
    } catch (error) {
      console.error("Failed to fetch service:", error);
      toast.error("Blad podczas ladowania uslugi");
    } finally {
      setLoading(false);
    }
  }, [serviceId, router]);

  useEffect(() => {
    fetchService();
  }, [fetchService]);

  const resetVariantForm = () => {
    setVariantName("");
    setVariantPriceModifier("0");
    setVariantDurationModifier("0");
    setEditingVariant(null);
  };

  const openEditVariant = (variant: ServiceVariant) => {
    setEditingVariant(variant);
    setVariantName(variant.name);
    setVariantPriceModifier(variant.priceModifier);
    setVariantDurationModifier(variant.durationModifier.toString());
    setVariantDialogOpen(true);
  };

  const handleSaveVariant = async () => {
    if (!variantName.trim()) {
      toast.error("Nazwa wariantu jest wymagana");
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
    } catch (error) {
      console.error("Failed to save variant:", error);
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
    } catch (error) {
      console.error("Failed to delete variant:", error);
      toast.error("Blad podczas usuwania wariantu");
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
      <Card data-testid="variants-section">
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
                    onChange={(e) => setVariantName(e.target.value)}
                    data-testid="variant-name-input"
                  />
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
                      onChange={(e) => setVariantPriceModifier(e.target.value)}
                      data-testid="variant-price-modifier-input"
                    />
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
                      onChange={(e) => setVariantDurationModifier(e.target.value)}
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
    </div>
  );
}
