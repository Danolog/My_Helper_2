"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  Percent,
  Tag,
  Edit,
  Trash2,
  Calendar,
  DollarSign,
  Package,
} from "lucide-react";
import { toast } from "sonner";

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

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

const TYPE_LABELS: Record<string, string> = {
  percentage: "Procentowa",
  fixed: "Kwotowa",
  package: "Pakiet",
};

const TYPE_ICONS: Record<string, React.ReactNode> = {
  percentage: <Percent className="w-4 h-4" />,
  fixed: <DollarSign className="w-4 h-4" />,
  package: <Package className="w-4 h-4" />,
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Brak";
  const d = new Date(dateStr);
  return d.toLocaleDateString("pl-PL", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatValue(type: string, value: string): string {
  const numVal = parseFloat(value);
  if (type === "percentage") return `${numVal}%`;
  if (type === "fixed") return `${numVal.toFixed(2)} PLN`;
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

  const [promotionsList, setPromotionsList] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);

  // Create/Edit dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("percentage");
  const [formValue, setFormValue] = useState("");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formIsActive, setFormIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Promotion | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchPromotions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/promotions?salonId=${DEMO_SALON_ID}`);
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
  }, []);

  useEffect(() => {
    if (session) {
      fetchPromotions();
    }
  }, [session, fetchPromotions]);

  const openCreateDialog = () => {
    setEditingPromotion(null);
    setFormName("");
    setFormType("percentage");
    setFormValue("");
    setFormStartDate("");
    setFormEndDate("");
    setFormIsActive(true);
    setDialogOpen(true);
  };

  const openEditDialog = (promo: Promotion) => {
    setEditingPromotion(promo);
    setFormName(promo.name);
    setFormType(promo.type);
    setFormValue(promo.value);
    setFormStartDate(promo.startDate ? promo.startDate.slice(0, 10) : "");
    setFormEndDate(promo.endDate ? promo.endDate.slice(0, 10) : "");
    setFormIsActive(promo.isActive);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error("Nazwa promocji jest wymagana");
      return;
    }
    if (!formValue || isNaN(parseFloat(formValue)) || parseFloat(formValue) <= 0) {
      toast.error("Podaj prawidlowa wartosc rabatu");
      return;
    }
    if (formType === "percentage" && parseFloat(formValue) > 100) {
      toast.error("Rabat procentowy nie moze przekraczac 100%");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        salonId: DEMO_SALON_ID,
        name: formName.trim(),
        type: formType,
        value: formValue,
        startDate: formStartDate || null,
        endDate: formEndDate || null,
        isActive: formIsActive,
      };

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
      } else {
        toast.error("Nie udalo sie zmienic statusu");
      }
    } catch {
      toast.error("Blad podczas zmiany statusu");
    }
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
        <Button onClick={openCreateDialog}>
          <Plus className="w-4 h-4 mr-2" />
          Nowa promocja
        </Button>
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
                      <p className="text-muted-foreground">Wartosc rabatu</p>
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingPromotion ? "Edytuj promocje" : "Nowa promocja"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="promo-name">Nazwa promocji *</Label>
              <Input
                id="promo-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="np. Znizka letnia 20%"
              />
            </div>

            <div>
              <Label htmlFor="promo-type">Typ promocji *</Label>
              <Select value={formType} onValueChange={setFormType}>
                <SelectTrigger id="promo-type">
                  <SelectValue placeholder="Wybierz typ" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Procentowa (%)</SelectItem>
                  <SelectItem value="fixed">Kwotowa (PLN)</SelectItem>
                  <SelectItem value="package">Pakiet</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="promo-value">
                Wartosc rabatu * {formType === "percentage" ? "(%)" : formType === "fixed" ? "(PLN)" : ""}
              </Label>
              <Input
                id="promo-value"
                type="number"
                min="0"
                max={formType === "percentage" ? "100" : undefined}
                step={formType === "percentage" ? "1" : "0.01"}
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                placeholder={formType === "percentage" ? "np. 20" : "np. 50.00"}
              />
            </div>

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
