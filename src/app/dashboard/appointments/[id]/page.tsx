"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import {
  AppointmentHeader,
  AppointmentInfoCard,
  AppointmentRefundStatus,
  AppointmentNotes,
  AppointmentTreatment,
  AppointmentCommission,
  AppointmentInvoiceCard,
  AppointmentFiscalReceiptCard,
  AppointmentMaterials,
} from "@/components/appointments/detail";
import type {
  AppointmentDetail,
  MaterialRecord,
  Product,
  TreatmentRecord,
  CommissionRecord,
  RefundStatus,
  InvoiceData,
  FiscalReceiptData,
} from "@/components/appointments/detail";
import { useSalonId } from "@/hooks/use-salon-id";
import { useTabSync } from "@/hooks/use-tab-sync";
import { useSession } from "@/lib/auth-client";

// Lazy-load dialog components (only rendered when user triggers an action)
const EditAppointmentDialog = dynamic(
  () => import("@/components/appointments/edit-appointment-dialog").then((m) => ({ default: m.EditAppointmentDialog })),
  { ssr: false },
);

const CompleteAppointmentDialog = dynamic(
  () => import("@/components/appointments/complete-appointment-dialog").then((m) => ({ default: m.CompleteAppointmentDialog })),
  { ssr: false },
);

const FiscalReceiptDialog = dynamic(
  () => import("@/components/appointments/detail/fiscal-receipt-dialog").then((m) => ({ default: m.FiscalReceiptDialog })),
  { ssr: false },
);

const InvoiceDialog = dynamic(
  () => import("@/components/appointments/detail/invoice-dialog").then((m) => ({ default: m.InvoiceDialog })),
  { ssr: false },
);

export default function AppointmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const appointmentId = params.id as string;
  const { data: session, isPending } = useSession();
  const { salonId } = useSalonId();

  const [appointment, setAppointment] = useState<AppointmentDetail | null>(null);
  const [materials, setMaterials] = useState<MaterialRecord[]>([]);
  const [availableProducts, setAvailableProducts] = useState<Product[]>([]);
  const [treatment, setTreatment] = useState<TreatmentRecord | null>(null);
  const [commission, setCommission] = useState<CommissionRecord | null>(null);
  const [refundStatus, setRefundStatus] = useState<RefundStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Fiscal receipt state
  const [fiscalReceipt, setFiscalReceipt] = useState<FiscalReceiptData | null>(null);
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);

  // Invoice state
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);

  // Complete appointment dialog state
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);

  // Edit appointment dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // --- Data fetching callbacks ---

  const fetchAppointment = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setAppointment(data.data);
      } else {
        toast.error("Nie znaleziono wizyty");
        router.replace("/dashboard/calendar");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      toast.error("Blad podczas ladowania wizyty");
    } finally {
      setLoading(false);
    }
  }, [appointmentId, router]);

  const fetchMaterials = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/materials`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setMaterials(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [appointmentId]);

  const fetchProducts = useCallback(async (signal: AbortSignal | null = null) => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/products?salonId=${salonId}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setAvailableProducts(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [salonId]);

  const fetchTreatment = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/treatment`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setTreatment(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [appointmentId]);

  const fetchCommission = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/commission`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setCommission(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [appointmentId]);

  const fetchRefundStatus = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/refund-status`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setRefundStatus(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [appointmentId]);

  const fetchFiscalReceipt = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/fiscal-receipt`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.hasReceipt) {
        setFiscalReceipt(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [appointmentId]);

  const fetchInvoice = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/invoice`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.hasInvoice) {
        setInvoice(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    }
  }, [appointmentId]);

  // --- Initial data load with AbortController cleanup ---

  useEffect(() => {
    const controller = new AbortController();
    fetchAppointment(controller.signal);
    fetchMaterials(controller.signal);
    fetchProducts(controller.signal);
    fetchTreatment(controller.signal);
    fetchCommission(controller.signal);
    fetchRefundStatus(controller.signal);
    fetchFiscalReceipt(controller.signal);
    fetchInvoice(controller.signal);
    return () => controller.abort();
  }, [fetchAppointment, fetchMaterials, fetchProducts, fetchTreatment, fetchCommission, fetchRefundStatus, fetchFiscalReceipt, fetchInvoice]);

  // Cross-tab sync: refetch when another tab modifies appointments
  useTabSync("appointments", fetchAppointment);

  // --- Event handlers ---

  const handleCompleted = () => {
    fetchAppointment();
    fetchTreatment();
    fetchCommission();
  };

  const handleMaterialsChanged = () => {
    fetchMaterials();
    fetchProducts();
  };

  const handleOpenInvoiceDialog = () => {
    setInvoiceDialogOpen(true);
  };

  // Calculate total material cost (needed by dialogs)
  const totalMaterialCost = materials.reduce((sum, m) => {
    if (m.product?.pricePerUnit) {
      return sum + parseFloat(m.quantityUsed) * parseFloat(m.product.pricePerUnit);
    }
    return sum;
  }, 0);

  // --- Loading / auth / error guards ---

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
        </div>
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <p className="text-muted-foreground">Nie znaleziono wizyty</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <AppointmentHeader
        appointment={appointment}
        invoice={invoice}
        fiscalReceipt={fiscalReceipt}
        onBack={() => router.back()}
        onEdit={() => setEditDialogOpen(true)}
        onComplete={() => setCompleteDialogOpen(true)}
        onInvoiceAction={handleOpenInvoiceDialog}
        onReceiptAction={() => setReceiptDialogOpen(true)}
      />

      <AppointmentInfoCard appointment={appointment} />

      <AppointmentRefundStatus
        appointment={appointment}
        refundStatus={refundStatus}
      />

      <AppointmentNotes
        appointment={appointment}
        onNotesSaved={fetchAppointment}
      />

      {treatment && <AppointmentTreatment treatment={treatment} />}

      {commission && <AppointmentCommission commission={commission} />}

      {invoice && (
        <AppointmentInvoiceCard
          invoice={invoice}
          onViewDetails={() => setInvoiceDialogOpen(true)}
        />
      )}

      {fiscalReceipt && (
        <AppointmentFiscalReceiptCard
          fiscalReceipt={fiscalReceipt}
          onViewDetails={() => setReceiptDialogOpen(true)}
        />
      )}

      <AppointmentMaterials
        appointment={appointment}
        materials={materials}
        availableProducts={availableProducts}
        onMaterialsChanged={handleMaterialsChanged}
      />

      {/* Complete Appointment Dialog */}
      {appointment && (
        <CompleteAppointmentDialog
          open={completeDialogOpen}
          onOpenChange={setCompleteDialogOpen}
          appointment={appointment}
          materials={materials}
          onCompleted={handleCompleted}
        />
      )}

      {/* Edit Appointment Dialog */}
      {appointment && (
        <EditAppointmentDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          appointment={appointment}
          onAppointmentUpdated={fetchAppointment}
        />
      )}

      {/* Fiscal Receipt Dialog */}
      <FiscalReceiptDialog
        open={receiptDialogOpen}
        onOpenChange={setReceiptDialogOpen}
        appointment={appointment}
        fiscalReceipt={fiscalReceipt}
        totalMaterialCost={totalMaterialCost}
        onReceiptPrinted={setFiscalReceipt}
      />

      {/* Invoice Dialog */}
      <InvoiceDialog
        open={invoiceDialogOpen}
        onOpenChange={setInvoiceDialogOpen}
        appointment={appointment}
        invoice={invoice}
        totalMaterialCost={totalMaterialCost}
        onInvoiceGenerated={setInvoice}
      />
    </div>
  );
}
