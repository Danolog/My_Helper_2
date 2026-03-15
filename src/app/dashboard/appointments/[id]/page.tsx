"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
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
  Lock,
  ArrowLeft,
  Calendar,
  Clock,
  User,
  Scissors,
  Package,
  Plus,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Pencil,
  ClipboardList,
  DollarSign,
  FileText,
  Save,
  X,
  RefreshCw,
  Ban,
  Printer,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { useTabSync } from "@/hooks/use-tab-sync";
import { useSalonId } from "@/hooks/use-salon-id";

// Lazy-load dialog components (only rendered when user triggers an action)
const EditAppointmentDialog = dynamic(
  () => import("@/components/appointments/edit-appointment-dialog").then((m) => ({ default: m.EditAppointmentDialog })),
  { ssr: false },
);

const CompleteAppointmentDialog = dynamic(
  () => import("@/components/appointments/complete-appointment-dialog").then((m) => ({ default: m.CompleteAppointmentDialog })),
  { ssr: false },
);

interface AppointmentDetail {
  id: string;
  salonId: string;
  clientId: string | null;
  employeeId: string;
  serviceId: string | null;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  depositAmount: string | null;
  depositPaid: boolean;
  createdAt: string;
  updatedAt: string;
  client: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    email: string | null;
    allergies: string | null;
  } | null;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    color: string | null;
  } | null;
  service: {
    id: string;
    name: string;
    basePrice: string;
    baseDuration: number;
  } | null;
}

interface MaterialRecord {
  id: string;
  appointmentId: string;
  productId: string;
  quantityUsed: string;
  notes: string | null;
  createdAt: string;
  product: {
    id: string;
    name: string;
    category: string | null;
    quantity: string | null;
    unit: string | null;
    pricePerUnit: string | null;
  } | null;
}

interface Product {
  id: string;
  name: string;
  category: string | null;
  quantity: string | null;
  unit: string | null;
  pricePerUnit: string | null;
}

interface TreatmentRecord {
  id: string;
  appointmentId: string;
  recipe: string | null;
  techniques: string | null;
  notes: string | null;
  materialsJson: unknown;
}

interface CommissionRecord {
  id: string;
  employeeId: string;
  appointmentId: string;
  amount: string;
  percentage: string | null;
  paidAt: string | null;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
}

interface RefundStatus {
  appointmentId: string;
  hasDeposit: boolean;
  depositAmount?: number;
  depositPaid?: boolean;
  paymentMethod?: string;
  paymentStatus?: string;
  refundStatus: string;
  refundAmount: number;
  forfeitedAmount?: number;
  refundedAt?: string;
  stripeRefundId?: string;
  refundReason?: string;
}

interface InvoiceData {
  id: string;
  invoiceNumber: string;
  type: string;
  clientName: string | null;
  clientAddress: string | null;
  companyName: string | null;
  companyNip: string | null;
  amount: string;
  vatRate: string | null;
  vatAmount: string | null;
  netAmount: string | null;
  paymentMethod: string | null;
  description: string | null;
  issuedAt: string;
  invoiceDataJson: {
    seller: { name: string; address: string; nip: string | null };
    buyer: { name: string | null; address: string | null; nip: string | null };
    invoiceNumber: string;
    issueDate: string;
    items: Array<{
      name: string;
      quantity: number;
      unitPrice: string;
      netPrice: string;
      total: string;
      vatRate: string;
    }>;
    summary: {
      netAmount: string;
      vatRate: string;
      vatAmount: string;
      totalAmount: string;
    };
    paymentMethod: string;
    employee: string | null;
    appointmentDate: string;
    appointmentTime: string;
  } | null;
}

interface FiscalReceiptData {
  id: string;
  receiptNumber: string;
  nip: string | null;
  clientName: string | null;
  employeeName: string | null;
  serviceName: string | null;
  servicePrice: string;
  materialsCost: string;
  totalAmount: string;
  vatRate: string;
  vatAmount: string;
  netAmount: string;
  paymentMethod: string;
  printerModel: string | null;
  printedAt: string;
  printStatus: string;
  receiptDataJson: {
    header: { line1: string; line2: string; line3: string; nip: string | null };
    receiptNumber: string;
    date: string;
    time: string;
    items: Array<{
      name: string;
      quantity: number;
      unitPrice: string;
      total: string;
      vatRate: string;
    }>;
    summary: {
      netAmount: string;
      vatRate: string;
      vatAmount: string;
      totalAmount: string;
    };
    paymentMethod: string;
    client: string | null;
    employee: string | null;
    appointmentDate: string;
    appointmentTime: string;
    footer: string;
  } | null;
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    scheduled: "Zaplanowana",
    confirmed: "Potwierdzona",
    completed: "Zakonczona",
    cancelled: "Anulowana",
    no_show: "Nieobecnosc",
  };
  return labels[status] || status;
}

function getStatusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "confirmed":
      return "secondary";
    case "cancelled":
    case "no_show":
      return "destructive";
    default:
      return "outline";
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
}

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

  // Add material dialog
  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [materialQuantity, setMaterialQuantity] = useState("");
  const [materialNotes, setMaterialNotes] = useState("");
  const [addingMaterial, setAddingMaterial] = useState(false);

  // Complete appointment dialog state
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);

  // Edit appointment dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Inline notes editing state
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  // Fiscal receipt state
  const [fiscalReceipt, setFiscalReceipt] = useState<FiscalReceiptData | null>(null);
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
  const [printingReceipt, setPrintingReceipt] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("cash");

  // Invoice state
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [invoiceType, setInvoiceType] = useState<"paragon" | "faktura">("paragon");
  const [invoiceClientName, setInvoiceClientName] = useState("");
  const [invoiceClientAddress, setInvoiceClientAddress] = useState("");
  const [invoiceCompanyName, setInvoiceCompanyName] = useState("");
  const [invoiceCompanyNip, setInvoiceCompanyNip] = useState("");
  const [invoiceCompanyAddress, setInvoiceCompanyAddress] = useState("");
  const [invoicePaymentMethod, setInvoicePaymentMethod] = useState("cash");

  const fetchAppointment = useCallback(async () => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`);
      const data = await res.json();
      if (data.success) {
        setAppointment(data.data);
      } else {
        toast.error("Nie znaleziono wizyty");
        router.replace("/dashboard/calendar");
      }
    } catch (error) {
      console.error("Failed to fetch appointment:", error);
      toast.error("Blad podczas ladowania wizyty");
    } finally {
      setLoading(false);
    }
  }, [appointmentId, router]);

  const fetchMaterials = useCallback(async () => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/materials`);
      const data = await res.json();
      if (data.success) {
        setMaterials(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch materials:", error);
    }
  }, [appointmentId]);

  const fetchProducts = useCallback(async () => {
    if (!salonId) return;
    try {
      const res = await fetch(`/api/products?salonId=${salonId}`);
      const data = await res.json();
      if (data.success) {
        setAvailableProducts(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch products:", error);
    }
  }, [salonId]);

  const fetchTreatment = useCallback(async () => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/treatment`);
      const data = await res.json();
      if (data.success) {
        setTreatment(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch treatment:", error);
    }
  }, [appointmentId]);

  const fetchCommission = useCallback(async () => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/commission`);
      const data = await res.json();
      if (data.success) {
        setCommission(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch commission:", error);
    }
  }, [appointmentId]);

  const fetchRefundStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/refund-status`);
      const data = await res.json();
      if (data.success) {
        setRefundStatus(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch refund status:", error);
    }
  }, [appointmentId]);

  const fetchFiscalReceipt = useCallback(async () => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/fiscal-receipt`);
      const data = await res.json();
      if (data.success && data.hasReceipt) {
        setFiscalReceipt(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch fiscal receipt:", error);
    }
  }, [appointmentId]);

  const fetchInvoice = useCallback(async () => {
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/invoice`);
      const data = await res.json();
      if (data.success && data.hasInvoice) {
        setInvoice(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch invoice:", error);
    }
  }, [appointmentId]);

  const handleGenerateInvoice = async () => {
    if (invoiceType === "paragon" && !invoiceClientName.trim()) {
      toast.error("Podaj imie i nazwisko klienta");
      return;
    }
    if (invoiceType === "faktura") {
      if (!invoiceCompanyName.trim()) {
        toast.error("Podaj nazwe firmy");
        return;
      }
      if (!invoiceCompanyNip.trim()) {
        toast.error("Podaj NIP firmy");
        return;
      }
      // Validate NIP format (10 digits, optionally with dashes)
      const nipClean = invoiceCompanyNip.replace(/[-\s]/g, "");
      if (!/^\d{10}$/.test(nipClean)) {
        toast.error("NIP musi zawierac 10 cyfr");
        return;
      }
    }
    setGeneratingInvoice(true);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: invoiceType,
          clientName: invoiceType === "paragon" ? invoiceClientName.trim() : null,
          clientAddress: invoiceType === "paragon" ? (invoiceClientAddress.trim() || null) : null,
          companyName: invoiceType === "faktura" ? invoiceCompanyName.trim() : null,
          companyNip: invoiceType === "faktura" ? invoiceCompanyNip.replace(/[-\s]/g, "").trim() : null,
          companyAddress: invoiceType === "faktura" ? (invoiceCompanyAddress.trim() || null) : null,
          paymentMethod: invoicePaymentMethod,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setInvoice(data.data);
        toast.success(data.message || "Faktura zostala wygenerowana");
        setInvoiceDialogOpen(false);
      } else {
        toast.error(data.error || "Nie udalo sie wygenerowac faktury");
      }
    } catch (error) {
      console.error("Failed to generate invoice:", error);
      toast.error("Blad podczas generowania faktury");
    } finally {
      setGeneratingInvoice(false);
    }
  };

  const handlePrintReceipt = async () => {
    setPrintingReceipt(true);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/fiscal-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod: selectedPaymentMethod }),
      });
      const data = await res.json();
      if (data.success) {
        setFiscalReceipt(data.data);
        toast.success(data.message || "Paragon fiskalny wyslany do drukarki");
        setReceiptDialogOpen(false);
      } else {
        toast.error(data.error || "Nie udalo sie wydrukowac paragonu");
      }
    } catch (error) {
      console.error("Failed to print fiscal receipt:", error);
      toast.error("Blad podczas drukowania paragonu");
    } finally {
      setPrintingReceipt(false);
    }
  };

  useEffect(() => {
    fetchAppointment();
    fetchMaterials();
    fetchProducts();
    fetchTreatment();
    fetchCommission();
    fetchRefundStatus();
    fetchFiscalReceipt();
    fetchInvoice();
  }, [fetchAppointment, fetchMaterials, fetchProducts, fetchTreatment, fetchCommission, fetchRefundStatus, fetchFiscalReceipt, fetchInvoice]);

  // Cross-tab sync: refetch when another tab modifies appointments
  useTabSync("appointments", fetchAppointment);

  const handleAddMaterial = async () => {
    if (!selectedProductId) {
      toast.error("Wybierz produkt");
      return;
    }
    if (!materialQuantity || parseFloat(materialQuantity) <= 0) {
      toast.error("Podaj ilosc wieksza od 0");
      return;
    }

    setAddingMaterial(true);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProductId,
          quantityUsed: materialQuantity,
          notes: materialNotes || null,
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Material dodany");
        setAddMaterialOpen(false);
        setSelectedProductId("");
        setMaterialQuantity("");
        setMaterialNotes("");
        fetchMaterials();
        fetchProducts(); // Refresh product quantities
      } else {
        toast.error(data.error || "Nie udalo sie dodac materialu");
      }
    } catch (error) {
      console.error("Failed to add material:", error);
      toast.error("Blad podczas dodawania materialu");
    } finally {
      setAddingMaterial(false);
    }
  };

  const handleRemoveMaterial = async (materialId: string) => {
    try {
      const res = await fetch(
        `/api/appointments/${appointmentId}/materials?materialId=${materialId}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (data.success) {
        toast.success("Material usuniety, stan magazynowy przywrocony");
        fetchMaterials();
        fetchProducts();
      } else {
        toast.error(data.error || "Nie udalo sie usunac materialu");
      }
    } catch (error) {
      console.error("Failed to remove material:", error);
      toast.error("Blad podczas usuwania materialu");
    }
  };

  const handleCompleted = () => {
    fetchAppointment();
    fetchTreatment();
    fetchCommission();
  };

  const handleStartEditingNotes = () => {
    setNotesValue(appointment?.notes || "");
    setEditingNotes(true);
  };

  const handleCancelEditingNotes = () => {
    setEditingNotes(false);
    setNotesValue("");
  };

  const handleSaveNotes = async () => {
    if (!appointment) return;
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/appointments/${appointment.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesValue.trim() || null }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Notatki zostaly zapisane");
        setEditingNotes(false);
        fetchAppointment();
      } else {
        toast.error(data.error || "Nie udalo sie zapisac notatek");
      }
    } catch (error) {
      console.error("Failed to save notes:", error);
      toast.error("Blad podczas zapisywania notatek");
    } finally {
      setSavingNotes(false);
    }
  };

  // Calculate total material cost
  const totalMaterialCost = materials.reduce((sum, m) => {
    if (m.product?.pricePerUnit) {
      return sum + parseFloat(m.quantityUsed) * parseFloat(m.product.pricePerUnit);
    }
    return sum;
  }, 0);

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

  const startDate = new Date(appointment.startTime);
  const endDate = new Date(appointment.endTime);
  const durationMin = Math.round(
    (endDate.getTime() - startDate.getTime()) / 60000
  );

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.back()}
          data-testid="back-btn"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold" data-testid="appointment-title">
            Szczegoly wizyty
          </h1>
          <p className="text-muted-foreground text-sm">
            {appointment.service?.name || "Wizyta"} -{" "}
            {startDate.toLocaleDateString("pl-PL", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        {appointment.status !== "completed" && appointment.status !== "cancelled" && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(true)}
              data-testid="edit-appointment-btn"
            >
              <Pencil className="h-4 w-4 mr-2" />
              Edytuj
            </Button>
            <Button
              onClick={() => setCompleteDialogOpen(true)}
              data-testid="complete-appointment-btn"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Zakoncz wizyte
            </Button>
          </div>
        )}
        {appointment.status === "completed" && (
          <div className="flex items-center gap-2">
            {invoice ? (
              <Button
                variant="outline"
                onClick={() => setInvoiceDialogOpen(true)}
                data-testid="view-invoice-btn"
              >
                <FileText className="h-4 w-4 mr-2" />
                Podglad faktury
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => {
                  // Pre-fill client name if available
                  if (appointment.client) {
                    setInvoiceClientName(
                      `${appointment.client.firstName} ${appointment.client.lastName}`
                    );
                  }
                  setInvoiceDialogOpen(true);
                }}
                data-testid="generate-invoice-btn"
              >
                <FileText className="h-4 w-4 mr-2" />
                Generuj fakture
              </Button>
            )}
            {fiscalReceipt ? (
              <Button
                variant="outline"
                onClick={() => setReceiptDialogOpen(true)}
                data-testid="view-receipt-btn"
              >
                <Receipt className="h-4 w-4 mr-2" />
                Podglad paragonu
              </Button>
            ) : (
              <Button
                onClick={() => setReceiptDialogOpen(true)}
                data-testid="print-receipt-btn"
              >
                <Printer className="h-4 w-4 mr-2" />
                Drukuj paragon
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Allergy warning */}
      {appointment.client?.allergies && (
        <div
          className="flex items-start gap-3 p-4 mb-6 rounded-lg border border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30"
          data-testid="allergy-warning"
        >
          <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-orange-800 dark:text-orange-300">
              Uwaga - alergie klienta
            </p>
            <p className="text-sm text-orange-700 dark:text-orange-400 mt-1">
              {appointment.client.allergies}
            </p>
          </div>
        </div>
      )}

      {/* Appointment info */}
      <Card className="mb-6" data-testid="appointment-info-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Informacje o wizycie</CardTitle>
            <Badge variant={getStatusVariant(appointment.status)} data-testid="appointment-status">
              {getStatusLabel(appointment.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Data i godzina
              </p>
              <p className="text-sm flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-primary" />
                {startDate.toLocaleDateString("pl-PL", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
              <p className="text-sm flex items-center gap-1.5 mt-1">
                <Clock className="h-4 w-4 text-primary" />
                {startDate.toLocaleTimeString("pl-PL", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {" - "}
                {endDate.toLocaleTimeString("pl-PL", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                <span className="text-muted-foreground">
                  ({formatDuration(durationMin)})
                </span>
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Usluga
              </p>
              {appointment.service ? (
                <div>
                  <p className="text-sm flex items-center gap-1.5">
                    <Scissors className="h-4 w-4 text-primary" />
                    {appointment.service.name}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {parseFloat(appointment.service.basePrice).toFixed(2)} PLN |{" "}
                    {formatDuration(appointment.service.baseDuration)}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">Brak uslugi</p>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Klient
              </p>
              {appointment.client ? (
                <p className="text-sm flex items-center gap-1.5">
                  <User className="h-4 w-4 text-primary" />
                  <a
                    href={`/dashboard/clients/${appointment.client.id}`}
                    className="text-primary hover:underline"
                    data-testid="client-link"
                  >
                    {appointment.client.firstName} {appointment.client.lastName}
                  </a>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">Brak klienta</p>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Pracownik
              </p>
              {appointment.employee ? (
                <p className="text-sm flex items-center gap-1.5">
                  <User className="h-4 w-4 text-primary" />
                  {appointment.employee.firstName} {appointment.employee.lastName}
                  {appointment.employee.color && (
                    <span
                      className="inline-block w-3 h-3 rounded-full border"
                      style={{ backgroundColor: appointment.employee.color }}
                    />
                  )}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground italic">Brak pracownika</p>
              )}
            </div>

          </div>
        </CardContent>
      </Card>

      {/* Refund Status Section (shown for cancelled appointments with deposits) */}
      {appointment.status === "cancelled" && refundStatus && refundStatus.hasDeposit && (
        <Card className="mb-6" data-testid="refund-status-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">
                {refundStatus.refundStatus === "forfeited" ? "Zadatek - przepadek" : "Status zwrotu zadatku"}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div
              className={`p-4 rounded-lg border ${
                refundStatus.refundStatus === "refunded"
                  ? "bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700"
                  : refundStatus.refundStatus === "forfeited"
                    ? "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700"
                    : refundStatus.paymentStatus === "succeeded" && !appointment.depositPaid
                      ? "bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700"
                      : "bg-orange-50 dark:bg-orange-950/30 border-orange-300 dark:border-orange-700"
              }`}
            >
              <div className="flex items-start gap-3">
                {refundStatus.refundStatus === "refunded" ? (
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                ) : refundStatus.refundStatus === "forfeited" ? (
                  <Ban className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                ) : (
                  <Ban className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
                )}
                <div className="space-y-2 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold" data-testid="refund-status-label">
                      {refundStatus.refundStatus === "refunded"
                        ? "Zwrot zrealizowany"
                        : refundStatus.refundStatus === "forfeited"
                          ? "Zadatek przepadl - zatrzymany przez salon"
                          : "Zadatek zatrzymany"}
                    </p>
                    <Badge
                      variant={refundStatus.refundStatus === "refunded" ? "default" : "destructive"}
                      data-testid="refund-status-badge"
                    >
                      {refundStatus.refundStatus === "refunded"
                        ? "Zwrocono"
                        : refundStatus.refundStatus === "forfeited"
                          ? "Przepadek"
                          : "Brak zwrotu"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Kwota zadatku: </span>
                      <span className="font-medium" data-testid="refund-amount">
                        {refundStatus.depositAmount?.toFixed(2)} PLN
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Metoda platnosci: </span>
                      <span className="font-medium">
                        {refundStatus.paymentMethod === "stripe" ? "Karta (Stripe)" : "BLIK P2P"}
                      </span>
                    </div>
                    {refundStatus.refundedAt && (
                      <div>
                        <span className="text-muted-foreground">Data zwrotu: </span>
                        <span className="font-medium" data-testid="refund-date">
                          {new Date(refundStatus.refundedAt).toLocaleDateString("pl-PL", {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    )}
                    {refundStatus.stripeRefundId && (
                      <div>
                        <span className="text-muted-foreground">ID zwrotu: </span>
                        <span className="font-mono text-xs" data-testid="refund-id">
                          {refundStatus.stripeRefundId}
                        </span>
                      </div>
                    )}
                  </div>
                  {refundStatus.refundReason && (
                    <p className="text-sm text-muted-foreground mt-1" data-testid="refund-reason">
                      Powod: {refundStatus.refundReason}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deposit Info for non-cancelled appointments */}
      {appointment.status !== "cancelled" && appointment.depositAmount && parseFloat(appointment.depositAmount) > 0 && (
        <Card className="mb-6" data-testid="deposit-info-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Zadatek</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div>
                <span className="text-muted-foreground text-sm">Kwota: </span>
                <span className="font-semibold">{parseFloat(appointment.depositAmount).toFixed(2)} PLN</span>
              </div>
              <Badge variant={appointment.depositPaid ? "default" : "outline"} data-testid="deposit-paid-badge">
                {appointment.depositPaid ? "Oplacony" : "Nieoplacony"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Staff Notes Section */}
      <Card className="mb-6" data-testid="notes-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Notatki wewnetrzne</CardTitle>
            </div>
            {!editingNotes && appointment.status !== "cancelled" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStartEditingNotes}
                data-testid="edit-notes-btn"
              >
                <Pencil className="h-4 w-4 mr-1" />
                {appointment.notes ? "Edytuj" : "Dodaj notatke"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editingNotes ? (
            <div className="space-y-3">
              <Textarea
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                placeholder="Dodaj notatki wewnetrzne dla personelu (np. preferencje klienta, szczegoly zabiegu, uwagi)..."
                className="min-h-[120px]"
                data-testid="notes-textarea"
                autoFocus
              />
              <div className="flex items-center gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelEditingNotes}
                  disabled={savingNotes}
                  data-testid="cancel-notes-btn"
                >
                  <X className="h-4 w-4 mr-1" />
                  Anuluj
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveNotes}
                  disabled={savingNotes}
                  data-testid="save-notes-btn"
                >
                  <Save className="h-4 w-4 mr-1" />
                  {savingNotes ? "Zapisywanie..." : "Zapisz notatki"}
                </Button>
              </div>
            </div>
          ) : appointment.notes ? (
            <p className="text-sm whitespace-pre-wrap" data-testid="notes-content">
              {appointment.notes}
            </p>
          ) : (
            <div className="text-center py-6" data-testid="no-notes">
              <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground">Brak notatek wewnetrznych</p>
              <p className="text-sm text-muted-foreground mt-1">
                Dodaj notatki widoczne dla calego personelu
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Treatment record section (shown when completed) */}
      {treatment && (
        <Card className="mb-6" data-testid="treatment-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Notatki z zabiegu</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {treatment.recipe && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                    Receptura
                  </p>
                  <p className="text-sm" data-testid="treatment-recipe">{treatment.recipe}</p>
                </div>
              )}
              {treatment.techniques && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                    Techniki
                  </p>
                  <p className="text-sm" data-testid="treatment-techniques">{treatment.techniques}</p>
                </div>
              )}
              {treatment.notes && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                    Notatki dodatkowe
                  </p>
                  <p className="text-sm" data-testid="treatment-notes">{treatment.notes}</p>
                </div>
              )}
              {!treatment.recipe && !treatment.techniques && !treatment.notes && (
                <p className="text-sm text-muted-foreground italic">
                  Brak notatek z zabiegu
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Commission section (shown when completed) */}
      {commission && (
        <Card className="mb-6" data-testid="commission-card">
          <CardHeader>
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Prowizja pracownika</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                  Pracownik
                </p>
                <p className="text-sm" data-testid="commission-employee">
                  {commission.employee
                    ? `${commission.employee.firstName} ${commission.employee.lastName}`
                    : "Nieznany"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                  Procent prowizji
                </p>
                <p className="text-sm font-medium" data-testid="commission-percentage">
                  {commission.percentage ? `${parseFloat(commission.percentage).toFixed(0)}%` : "N/A"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                  Kwota prowizji
                </p>
                <p className="text-sm font-bold text-green-600" data-testid="commission-amount">
                  {parseFloat(commission.amount).toFixed(2)} PLN
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invoice Section (shown when invoice exists) */}
      {invoice && (
        <Card className="mb-6" data-testid="invoice-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Faktura</CardTitle>
                <Badge variant="default" data-testid="invoice-type-badge">
                  {invoice.type === "paragon" ? "Osoba fizyczna" : "Firma"}
                </Badge>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInvoiceDialogOpen(true)}
                data-testid="view-invoice-details-btn"
              >
                <FileText className="h-4 w-4 mr-1" />
                Podglad
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                  Numer faktury
                </p>
                <p className="text-sm font-mono" data-testid="invoice-number">
                  {invoice.invoiceNumber}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                  Kwota brutto
                </p>
                <p className="text-sm font-bold" data-testid="invoice-amount">
                  {parseFloat(invoice.amount).toFixed(2)} PLN
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                  Nabywca
                </p>
                <p className="text-sm" data-testid="invoice-buyer">
                  {invoice.type === "paragon"
                    ? invoice.clientName || "—"
                    : invoice.companyName || "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fiscal Receipt Section (shown when receipt exists) */}
      {fiscalReceipt && (
        <Card className="mb-6" data-testid="fiscal-receipt-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-primary" />
                <CardTitle className="text-lg">Paragon fiskalny</CardTitle>
                <Badge variant="default" data-testid="receipt-status-badge">
                  {fiscalReceipt.printStatus === "sent"
                    ? "Wyslany"
                    : fiscalReceipt.printStatus === "confirmed"
                      ? "Potwierdzony"
                      : "Blad"}
                </Badge>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReceiptDialogOpen(true)}
                data-testid="view-receipt-details-btn"
              >
                <FileText className="h-4 w-4 mr-1" />
                Podglad
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                  Numer paragonu
                </p>
                <p className="text-sm font-mono" data-testid="receipt-number">
                  {fiscalReceipt.receiptNumber}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                  Kwota brutto
                </p>
                <p className="text-sm font-bold" data-testid="receipt-total">
                  {parseFloat(fiscalReceipt.totalAmount).toFixed(2)} PLN
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                  Data wydruku
                </p>
                <p className="text-sm" data-testid="receipt-date">
                  {new Date(fiscalReceipt.printedAt).toLocaleDateString("pl-PL", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Materials section */}
      <Card data-testid="materials-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Uzyte materialy</CardTitle>
              <Badge variant="secondary" data-testid="materials-count">
                {materials.length}
              </Badge>
            </div>
            {appointment.status !== "completed" && appointment.status !== "cancelled" && (
              <Button
                size="sm"
                onClick={() => setAddMaterialOpen(true)}
                data-testid="add-material-btn"
              >
                <Plus className="h-4 w-4 mr-1" />
                Dodaj material
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {materials.length === 0 ? (
            <div className="text-center py-8" data-testid="no-materials">
              <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground">Nie dodano jeszcze materialow</p>
              <p className="text-sm text-muted-foreground mt-1">
                Dodaj uzyte produkty, aby sledzic stan magazynowy
              </p>
            </div>
          ) : (
            <div className="space-y-3" data-testid="materials-list">
              {materials.map((material) => (
                <div
                  key={material.id}
                  className="flex items-center justify-between p-3 rounded-lg border"
                  data-testid={`material-item-${material.id}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium" data-testid="material-product-name">
                        {material.product?.name || "Nieznany produkt"}
                      </span>
                      {material.product?.category && (
                        <Badge variant="secondary" className="text-xs">
                          {material.product.category}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                      <span data-testid="material-quantity">
                        Zuzyto: {material.quantityUsed}{" "}
                        {material.product?.unit || "szt."}
                      </span>
                      {material.product?.pricePerUnit && (
                        <span>
                          Koszt:{" "}
                          {(
                            parseFloat(material.quantityUsed) *
                            parseFloat(material.product.pricePerUnit)
                          ).toFixed(2)}{" "}
                          PLN
                        </span>
                      )}
                      {material.product && (
                        <a
                          href="/dashboard/products"
                          className="text-primary hover:underline text-xs"
                          data-testid="product-link"
                        >
                          &rarr; Magazyn
                        </a>
                      )}
                    </div>
                    {material.notes && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {material.notes}
                      </p>
                    )}
                  </div>
                  {appointment.status !== "completed" && appointment.status !== "cancelled" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive shrink-0"
                      onClick={() => handleRemoveMaterial(material.id)}
                      data-testid={`remove-material-${material.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}

              {/* Total cost */}
              {totalMaterialCost > 0 && (
                <>
                  <Separator />
                  <div className="flex justify-between items-center px-3">
                    <span className="font-medium">Laczny koszt materialow:</span>
                    <span className="font-bold" data-testid="total-material-cost">
                      {totalMaterialCost.toFixed(2)} PLN
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

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
      <Dialog open={receiptDialogOpen} onOpenChange={setReceiptDialogOpen}>
        <DialogContent className="max-w-lg" data-testid="receipt-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              {fiscalReceipt ? "Podglad paragonu fiskalnego" : "Drukuj paragon fiskalny"}
            </DialogTitle>
          </DialogHeader>

          {fiscalReceipt ? (
            /* Receipt Preview */
            <div className="space-y-4">
              {/* Receipt preview styled like a thermal printer receipt */}
              <div
                className="bg-white dark:bg-gray-900 border rounded-lg p-4 font-mono text-xs space-y-2"
                data-testid="receipt-preview"
              >
                {/* Header */}
                <div className="text-center space-y-0.5">
                  {fiscalReceipt.receiptDataJson?.header.line1 && (
                    <p className="font-bold text-sm">{fiscalReceipt.receiptDataJson.header.line1}</p>
                  )}
                  {fiscalReceipt.receiptDataJson?.header.line2 && (
                    <p>{fiscalReceipt.receiptDataJson.header.line2}</p>
                  )}
                  {fiscalReceipt.receiptDataJson?.header.line3 && (
                    <p>{fiscalReceipt.receiptDataJson.header.line3}</p>
                  )}
                  {fiscalReceipt.receiptDataJson?.header.nip && (
                    <p>{fiscalReceipt.receiptDataJson.header.nip}</p>
                  )}
                </div>
                <Separator />

                {/* Receipt number and date */}
                <div className="flex justify-between">
                  <span>{fiscalReceipt.receiptDataJson?.receiptNumber}</span>
                  <span>{fiscalReceipt.receiptDataJson?.date} {fiscalReceipt.receiptDataJson?.time}</span>
                </div>
                <Separator />

                {/* Items */}
                <div className="space-y-1">
                  {fiscalReceipt.receiptDataJson?.items.map((item, idx) => (
                    <div key={idx}>
                      <p className="font-medium">{item.name}</p>
                      <div className="flex justify-between pl-2">
                        <span>{item.quantity} x {item.unitPrice} PLN</span>
                        <span>{item.total} PLN ({item.vatRate})</span>
                      </div>
                    </div>
                  ))}
                </div>
                <Separator />

                {/* Summary */}
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span>Netto:</span>
                    <span>{fiscalReceipt.receiptDataJson?.summary.netAmount} PLN</span>
                  </div>
                  <div className="flex justify-between">
                    <span>VAT ({fiscalReceipt.receiptDataJson?.summary.vatRate}):</span>
                    <span>{fiscalReceipt.receiptDataJson?.summary.vatAmount} PLN</span>
                  </div>
                  <div className="flex justify-between font-bold text-sm">
                    <span>RAZEM:</span>
                    <span>{fiscalReceipt.receiptDataJson?.summary.totalAmount} PLN</span>
                  </div>
                </div>
                <Separator />

                {/* Payment method */}
                <div className="flex justify-between">
                  <span>Platnosc:</span>
                  <span>{fiscalReceipt.receiptDataJson?.paymentMethod}</span>
                </div>

                {/* Footer */}
                <div className="text-center mt-3 pt-2">
                  <p className="text-muted-foreground">{fiscalReceipt.receiptDataJson?.footer}</p>
                </div>
              </div>

              {/* Receipt metadata */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Drukarka: </span>
                  <span>{fiscalReceipt.printerModel || "N/A"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status: </span>
                  <Badge variant="default" className="text-xs">
                    {fiscalReceipt.printStatus === "sent" ? "Wyslany do drukarki" : fiscalReceipt.printStatus}
                  </Badge>
                </div>
              </div>
            </div>
          ) : (
            /* Print new receipt form */
            <div className="space-y-4">
              <div className="p-4 rounded-lg border bg-muted/50">
                <h4 className="font-medium mb-2">Podsumowanie wizyty</h4>
                <div className="space-y-1 text-sm">
                  {appointment.service && (
                    <div className="flex justify-between">
                      <span>{appointment.service.name}</span>
                      <span>{parseFloat(appointment.service.basePrice).toFixed(2)} PLN</span>
                    </div>
                  )}
                  {totalMaterialCost > 0 && (
                    <div className="flex justify-between">
                      <span>Materialy</span>
                      <span>{totalMaterialCost.toFixed(2)} PLN</span>
                    </div>
                  )}
                  <Separator className="my-2" />
                  <div className="flex justify-between font-bold">
                    <span>Razem</span>
                    <span>
                      {(
                        parseFloat(appointment.service?.basePrice || "0") +
                        totalMaterialCost
                      ).toFixed(2)}{" "}
                      PLN
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-sm font-medium">Metoda platnosci</Label>
                <Select
                  value={selectedPaymentMethod}
                  onValueChange={setSelectedPaymentMethod}
                >
                  <SelectTrigger className="mt-1" data-testid="payment-method-select">
                    <SelectValue placeholder="Wybierz metode platnosci" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Gotowka</SelectItem>
                    <SelectItem value="card">Karta</SelectItem>
                    <SelectItem value="transfer">Przelew</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-start gap-2 text-sm text-muted-foreground p-3 rounded-lg border bg-muted/30">
                <Printer className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                  Paragon zostanie wyslany do skonfigurowanej drukarki fiskalnej.
                  Upewnij sie, ze drukarka jest wlaczona i polaczona.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReceiptDialogOpen(false)}
            >
              {fiscalReceipt ? "Zamknij" : "Anuluj"}
            </Button>
            {!fiscalReceipt && (
              <Button
                onClick={handlePrintReceipt}
                disabled={printingReceipt}
                data-testid="confirm-print-receipt-btn"
              >
                <Printer className="h-4 w-4 mr-2" />
                {printingReceipt ? "Drukowanie..." : "Drukuj paragon"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invoice Dialog */}
      <Dialog open={invoiceDialogOpen} onOpenChange={setInvoiceDialogOpen}>
        <DialogContent className="max-w-lg" data-testid="invoice-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {invoice ? "Podglad faktury" : "Generuj fakture"}
            </DialogTitle>
          </DialogHeader>

          {invoice ? (
            /* Invoice Preview */
            <div className="space-y-4">
              <div
                className="bg-white dark:bg-gray-900 border rounded-lg p-4 space-y-3"
                data-testid="invoice-preview"
              >
                {/* Header */}
                <div className="text-center">
                  <p className="font-bold text-lg">
                    {invoice.type === "paragon" ? "RACHUNEK" : "FAKTURA VAT"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Nr: {invoice.invoiceNumber}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Data wystawienia:{" "}
                    {new Date(invoice.issuedAt).toLocaleDateString("pl-PL", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                </div>

                <Separator />

                {/* Seller and Buyer */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                      Sprzedawca
                    </p>
                    {invoice.invoiceDataJson?.seller && (
                      <>
                        <p className="font-medium">{invoice.invoiceDataJson.seller.name}</p>
                        {invoice.invoiceDataJson.seller.address && (
                          <p className="text-muted-foreground">{invoice.invoiceDataJson.seller.address}</p>
                        )}
                        {invoice.invoiceDataJson.seller.nip && (
                          <p className="text-muted-foreground">NIP: {invoice.invoiceDataJson.seller.nip}</p>
                        )}
                      </>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                      Nabywca
                    </p>
                    {invoice.invoiceDataJson?.buyer && (
                      <>
                        <p className="font-medium">{invoice.invoiceDataJson.buyer.name || "—"}</p>
                        {invoice.invoiceDataJson.buyer.address && (
                          <p className="text-muted-foreground">{invoice.invoiceDataJson.buyer.address}</p>
                        )}
                        {invoice.invoiceDataJson.buyer.nip && (
                          <p className="text-muted-foreground">NIP: {invoice.invoiceDataJson.buyer.nip}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <Separator />

                {/* Items */}
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between font-medium text-xs text-muted-foreground uppercase">
                    <span>Pozycja</span>
                    <span>Kwota brutto</span>
                  </div>
                  {invoice.invoiceDataJson?.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span>
                        {item.name} x{item.quantity}
                      </span>
                      <span>{item.total} PLN</span>
                    </div>
                  ))}
                </div>

                <Separator />

                {/* Summary */}
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Netto:</span>
                    <span>{invoice.invoiceDataJson?.summary.netAmount} PLN</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      VAT ({invoice.invoiceDataJson?.summary.vatRate}):
                    </span>
                    <span>{invoice.invoiceDataJson?.summary.vatAmount} PLN</span>
                  </div>
                  <div className="flex justify-between font-bold text-base">
                    <span>RAZEM:</span>
                    <span>{invoice.invoiceDataJson?.summary.totalAmount} PLN</span>
                  </div>
                </div>

                <Separator />

                {/* Payment and Appointment info */}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Platnosc: </span>
                    <span>{invoice.invoiceDataJson?.paymentMethod}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Data wizyty: </span>
                    <span>{invoice.invoiceDataJson?.appointmentDate}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Generate Invoice Form */
            <div className="space-y-4">
              {/* Visit summary */}
              <div className="p-4 rounded-lg border bg-muted/50">
                <h4 className="font-medium mb-2">Podsumowanie wizyty</h4>
                <div className="space-y-1 text-sm">
                  {appointment.service && (
                    <div className="flex justify-between">
                      <span>{appointment.service.name}</span>
                      <span>
                        {parseFloat(appointment.service.basePrice).toFixed(2)} PLN
                      </span>
                    </div>
                  )}
                  {totalMaterialCost > 0 && (
                    <div className="flex justify-between">
                      <span>Materialy</span>
                      <span>{totalMaterialCost.toFixed(2)} PLN</span>
                    </div>
                  )}
                  <Separator className="my-2" />
                  <div className="flex justify-between font-bold">
                    <span>Razem</span>
                    <span>
                      {(
                        parseFloat(appointment.service?.basePrice || "0") +
                        totalMaterialCost
                      ).toFixed(2)}{" "}
                      PLN
                    </span>
                  </div>
                </div>
              </div>

              {/* Invoice type selector */}
              <div>
                <Label className="text-sm font-medium">Typ faktury *</Label>
                <Select
                  value={invoiceType}
                  onValueChange={(val) =>
                    setInvoiceType(val as "paragon" | "faktura")
                  }
                >
                  <SelectTrigger className="mt-1" data-testid="invoice-type-select">
                    <SelectValue placeholder="Wybierz typ" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paragon">
                      Osoba fizyczna (rachunek)
                    </SelectItem>
                    <SelectItem value="faktura">
                      Firma (faktura VAT)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Individual invoice fields */}
              {invoiceType === "paragon" && (
                <>
                  <div>
                    <Label className="text-sm font-medium">
                      Imie i nazwisko klienta *
                    </Label>
                    <Input
                      value={invoiceClientName}
                      onChange={(e) => setInvoiceClientName(e.target.value)}
                      placeholder="np. Jan Kowalski"
                      className="mt-1"
                      data-testid="invoice-client-name-input"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium">
                      Adres klienta (opcjonalnie)
                    </Label>
                    <Input
                      value={invoiceClientAddress}
                      onChange={(e) => setInvoiceClientAddress(e.target.value)}
                      placeholder="np. ul. Kwiatowa 5, 00-001 Warszawa"
                      className="mt-1"
                      data-testid="invoice-client-address-input"
                    />
                  </div>
                </>
              )}

              {/* Company invoice fields */}
              {invoiceType === "faktura" && (
                <>
                  <div>
                    <Label className="text-sm font-medium">
                      Nazwa firmy *
                    </Label>
                    <Input
                      value={invoiceCompanyName}
                      onChange={(e) => setInvoiceCompanyName(e.target.value)}
                      placeholder="np. Firma XYZ Sp. z o.o."
                      className="mt-1"
                      data-testid="invoice-company-name-input"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium">
                      NIP *
                    </Label>
                    <Input
                      value={invoiceCompanyNip}
                      onChange={(e) => setInvoiceCompanyNip(e.target.value)}
                      placeholder="np. 1234567890"
                      className="mt-1"
                      data-testid="invoice-company-nip-input"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      10 cyfr, bez kresek
                    </p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">
                      Adres firmy (opcjonalnie)
                    </Label>
                    <Input
                      value={invoiceCompanyAddress}
                      onChange={(e) => setInvoiceCompanyAddress(e.target.value)}
                      placeholder="np. ul. Biznesowa 10, 00-100 Warszawa"
                      className="mt-1"
                      data-testid="invoice-company-address-input"
                    />
                  </div>
                </>
              )}

              {/* Payment method */}
              <div>
                <Label className="text-sm font-medium">Metoda platnosci</Label>
                <Select
                  value={invoicePaymentMethod}
                  onValueChange={setInvoicePaymentMethod}
                >
                  <SelectTrigger
                    className="mt-1"
                    data-testid="invoice-payment-method-select"
                  >
                    <SelectValue placeholder="Wybierz metode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Gotowka</SelectItem>
                    <SelectItem value="card">Karta</SelectItem>
                    <SelectItem value="transfer">Przelew</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInvoiceDialogOpen(false)}
            >
              {invoice ? "Zamknij" : "Anuluj"}
            </Button>
            {!invoice && (
              <Button
                onClick={handleGenerateInvoice}
                disabled={generatingInvoice}
                data-testid="confirm-generate-invoice-btn"
              >
                <FileText className="h-4 w-4 mr-2" />
                {generatingInvoice ? "Generowanie..." : "Generuj fakture"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Material Dialog */}
      <Dialog open={addMaterialOpen} onOpenChange={setAddMaterialOpen}>
        <DialogContent className="max-w-md" data-testid="add-material-dialog">
          <DialogHeader>
            <DialogTitle>Dodaj zuzyty material</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Produkt *</Label>
              <Select
                value={selectedProductId}
                onValueChange={setSelectedProductId}
              >
                <SelectTrigger data-testid="material-product-select">
                  <SelectValue placeholder="Wybierz produkt z magazynu" />
                </SelectTrigger>
                <SelectContent>
                  {availableProducts.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                      {product.quantity && product.unit
                        ? ` (${product.quantity} ${product.unit})`
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedProductId && (() => {
                const selected = availableProducts.find(
                  (p) => p.id === selectedProductId
                );
                if (!selected) return null;
                return (
                  <p className="text-xs text-muted-foreground mt-1">
                    Dostepne w magazynie: {selected.quantity || "0"}{" "}
                    {selected.unit || "szt."}
                    {selected.pricePerUnit &&
                      ` | Cena: ${parseFloat(selected.pricePerUnit).toFixed(2)} PLN/${selected.unit || "szt."}`}
                  </p>
                );
              })()}
            </div>
            <div>
              <Label>Ilosc *</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={materialQuantity}
                onChange={(e) => setMaterialQuantity(e.target.value)}
                placeholder="np. 50"
                data-testid="material-quantity-input"
              />
            </div>
            <div>
              <Label>Notatka (opcjonalnie)</Label>
              <Input
                value={materialNotes}
                onChange={(e) => setMaterialNotes(e.target.value)}
                placeholder="np. Kolor 6/0 + 7/0 mix"
                data-testid="material-notes-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddMaterialOpen(false)}
            >
              Anuluj
            </Button>
            <Button
              onClick={handleAddMaterial}
              disabled={addingMaterial}
              data-testid="confirm-add-material-btn"
            >
              {addingMaterial ? "Dodawanie..." : "Dodaj material"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
