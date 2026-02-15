"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import Link from "next/link";
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
  Tag,
  Edit,
  Trash2,
  Calendar,
  Copy,
  ArrowLeft,
  Ticket,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface Promotion {
  id: string;
  salonId: string;
  name: string;
  type: string;
  value: string;
  isActive: boolean;
}

interface PromoCode {
  id: string;
  salonId: string;
  code: string;
  promotionId: string | null;
  usageLimit: number | null;
  usedCount: number | null;
  expiresAt: string | null;
  createdAt: string;
  promotion: Promotion | null;
}

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

const TYPE_LABELS: Record<string, string> = {
  percentage: "Procentowa",
  fixed: "Kwotowa",
  package: "Pakiet",
  buy2get1: "2+1 gratis",
  happy_hours: "Happy Hours",
  first_visit: "Pierwsza wizyta",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Brak";
  const d = new Date(dateStr);
  return d.toLocaleDateString("pl-PL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

function formatPromotionValue(type: string, value: string): string {
  const numVal = parseFloat(value);
  if (type === "percentage" || type === "buy2get1" || type === "happy_hours" || type === "first_visit") return `${numVal}%`;
  if (type === "fixed") return `${numVal.toFixed(2)} PLN`;
  if (type === "package") return `${numVal.toFixed(2)} PLN`;
  return value;
}

export default function PromoCodesPage() {
  const { data: session, isPending } = useSession();

  const [codesList, setCodesList] = useState<PromoCode[]>([]);
  const [promotionsList, setPromotionsList] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);

  // Create/Edit dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCode, setEditingCode] = useState<PromoCode | null>(null);
  const [formCode, setFormCode] = useState("");
  const [formAutoGenerate, setFormAutoGenerate] = useState(true);
  const [formPromotionId, setFormPromotionId] = useState<string>("none");
  const [formUsageLimit, setFormUsageLimit] = useState("");
  const [formExpiresAt, setFormExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<PromoCode | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchCodes = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/promo-codes?salonId=${DEMO_SALON_ID}`);
      const data = await res.json();
      if (data.success) {
        setCodesList(data.data);
      } else {
        toast.error("Nie udalo sie pobrac kodow promocyjnych");
      }
    } catch {
      toast.error("Blad podczas pobierania kodow promocyjnych");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPromotions = useCallback(async () => {
    try {
      const res = await fetch(`/api/promotions?salonId=${DEMO_SALON_ID}`);
      const data = await res.json();
      if (data.success) {
        setPromotionsList(data.data.filter((p: Promotion) => p.isActive));
      }
    } catch {
      console.error("Failed to fetch promotions for promo codes");
    }
  }, []);

  useEffect(() => {
    if (session) {
      fetchCodes();
      fetchPromotions();
    }
  }, [session, fetchCodes, fetchPromotions]);

  const openCreateDialog = () => {
    setEditingCode(null);
    setFormCode("");
    setFormAutoGenerate(true);
    setFormPromotionId("none");
    setFormUsageLimit("");
    setFormExpiresAt("");
    setDialogOpen(true);
  };

  const openEditDialog = (code: PromoCode) => {
    setEditingCode(code);
    setFormCode(code.code);
    setFormAutoGenerate(false);
    setFormPromotionId(code.promotionId || "none");
    setFormUsageLimit(code.usageLimit != null ? code.usageLimit.toString() : "");
    setFormExpiresAt(code.expiresAt ? code.expiresAt.slice(0, 10) : "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const isEditing = !!editingCode;
      const url = isEditing
        ? `/api/promo-codes/${editingCode.id}`
        : "/api/promo-codes";
      const method = isEditing ? "PUT" : "POST";

      const payload: Record<string, unknown> = {};

      if (!isEditing) {
        payload.salonId = DEMO_SALON_ID;
      }

      // Code field
      if (isEditing) {
        payload.code = formCode;
      } else if (!formAutoGenerate && formCode.trim()) {
        payload.code = formCode.trim();
      }
      // If auto-generate, don't send code field -> API auto-generates

      // Promotion link
      payload.promotionId = formPromotionId === "none" ? null : formPromotionId;

      // Usage limit
      if (formUsageLimit.trim()) {
        const limit = parseInt(formUsageLimit, 10);
        if (isNaN(limit) || limit < 1) {
          toast.error("Limit uzyc musi byc liczba wieksza od 0");
          setSaving(false);
          return;
        }
        payload.usageLimit = limit;
      } else {
        payload.usageLimit = null;
      }

      // Expiry date
      payload.expiresAt = formExpiresAt || null;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(
          isEditing
            ? "Kod promocyjny zostal zaktualizowany"
            : `Kod promocyjny ${data.data.code} zostal utworzony`
        );
        setDialogOpen(false);
        fetchCodes();
      } else {
        toast.error(data.error || "Nie udalo sie zapisac kodu promocyjnego");
      }
    } catch {
      toast.error("Blad podczas zapisywania kodu promocyjnego");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/promo-codes/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Kod ${deleteTarget.code} zostal usuniety`);
        setDeleteTarget(null);
        fetchCodes();
      } else {
        toast.error(data.error || "Nie udalo sie usunac kodu");
      }
    } catch {
      toast.error("Blad podczas usuwania kodu promocyjnego");
    } finally {
      setDeleting(false);
    }
  };

  const copyToClipboard = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      toast.success(`Kod ${code} skopiowany do schowka`);
    }).catch(() => {
      toast.error("Nie udalo sie skopiowac kodu");
    });
  };

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-screen">
        Loading...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <div className="mb-8">
            <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h1 className="text-2xl font-bold mb-2">Wymagane logowanie</h1>
            <p className="text-muted-foreground mb-6">
              Zaloguj sie, aby zarzadzac kodami promocyjnymi
            </p>
          </div>
        </div>
      </div>
    );
  }

  const activeCodes = codesList.filter((c) => !isExpired(c.expiresAt) && (c.usageLimit == null || (c.usedCount ?? 0) < c.usageLimit));
  const expiredOrUsedCodes = codesList.filter((c) => isExpired(c.expiresAt) || (c.usageLimit != null && (c.usedCount ?? 0) >= c.usageLimit));

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/promotions">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Promocje
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">Kody promocyjne</h1>
          <p className="text-muted-foreground">
            Generuj i zarzadzaj kodami rabatowymi
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="w-4 h-4 mr-2" />
          Generuj kod
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Wszystkie kody
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{codesList.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Aktywne
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {activeCodes.length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Wygasle / Wykorzystane
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-400">
              {expiredOrUsedCodes.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Promo Codes List */}
      {loading ? (
        <p className="text-center text-muted-foreground py-8">
          Ladowanie kodow promocyjnych...
        </p>
      ) : codesList.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-lg">
          <Ticket className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">Brak kodow promocyjnych</h3>
          <p className="text-muted-foreground mb-4">
            Utwórz pierwszy kod promocyjny dla swoich klientow
          </p>
          <Button onClick={openCreateDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Generuj kod
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {codesList.map((promoCode) => {
            const expired = isExpired(promoCode.expiresAt);
            const usedUp =
              promoCode.usageLimit != null &&
              (promoCode.usedCount ?? 0) >= promoCode.usageLimit;
            const isInactive = expired || usedUp;

            return (
              <Card
                key={promoCode.id}
                className={isInactive ? "opacity-60" : ""}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Tag className="w-4 h-4 text-primary" />
                      <CardTitle className="text-lg font-mono tracking-wider">
                        {promoCode.code}
                      </CardTitle>
                    </div>
                    <div className="flex gap-1">
                      {expired && (
                        <Badge variant="secondary">Wygasly</Badge>
                      )}
                      {usedUp && (
                        <Badge variant="secondary">Wykorzystany</Badge>
                      )}
                      {!isInactive && (
                        <Badge className="bg-green-100 text-green-800">
                          Aktywny
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    {/* Linked promotion */}
                    {promoCode.promotion ? (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Promocja:</span>
                        <span className="font-medium">
                          {promoCode.promotion.name}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {TYPE_LABELS[promoCode.promotion.type] || promoCode.promotion.type}
                          {" "}
                          {formatPromotionValue(promoCode.promotion.type, promoCode.promotion.value)}
                        </Badge>
                      </div>
                    ) : (
                      <div className="text-muted-foreground">
                        Brak powiazanej promocji
                      </div>
                    )}

                    {/* Usage */}
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Uzycia:</span>
                      <span className="font-medium">
                        {promoCode.usedCount ?? 0}
                        {promoCode.usageLimit != null
                          ? ` / ${promoCode.usageLimit}`
                          : " (bez limitu)"}
                      </span>
                    </div>

                    {/* Expiry */}
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3 h-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Wygasa:</span>
                      <span className="font-medium">
                        {promoCode.expiresAt
                          ? formatDate(promoCode.expiresAt)
                          : "Bez terminu"}
                      </span>
                    </div>

                    {/* Created at */}
                    <div className="text-xs text-muted-foreground">
                      Utworzony: {formatDate(promoCode.createdAt)}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(promoCode.code)}
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      Kopiuj
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(promoCode)}
                    >
                      <Edit className="w-3 h-3 mr-1" />
                      Edytuj
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(promoCode)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
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
              {editingCode ? "Edytuj kod promocyjny" : "Generuj kod promocyjny"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Code field */}
            <div>
              <Label htmlFor="promo-code">Kod</Label>
              {!editingCode && (
                <div className="flex items-center gap-2 mb-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formAutoGenerate}
                      onChange={(e) => setFormAutoGenerate(e.target.checked)}
                      className="rounded"
                    />
                    Wygeneruj automatycznie
                  </label>
                </div>
              )}
              {(editingCode || !formAutoGenerate) ? (
                <div className="flex gap-2">
                  <Input
                    id="promo-code"
                    placeholder="np. LATO2026"
                    value={formCode}
                    onChange={(e) =>
                      setFormCode(e.target.value.toUpperCase())
                    }
                    className="font-mono tracking-wider"
                  />
                  {!editingCode && (
                    <Button
                      variant="outline"
                      size="icon"
                      type="button"
                      onClick={() => {
                        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
                        const bytes = new Uint8Array(8);
                        crypto.getRandomValues(bytes);
                        const code = Array.from(
                          bytes,
                          (byte) => chars[byte % chars.length]
                        ).join("");
                        setFormCode(code);
                      }}
                      title="Wygeneruj losowy kod"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Kod zostanie wygenerowany automatycznie (8 znakow)
                </p>
              )}
            </div>

            {/* Link to promotion */}
            <div>
              <Label htmlFor="promotion-link">Powiazana promocja</Label>
              <Select
                value={formPromotionId}
                onValueChange={setFormPromotionId}
              >
                <SelectTrigger id="promotion-link">
                  <SelectValue placeholder="Wybierz promocje" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Brak (kod bez promocji)</SelectItem>
                  {promotionsList.map((promo) => (
                    <SelectItem key={promo.id} value={promo.id}>
                      {promo.name} ({TYPE_LABELS[promo.type] || promo.type}{" "}
                      {formatPromotionValue(promo.type, promo.value)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Powiaz kod z istniejaca promocja, aby zastosowac rabat
              </p>
            </div>

            {/* Usage limit */}
            <div>
              <Label htmlFor="usage-limit">Limit uzyc</Label>
              <Input
                id="usage-limit"
                type="number"
                min="1"
                placeholder="Bez limitu"
                value={formUsageLimit}
                onChange={(e) => setFormUsageLimit(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Pozostaw puste dla nieograniczonej liczby uzyc
              </p>
            </div>

            {/* Expiry date */}
            <div>
              <Label htmlFor="expires-at">Data wygasniecia</Label>
              <Input
                id="expires-at"
                type="date"
                value={formExpiresAt}
                onChange={(e) => setFormExpiresAt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Pozostaw puste dla kodu bez terminu wygasniecia
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Anuluj
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving
                ? "Zapisywanie..."
                : editingCode
                  ? "Zapisz zmiany"
                  : "Generuj kod"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunac kod promocyjny?</AlertDialogTitle>
            <AlertDialogDescription>
              Czy na pewno chcesz usunac kod{" "}
              <strong className="font-mono">{deleteTarget?.code}</strong>? Ta
              operacja jest nieodwracalna.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Anuluj</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Usuwanie..." : "Usun"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
