"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useSalonId } from "@/hooks/use-salon-id";
import { mutationFetch } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import type { PromoCode, Promotion } from "../_types";

interface UsePromoCodesDataReturn {
  session: ReturnType<typeof useSession>["data"];
  isPending: boolean;
  salonId: string | null;
  codesList: PromoCode[];
  promotionsList: Promotion[];
  loading: boolean;
  // Create/Edit dialog state
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  editingCode: PromoCode | null;
  formCode: string;
  setFormCode: (code: string) => void;
  formAutoGenerate: boolean;
  setFormAutoGenerate: (auto: boolean) => void;
  formPromotionId: string;
  setFormPromotionId: (id: string) => void;
  formUsageLimit: string;
  setFormUsageLimit: (limit: string) => void;
  formExpiresAt: string;
  setFormExpiresAt: (date: string) => void;
  saving: boolean;
  // Delete dialog state
  deleteTarget: PromoCode | null;
  setDeleteTarget: (target: PromoCode | null) => void;
  deleting: boolean;
  // Actions
  openCreateDialog: () => void;
  openEditDialog: (code: PromoCode) => void;
  handleSave: () => Promise<void>;
  handleDelete: () => Promise<void>;
  copyToClipboard: (code: string) => void;
}

export function usePromoCodesData(): UsePromoCodesDataReturn {
  const { data: session, isPending } = useSession();
  const { salonId } = useSalonId();

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
    if (!salonId) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/promo-codes?salonId=${salonId}`);
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
  }, [salonId]);

  const fetchPromotions = useCallback(async () => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/promotions?salonId=${salonId}`);
      const data = await res.json();
      if (data.success) {
        setPromotionsList(data.data.filter((p: Promotion) => p.isActive));
      }
    } catch {
    }
  }, [salonId]);

  useEffect(() => {
    if (session && salonId) {
      fetchCodes();
      fetchPromotions();
    }
  }, [session, salonId, fetchCodes, fetchPromotions]);

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
        payload.salonId = salonId;
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

      const res = await mutationFetch(url, {
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
      const res = await mutationFetch(`/api/promo-codes/${deleteTarget.id}`, {
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

  return {
    session,
    isPending,
    salonId,
    codesList,
    promotionsList,
    loading,
    dialogOpen,
    setDialogOpen,
    editingCode,
    formCode,
    setFormCode,
    formAutoGenerate,
    setFormAutoGenerate,
    formPromotionId,
    setFormPromotionId,
    formUsageLimit,
    setFormUsageLimit,
    formExpiresAt,
    setFormExpiresAt,
    saving,
    deleteTarget,
    setDeleteTarget,
    deleting,
    openCreateDialog,
    openEditDialog,
    handleSave,
    handleDelete,
    copyToClipboard,
  };
}
