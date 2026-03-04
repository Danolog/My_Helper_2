"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import Link from "next/link";
import {
  Lock,
  Plus,
  Percent,
  Tag,
  Edit,
  Trash2,
  Calendar,
  DollarSign,
  Package,
  Gift,
  Scissors,
  Clock,
  UserPlus,
  Ticket,
} from "lucide-react";
import { toast } from "sonner";
import { useTabSync } from "@/hooks/use-tab-sync";
import { useFormRecovery } from "@/hooks/use-form-recovery";
import { FormRecoveryBanner } from "@/components/form-recovery-banner";
import { useSalonId } from "@/hooks/use-salon-id";

interface Promotion {
  id: string;
  salonId: string;
  name: string;
  type: string;
  value: string;
  startDate: string | null;
  endDate: string | null;
  conditionsJson: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

interface Service {
  id: string;
  name: string;
  basePrice: string;
  baseDuration: number;
  isActive: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  percentage: "Procentowa",
  fixed: "Kwotowa",
  package: "Pakiet",
  buy2get1: "2+1 gratis",
  happy_hours: "Happy Hours",
  first_visit: "Pierwsza wizyta",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  percentage: <Percent className="w-4 h-4" />,
  fixed: <DollarSign className="w-4 h-4" />,
  package: <Package className="w-4 h-4" />,
  buy2get1: <Gift className="w-4 h-4" />,
  happy_hours: <Clock className="w-4 h-4" />,
  first_visit: <UserPlus className="w-4 h-4" />,
};

const DAY_NAMES_PL = ["Nd", "Pn", "Wt", "Sr", "Cz", "Pt", "Sb"];
const DAY_FULL_NAMES_PL = ["Niedziela", "Poniedzialek", "Wtorek", "Sroda", "Czwartek", "Piatek", "Sobota"];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Brak";
  const d = new Date(dateStr);
  return d.toLocaleDateString("pl-PL", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatValue(type: string, value: string): string {
  const numVal = parseFloat(value);
  if (type === "percentage") return `${numVal}%`;
  if (type === "fixed") return `${numVal.toFixed(2)} PLN`;
  if (type === "buy2get1") return `${numVal}% zn. na 3.`;
  if (type === "happy_hours") return `-${numVal}%`;
  if (type === "first_visit") return `-${numVal}%`;
  if (type === "package") return `${numVal.toFixed(2)} PLN`;
  return value;
}

function isExpired(endDate: string | null): boolean {
  if (!endDate) return false;
  return new Date(endDate) < new Date();
}

function isUpcoming(startDate: string | null): boolean {
  if (!startDate) return false;
  return new Date(startDate) > new Date();
}

export default function PromotionsPage() {
  const { data: session, isPending } = useSession();
  const { salonId } = useSalonId();

  const [promotionsList, setPromotionsList] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [servicesList, setServicesList] = useState<Service[]>([]);

  // Create/Edit dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("percentage");
  const [formValue, setFormValue] = useState("");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);
  const [formSelectedServiceIds, setFormSelectedServiceIds] = useState<string[]>([]);
  const [formHappyHoursStart, setFormHappyHoursStart] = useState("14:00");
  const [formHappyHoursEnd, setFormHappyHoursEnd] = useState("16:00");
  const [formHappyHoursDays, setFormHappyHoursDays] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri
  const [saving, setSaving] = useState(false);
  const [formValueError, setFormValueError] = useState("");

  // Form recovery for promotion creation dialog
  const {
    wasRecovered: promoWasRecovered,
    getRecoveredState: getPromoRecoveredState,
    saveFormState: savePromoFormState,
    clearSavedForm: clearPromoSavedForm,
    setDirty: setPromoDirty,
  } = useFormRecovery<{
    name: string;
    type: string;
    value: string;
    startDate: string;
    endDate: string;
    isActive: boolean;
    selectedServiceIds: string[];
    happyHoursStart: string;
    happyHoursEnd: string;
    happyHoursDays: number[];
  }>({
    storageKey: "add-promotion-form",
    warnOnUnload: true,
  });

  // Auto-open dialog when recovered data is found
  useEffect(() => {
    if (promoWasRecovered) {
      setDialogOpen(true);
    }
  }, [promoWasRecovered]);

  // Save promotion form state on changes (debounced inside hook)
  useEffect(() => {
    if (dialogOpen && !editingPromotion) {
      const hasData = !!formName || !!formValue || !!formStartDate || !!formEndDate;
      if (hasData) {
        savePromoFormState({
          name: formName,
          type: formType,
          value: formValue,
          startDate: formStartDate,
          endDate: formEndDate,
          isActive: formIsActive,
          selectedServiceIds: formSelectedServiceIds,
          happyHoursStart: formHappyHoursStart,
          happyHoursEnd: formHappyHoursEnd,
          happyHoursDays: formHappyHoursDays,
        });
      }
      setPromoDirty(hasData);
    }
  }, [formName, formType, formValue, formStartDate, formEndDate, formIsActive, formSelectedServiceIds, formHappyHoursStart, formHappyHoursEnd, formHappyHoursDays, dialogOpen, editingPromotion, savePromoFormState, setPromoDirty]);

  // Recovery handler: restores promotion form fields from localStorage
  const handleRestorePromoForm = () => {
    const saved = getPromoRecoveredState();
    if (saved) {
      setFormName(saved.name || "");
      setFormType(saved.type || "percentage");
      setFormValue(saved.value || "");
      setFormStartDate(saved.startDate || "");
      setFormEndDate(saved.endDate || "");
      setFormIsActive(saved.isActive !== undefined ? saved.isActive : true);
      setFormSelectedServiceIds(saved.selectedServiceIds || []);
      setFormHappyHoursStart(saved.happyHoursStart || "14:00");
      setFormHappyHoursEnd(saved.happyHoursEnd || "16:00");
      setFormHappyHoursDays(saved.happyHoursDays || [1, 2, 3, 4, 5]);
    }
  };

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Promotion | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchPromotions = useCallback(async () => {
    if (!salonId) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/promotions?salonId=${salonId}`);
      const data = await res.json();
      if (data.success) {
        setPromotionsList(data.data);
      } else {
        toast.error("Nie udalo sie pobrac promocji");
      }
    } catch {
      toast.error("Blad podczas pobierania promocji");
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  const fetchServices = useCallback(async () => {
    try {
      const res = await fetch(`/api/services?salonId=${salonId}&activeOnly=true`);
      const data = await res.json();
      if (data.success) {
        setServicesList(data.data);
      }
    } catch {
      console.error("Failed to fetch services for promotions");
    }
  }, []);

  useEffect(() => {
    if (session) {
      fetchPromotions();
      fetchServices();
    }
  }, [session, fetchPromotions, fetchServices]);

  // Cross-tab sync: refetch when another tab modifies promotions
  const { notifyChange: notifyPromotionsChanged } = useTabSync("promotions", fetchPromotions);

  const openCreateDialog = () => {
    setEditingPromotion(null);
    setFormName("");
    setFormType("percentage");
    setFormValue("");
    setFormValueError("");
    setFormStartDate("");
    setFormEndDate("");
    setFormIsActive(true);
    setFormSelectedServiceIds([]);
    setFormHappyHoursStart("14:00");
    setFormHappyHoursEnd("16:00");
    setFormHappyHoursDays([1, 2, 3, 4, 5]);
    setDialogOpen(true);
  };

  const openEditDialog = (promo: Promotion) => {
    setEditingPromotion(promo);
    setFormName(promo.name);
    setFormType(promo.type);
    setFormValue(promo.value);
    setFormValueError("");
    setFormStartDate(promo.startDate ? promo.startDate.slice(0, 10) : "");
    setFormEndDate(promo.endDate ? promo.endDate.slice(0, 10) : "");
    setFormIsActive(promo.isActive);
    // Restore selected service IDs from conditionsJson
    const conditions = promo.conditionsJson || {};
    if (promo.type === "package") {
      const packageIds = (conditions.packageServiceIds as string[]) || [];
      setFormSelectedServiceIds(packageIds);
    } else {
      const serviceIds = (conditions.applicableServiceIds as string[]) || [];
      setFormSelectedServiceIds(serviceIds);
    }
    // Restore happy hours fields
    if (promo.type === "happy_hours") {
      setFormHappyHoursStart((conditions.startTime as string) || "14:00");
      setFormHappyHoursEnd((conditions.endTime as string) || "16:00");
      setFormHappyHoursDays((conditions.daysOfWeek as number[]) || [1, 2, 3, 4, 5]);
    } else {
      setFormHappyHoursStart("14:00");
      setFormHappyHoursEnd("16:00");
      setFormHappyHoursDays([1, 2, 3, 4, 5]);
    }
    setDialogOpen(true);
  };

  const handleTypeChange = (newType: string) => {
    setFormType(newType);
    // When switching to buy2get1, default value to 100 (100% discount = free)
    if (newType === "buy2get1" && !formValue) {
      setFormValue("100");
    }
    // When switching to happy_hours, default value to 20%
    if (newType === "happy_hours" && !formValue) {
      setFormValue("20");
    }
    // When switching to first_visit, default value to 15%
    if (newType === "first_visit" && !formValue) {
      setFormValue("15");
    }
    // When switching to package, clear value so user enters package price
    if (newType === "package") {
      setFormValue("");
      setFormSelectedServiceIds([]);
    }
    // Re-validate current value with new type (max constraint may change)
    if (formValue) {
      setFormValueError(validateValueField(formValue, newType));
    } else {
      setFormValueError("");
    }
  };

  const toggleHappyHoursDay = (day: number) => {
    setFormHappyHoursDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const toggleServiceSelection = (serviceId: string) => {
    setFormSelectedServiceIds((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  const validateValueField = (value: string, type: string): string => {
    if (!value || value.trim() === "") {
      return "Podaj wartosc rabatu, np. 10 (dla 10% lub 10 PLN)";
    }
    const numVal = parseFloat(value);
    if (isNaN(numVal)) {
      return "Wartosc musi byc liczba. Wpisz np. 10 lub 25.50";
    }
    if (numVal < 0) {
      return "Wartosc rabatu nie moze byc ujemna. Wpisz liczbe wieksza od 0";
    }
    if (numVal === 0) {
      return "Wartosc musi byc wieksza od zera. Wpisz np. 5, 10 lub 20";
    }
    const isPercentageType = type === "percentage" || type === "buy2get1" || type === "happy_hours" || type === "first_visit";
    if (isPercentageType && numVal > 100) {
      return "Rabat procentowy nie moze przekraczac 100%. Wpisz wartosc od 1 do 100";
    }
    return "";
  };

  const handleValueChange = (newValue: string) => {
    setFormValue(newValue);
    if (newValue) {
      const error = validateValueField(newValue, formType);
      setFormValueError(error);
    } else {
      setFormValueError("");
    }
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error("Wpisz nazwe promocji, np. Rabat letni");
      return;
    }
    const valueError = validateValueField(formValue, formType);
    if (valueError) {
      setFormValueError(valueError);
      toast.error(valueError);
      return;
    }
    if (formType === "buy2get1" && formSelectedServiceIds.length === 0) {
      toast.error("Wybierz co najmniej jedna usluge dla promocji 2+1");
      return;
    }
    if (formType === "package" && formSelectedServiceIds.length < 2) {
      toast.error("Pakiet musi zawierac co najmniej 2 uslugi");
      return;
    }
    if (formType === "happy_hours") {
      if (!formHappyHoursStart || !formHappyHoursEnd) {
        toast.error("Podaj godziny happy hours");
        return;
      }
      if (formHappyHoursStart >= formHappyHoursEnd) {
        toast.error("Godzina rozpoczecia musi byc wczesniejsza niz zakonczenia");
        return;
      }
      if (formHappyHoursDays.length === 0) {
        toast.error("Wybierz co najmniej jeden dzien tygodnia");
        return;
      }
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        salonId: salonId,
        name: formName.trim(),
        type: formType,
        value: formValue,
        startDate: formStartDate || null,
        endDate: formEndDate || null,
        isActive: formIsActive,
      };

      // Include applicable service IDs for buy2get1 promotions
      if (formType === "buy2get1" || (formType !== "package" && formSelectedServiceIds.length > 0)) {
        payload.applicableServiceIds = formSelectedServiceIds;
      }

      // Include package service IDs
      if (formType === "package") {
        payload.conditionsJson = {
          packageServiceIds: formSelectedServiceIds,
        };
      }

      // Include happy hours conditions
      if (formType === "happy_hours") {
        payload.conditionsJson = {
          startTime: formHappyHoursStart,
          endTime: formHappyHoursEnd,
          daysOfWeek: formHappyHoursDays,
        };
      }

      let res: Response;
      if (editingPromotion) {
        res = await fetch(`/api/promotions/${editingPromotion.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/promotions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json();
      if (data.success) {
        toast.success(
          editingPromotion
            ? `Promocja "${data.data.name}" zaktualizowana`
            : `Promocja "${data.data.name}" utworzona`
        );
        setDialogOpen(false);
        fetchPromotions();
        notifyPromotionsChanged();
      } else {
        toast.error(data.error || "Nie udalo sie zapisac promocji");
      }
    } catch {
      toast.error("Blad podczas zapisywania promocji");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/promotions/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Promocja "${deleteTarget.name}" usunieta`);
        setDeleteTarget(null);
        fetchPromotions();
        notifyPromotionsChanged();
      } else {
        toast.error(data.error || "Nie udalo sie usunac promocji");
      }
    } catch {
      toast.error("Blad podczas usuwania promocji");
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (promo: Promotion) => {
    try {
      const res = await fetch(`/api/promotions/${promo.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !promo.isActive }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(
          data.data.isActive
            ? `Promocja "${promo.name}" aktywowana`
            : `Promocja "${promo.name}" dezaktywowana`
        );
        fetchPromotions();
        notifyPromotionsChanged();
      } else {
        toast.error("Nie udalo sie zmienic statusu");
      }
    } catch {
      toast.error("Blad podczas zmiany statusu");
    }
  };

  // Get service names from IDs stored in conditionsJson
  const getServiceNames = (promo: Promotion): string[] => {
    const conditions = promo.conditionsJson || {};
    const serviceIds = (conditions.applicableServiceIds as string[]) || [];
    return serviceIds.map((id) => {
      const svc = servicesList.find((s) => s.id === id);
      return svc ? svc.name : id.slice(0, 8) + "...";
    });
  };

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-screen">Loading...</div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Wymagane logowanie</h1>
          <p className="text-muted-foreground">
            Zaloguj sie, aby zarzadzac promocjami
          </p>
        </div>
      </div>
    );
  }

  const activePromotions = promotionsList.filter((p) => p.isActive && !isExpired(p.endDate));
  const inactivePromotions = promotionsList.filter((p) => !p.isActive || isExpired(p.endDate));

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Promocje</h1>
          <p className="text-muted-foreground mt-1">
            Zarzadzaj promocjami i rabatami salonu
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/promo-codes">
              <Ticket className="w-4 h-4 mr-2" />
              Kody promocyjne
            </Link>
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Nowa promocja
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Wszystkie promocje</p>
                <p className="text-2xl font-bold">{promotionsList.length}</p>
              </div>
              <Tag className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Aktywne</p>
                <p className="text-2xl font-bold text-green-600">{activePromotions.length}</p>
              </div>
              <Percent className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Nieaktywne / Wygasle</p>
                <p className="text-2xl font-bold text-gray-400">{inactivePromotions.length}</p>
              </div>
              <Calendar className="w-8 h-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Promotions list */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Ladowanie promocji...</div>
      ) : promotionsList.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Tag className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">Brak promocji</h3>
            <p className="text-muted-foreground mb-4">
              Utworz pierwsza promocje, aby przyciagnac klientow
            </p>
            <Button onClick={openCreateDialog}>
              <Plus className="w-4 h-4 mr-2" />
              Utworz promocje
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {promotionsList.map((promo) => {
            const expired = isExpired(promo.endDate);
            const upcoming = isUpcoming(promo.startDate);
            const applicableServices = getServiceNames(promo);

            return (
              <Card key={promo.id} className={expired ? "opacity-60" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        {TYPE_ICONS[promo.type] || <Tag className="w-4 h-4" />}
                      </div>
                      <div>
                        <CardTitle className="text-lg">{promo.name}</CardTitle>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline">{TYPE_LABELS[promo.type] || promo.type}</Badge>
                          <Badge variant={promo.isActive && !expired ? "default" : "secondary"}>
                            {expired
                              ? "Wygasla"
                              : upcoming
                                ? "Nadchodzaca"
                                : promo.isActive
                                  ? "Aktywna"
                                  : "Nieaktywna"}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={promo.isActive}
                        onCheckedChange={() => handleToggleActive(promo)}
                        aria-label={`Przelacz status promocji ${promo.name}`}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => openEditDialog(promo)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setDeleteTarget(promo)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">
                        {promo.type === "buy2get1" ? "Znizka na 3. wizyte" : promo.type === "first_visit" ? "Znizka na 1. wizyte" : promo.type === "package" ? "Cena pakietu" : "Wartosc rabatu"}
                      </p>
                      <p className="font-semibold text-lg">{formatValue(promo.type, promo.value)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Data rozpoczecia</p>
                      <p className="font-medium">{formatDate(promo.startDate)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Data zakonczenia</p>
                      <p className="font-medium">{formatDate(promo.endDate)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Utworzono</p>
                      <p className="font-medium">{formatDate(promo.createdAt)}</p>
                    </div>
                  </div>
                  {/* Show applicable services for buy2get1 */}
                  {promo.type === "buy2get1" && applicableServices.length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex items-center gap-2 mb-2">
                        <Scissors className="w-4 h-4 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground font-medium">
                          Dotyczy uslug:
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {applicableServices.map((name, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {name}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Kup 2 wizyty, 3. wizyta z rabatem {formatValue("percentage", promo.value)}
                      </p>
                    </div>
                  )}
                  {/* Show package details */}
                  {promo.type === "package" && (() => {
                    const conditions = promo.conditionsJson || {};
                    const packageServiceIds = (conditions.packageServiceIds as string[]) || [];
                    const packageServices = packageServiceIds.map((id) => {
                      const svc = servicesList.find((s) => s.id === id);
                      return svc || null;
                    }).filter((s): s is Service => s !== null);
                    const totalIndividualPrice = packageServices.reduce(
                      (sum, s) => sum + parseFloat(s.basePrice), 0
                    );
                    const totalDuration = packageServices.reduce(
                      (sum, s) => sum + s.baseDuration, 0
                    );
                    const packagePrice = parseFloat(promo.value);
                    const savings = totalIndividualPrice - packagePrice;

                    return (
                      <div className="mt-3 pt-3 border-t">
                        <div className="flex items-center gap-2 mb-2">
                          <Package className="w-4 h-4 text-blue-500" />
                          <p className="text-sm text-muted-foreground font-medium">
                            Uslugi w pakiecie ({packageServices.length}):
                          </p>
                        </div>
                        <div className="space-y-1 mb-2">
                          {packageServices.map((svc, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                              <span>{svc.name}</span>
                              <span className="text-muted-foreground line-through">
                                {parseFloat(svc.basePrice).toFixed(2)} PLN
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-between text-sm pt-2 border-t">
                          <span className="text-muted-foreground">Suma indywidualna:</span>
                          <span className="line-through text-muted-foreground">
                            {totalIndividualPrice.toFixed(2)} PLN
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm font-semibold">
                          <span>Cena pakietu:</span>
                          <span className="text-green-600">{packagePrice.toFixed(2)} PLN</span>
                        </div>
                        {savings > 0 && (
                          <p className="text-xs text-green-600 mt-1">
                            Oszczednosc: {savings.toFixed(2)} PLN ({Math.round((savings / totalIndividualPrice) * 100)}%)
                            {totalDuration > 0 && ` | Laczny czas: ${totalDuration} min`}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                  {/* Show first visit details */}
                  {promo.type === "first_visit" && (
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex items-center gap-2 mb-2">
                        <UserPlus className="w-4 h-4 text-blue-500" />
                        <p className="text-sm text-muted-foreground font-medium">
                          Znizka na pierwsza wizyte
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Nowi klienci otrzymuja {parseFloat(promo.value)}% znizki na swoja pierwsza wizyte w salonie.
                        Rabat jest automatycznie naliczany podczas rezerwacji online.
                      </p>
                    </div>
                  )}
                  {/* Show happy hours details */}
                  {promo.type === "happy_hours" && (
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-4 h-4 text-amber-500" />
                        <p className="text-sm text-muted-foreground font-medium">
                          Happy Hours
                        </p>
                      </div>
                      {(() => {
                        const cond = promo.conditionsJson || {};
                        const days = (cond.daysOfWeek as number[]) || [];
                        return (
                          <div className="space-y-1">
                            <p className="text-sm">
                              <span className="text-muted-foreground">Godziny: </span>
                              <span className="font-medium">
                                {(cond.startTime as string) || "?"} - {(cond.endTime as string) || "?"}
                              </span>
                            </p>
                            <div className="flex items-center gap-1">
                              <span className="text-sm text-muted-foreground">Dni: </span>
                              <div className="flex gap-1">
                                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                                  <Badge
                                    key={d}
                                    variant={days.includes(d) ? "default" : "outline"}
                                    className={`text-xs px-1.5 ${!days.includes(d) ? "opacity-30" : ""}`}
                                  >
                                    {DAY_NAMES_PL[d]}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPromotion ? "Edytuj promocje" : "Nowa promocja"}
            </DialogTitle>
          </DialogHeader>
          {promoWasRecovered && !editingPromotion && (
            <FormRecoveryBanner
              onRestore={handleRestorePromoForm}
              onDismiss={clearPromoSavedForm}
            />
          )}
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="promo-name">Nazwa promocji *</Label>
              <Input
                id="promo-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={formType === "buy2get1" ? "np. Kup 2, 3. gratis" : "np. Znizka letnia 20%"}
              />
            </div>

            <div>
              <Label htmlFor="promo-type">Typ promocji *</Label>
              <Select value={formType} onValueChange={handleTypeChange}>
                <SelectTrigger id="promo-type">
                  <SelectValue placeholder="Wybierz typ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Procentowa (%)</SelectItem>
                  <SelectItem value="fixed">Kwotowa (PLN)</SelectItem>
                  <SelectItem value="package">Pakiet</SelectItem>
                  <SelectItem value="buy2get1">2+1 gratis</SelectItem>
                  <SelectItem value="happy_hours">Happy Hours</SelectItem>
                  <SelectItem value="first_visit">Pierwsza wizyta</SelectItem>
                </SelectContent>
              </Select>
              {formType === "buy2get1" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Klient kupuje 2 wizyty tej samej uslugi, 3. wizyta z rabatem
                </p>
              )}
              {formType === "package" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Pakiet kilku uslug w obnizanej cenie. Klient rezerwuje wszystkie uslugi naraz.
                </p>
              )}
              {formType === "happy_hours" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Rabat procentowy obowiazujacy w wybranych godzinach i dniach tygodnia
                </p>
              )}
              {formType === "first_visit" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Rabat procentowy dla nowych klientow przy pierwszej wizycie w salonie
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="promo-value">
                {formType === "buy2get1"
                  ? "Znizka na 3. wizyte * (%)"
                  : formType === "happy_hours"
                    ? "Rabat happy hours * (%)"
                    : formType === "first_visit"
                      ? "Znizka na pierwsza wizyte * (%)"
                      : formType === "package"
                        ? "Cena pakietu * (PLN)"
                        : `Wartosc rabatu * ${formType === "percentage" ? "(%)" : formType === "fixed" ? "(PLN)" : ""}`
                }
              </Label>
              <Input
                id="promo-value"
                type="number"
                min="0"
                max={(formType === "percentage" || formType === "buy2get1" || formType === "happy_hours" || formType === "first_visit") ? "100" : undefined}
                step={formType === "percentage" || formType === "buy2get1" || formType === "happy_hours" || formType === "first_visit" ? "1" : "0.01"}
                value={formValue}
                onChange={(e) => handleValueChange(e.target.value)}
                aria-invalid={!!formValueError}
                className={formValueError ? "border-destructive" : ""}
                placeholder={
                  formType === "buy2get1"
                    ? "100 = calkowicie gratis"
                    : formType === "happy_hours"
                      ? "np. 20"
                      : formType === "first_visit"
                        ? "np. 15"
                        : formType === "package"
                          ? "np. 150.00"
                          : formType === "percentage"
                            ? "np. 20"
                            : "np. 50.00"
                }
              />
              {formValueError && (
                <p className="text-sm text-destructive mt-1">{formValueError}</p>
              )}
              {formType === "buy2get1" && !formValueError && (
                <p className="text-xs text-muted-foreground mt-1">
                  100 = 3. wizyta calkowicie za darmo, 50 = 50% znizki na 3. wizyte
                </p>
              )}
            </div>

            {/* Service selection for buy2get1 */}
            {formType === "buy2get1" && (
              <div>
                <Label className="mb-2 block">
                  Wybierz uslugi objete promocja *
                </Label>
                {servicesList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Brak dostepnych uslug. Dodaj uslugi w panelu uslug.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-3">
                    {servicesList.map((svc) => (
                      <div
                        key={svc.id}
                        className="flex items-center space-x-2 cursor-pointer"
                        onClick={() => toggleServiceSelection(svc.id)}
                      >
                        <Checkbox
                          id={`svc-${svc.id}`}
                          checked={formSelectedServiceIds.includes(svc.id)}
                          onCheckedChange={() => toggleServiceSelection(svc.id)}
                        />
                        <label
                          htmlFor={`svc-${svc.id}`}
                          className="text-sm cursor-pointer flex-1"
                        >
                          {svc.name}{" "}
                          <span className="text-muted-foreground">
                            ({parseFloat(svc.basePrice).toFixed(2)} PLN, {svc.baseDuration} min)
                          </span>
                        </label>
                      </div>
                    ))}
                  </div>
                )}
                {formSelectedServiceIds.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Wybrano: {formSelectedServiceIds.length} uslug(i)
                  </p>
                )}
              </div>
            )}

            {/* Service selection for package */}
            {formType === "package" && (
              <div className="space-y-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-2 mb-2">
                  <Package className="w-4 h-4 text-blue-600" />
                  <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                    Uslugi w pakiecie (min. 2) *
                  </p>
                </div>
                {servicesList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Brak dostepnych uslug. Dodaj uslugi w panelu uslug.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-3 bg-background">
                    {servicesList.map((svc) => (
                      <div
                        key={svc.id}
                        className="flex items-center space-x-2 cursor-pointer"
                        onClick={() => toggleServiceSelection(svc.id)}
                      >
                        <Checkbox
                          id={`pkg-svc-${svc.id}`}
                          checked={formSelectedServiceIds.includes(svc.id)}
                          onCheckedChange={() => toggleServiceSelection(svc.id)}
                        />
                        <label
                          htmlFor={`pkg-svc-${svc.id}`}
                          className="text-sm cursor-pointer flex-1"
                        >
                          {svc.name}{" "}
                          <span className="text-muted-foreground">
                            ({parseFloat(svc.basePrice).toFixed(2)} PLN, {svc.baseDuration} min)
                          </span>
                        </label>
                      </div>
                    ))}
                  </div>
                )}
                {formSelectedServiceIds.length > 0 && (() => {
                  const selectedServices = servicesList.filter((s) =>
                    formSelectedServiceIds.includes(s.id)
                  );
                  const totalPrice = selectedServices.reduce(
                    (sum, s) => sum + parseFloat(s.basePrice),
                    0
                  );
                  const totalDuration = selectedServices.reduce(
                    (sum, s) => sum + s.baseDuration,
                    0
                  );
                  const packagePrice = parseFloat(formValue) || 0;
                  const savings = totalPrice - packagePrice;
                  return (
                    <div className="mt-2 p-3 bg-background rounded-md border space-y-1">
                      <p className="text-sm">
                        <span className="text-muted-foreground">Wybrano: </span>
                        <span className="font-medium">{formSelectedServiceIds.length} uslug</span>
                      </p>
                      <p className="text-sm">
                        <span className="text-muted-foreground">Laczna cena indywidualna: </span>
                        <span className="font-medium">{totalPrice.toFixed(2)} PLN</span>
                      </p>
                      <p className="text-sm">
                        <span className="text-muted-foreground">Laczny czas: </span>
                        <span className="font-medium">{totalDuration} min</span>
                      </p>
                      {packagePrice > 0 && (
                        <p className="text-sm font-semibold text-green-600">
                          Oszczednosc klienta: {savings.toFixed(2)} PLN
                          ({totalPrice > 0 ? Math.round((savings / totalPrice) * 100) : 0}%)
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Happy Hours configuration */}
            {formType === "happy_hours" && (
              <div className="space-y-4 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-amber-600" />
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    Konfiguracja Happy Hours
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="hh-start">Od godziny *</Label>
                    <Input
                      id="hh-start"
                      type="time"
                      value={formHappyHoursStart}
                      onChange={(e) => setFormHappyHoursStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="hh-end">Do godziny *</Label>
                    <Input
                      id="hh-end"
                      type="time"
                      value={formHappyHoursEnd}
                      onChange={(e) => setFormHappyHoursEnd(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <Label className="mb-2 block">Dni tygodnia *</Label>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                      <button
                        key={day}
                        type="button"
                        className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                          formHappyHoursDays.includes(day)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background hover:bg-muted border-input"
                        }`}
                        onClick={() => toggleHappyHoursDay(day)}
                        title={DAY_FULL_NAMES_PL[day]}
                      >
                        {DAY_NAMES_PL[day]}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Wybrano: {formHappyHoursDays.length} dni
                  </p>
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="promo-start">Data rozpoczecia</Label>
              <Input
                id="promo-start"
                type="date"
                value={formStartDate}
                onChange={(e) => setFormStartDate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="promo-end">Data zakonczenia</Label>
              <Input
                id="promo-end"
                type="date"
                value={formEndDate}
                onChange={(e) => setFormEndDate(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="promo-active">Aktywna</Label>
              <Switch
                id="promo-active"
                checked={formIsActive}
                onCheckedChange={setFormIsActive}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Anuluj
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Zapisywanie..." : editingPromotion ? "Zapisz zmiany" : "Utworz promocje"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunac promocje?</AlertDialogTitle>
            <AlertDialogDescription>
              Czy na pewno chcesz usunac promocje{" "}
              <strong>&ldquo;{deleteTarget?.name}&rdquo;</strong>? Tej operacji nie mozna cofnac.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting}>
              {deleting ? "Usuwanie..." : "Usun"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
