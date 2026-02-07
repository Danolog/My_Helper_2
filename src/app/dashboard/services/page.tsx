"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Lock, Scissors, Plus, Clock, DollarSign, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

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
  const router = useRouter();
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategoryId, setFormCategoryId] = useState<string>("");
  const [formPrice, setFormPrice] = useState("");
  const [formDuration, setFormDuration] = useState("");

  const fetchServices = useCallback(async () => {
    try {
      const res = await fetch(`/api/services?salonId=${DEMO_SALON_ID}`);
      const data = await res.json();
      if (data.success) {
        setServices(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch services:", error);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/service-categories?salonId=${DEMO_SALON_ID}`
      );
      const data = await res.json();
      if (data.success) {
        setCategories(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch categories:", error);
    }
  }, []);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      await Promise.all([fetchServices(), fetchCategories()]);
      setLoading(false);
    }
    loadData();
  }, [fetchServices, fetchCategories]);

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setFormCategoryId("");
    setFormPrice("");
    setFormDuration("");
  };

  const handleSaveService = async () => {
    // Validation
    if (!formName.trim()) {
      toast.error("Nazwa uslugi jest wymagana");
      return;
    }
    if (!formPrice || parseFloat(formPrice) < 0) {
      toast.error("Podaj prawidlowa cene");
      return;
    }
    if (!formDuration || parseInt(formDuration, 10) <= 0) {
      toast.error("Podaj prawidlowy czas trwania");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salonId: DEMO_SALON_ID,
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
        resetForm();
        setDialogOpen(false);
        await fetchServices();
      } else {
        toast.error(data.error || "Nie udalo sie dodac uslugi");
      }
    } catch (error) {
      console.error("Failed to save service:", error);
      toast.error("Blad podczas zapisywania uslugi");
    } finally {
      setSaving(false);
    }
  };

  if (isPending) {
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
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="service-name">Nazwa uslugi *</Label>
                <Input
                  id="service-name"
                  placeholder="np. Strzyzenie meskie"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  data-testid="service-name-input"
                />
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
                        Brak kategorii
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
                    onChange={(e) => setFormPrice(e.target.value)}
                    data-testid="service-price-input"
                  />
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
                    onChange={(e) => setFormDuration(e.target.value)}
                    data-testid="service-duration-input"
                  />
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

      {loading ? (
        <div className="flex justify-center items-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : services.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Scissors className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              Brak uslug. Dodaj pierwsza usluge, aby rozpoczac.
            </p>
            <Button
              onClick={() => setDialogOpen(true)}
              data-testid="empty-state-add-btn"
            >
              <Plus className="h-4 w-4 mr-2" />
              Dodaj usluge
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {services.map((service) => (
            <Card
              key={service.id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              data-testid={`service-card-${service.id}`}
              onClick={() => router.push(`/dashboard/services/${service.id}`)}
            >
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-base">
                      {service.name}
                    </span>
                    <Badge
                      variant={service.isActive ? "default" : "secondary"}
                    >
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
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
