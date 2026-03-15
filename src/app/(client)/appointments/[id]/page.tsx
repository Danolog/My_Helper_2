"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import {
  CalendarDays,
  MapPin,
  ArrowLeft,
  Scissors,
  Phone,
  Mail,
  CalendarCheck,
  CalendarX,
  AlertCircle,
  CheckCircle2,
  Timer,
  Wallet,
  CreditCard,
  FileText,
  Receipt,
  ShieldCheck,
  Ban,
  AlertTriangle,
  Clock,
  DollarSign,
  RefreshCw,
  XCircle,
  Star,
  MessageSquare,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/lib/auth-client";
import { mutationFetch } from "@/lib/api-client";
import { toast } from "sonner";

interface TreatmentInfo {
  id: string;
  recipe: string | null;
  techniques: string | null;
  notes: string | null;
  materialsJson: unknown;
}

interface DepositPaymentInfo {
  amount: string;
  currency: string;
  paymentMethod: string;
  blikPhoneNumber: string | null;
  status: string;
  paidAt: string | null;
}

interface AppointmentDetail {
  id: string;
  salonId: string;
  salonName: string;
  salonAddress: string | null;
  salonPhone: string | null;
  salonEmail: string | null;
  employeeName: string;
  employeeColor: string | null;
  serviceName: string;
  serviceDescription: string | null;
  servicePrice: string | null;
  serviceDuration: number | null;
  variantName: string | null;
  variantPriceModifier: string | null;
  variantDurationModifier: number | null;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  depositAmount: string | null;
  depositPaid: boolean | null;
  createdAt: string;
  treatment: TreatmentInfo | null;
  depositPayment: DepositPaymentInfo | null;
}

interface ReviewInfo {
  id: string;
  rating: number;
  comment: string | null;
  status: string; // 'pending', 'approved', 'rejected'
  createdAt: string;
}

interface CancelInfo {
  appointmentId: string;
  status: string;
  startTime: string;
  endTime: string;
  hoursUntilAppointment: number;
  isMoreThan24h: boolean;
  isPast: boolean;
  canCancel: boolean;
  deposit: {
    amount: number;
    paid: boolean;
    action: "refund" | "forfeit" | "none";
  };
  employee: { name: string } | null;
  service: { name: string; price: string } | null;
  salon: { name: string } | null;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) return `${hours}h`;
  return `${hours}h ${remaining}min`;
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeRemaining(hours: number): string {
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return `${minutes} min`;
  }
  if (hours < 48) {
    return `${Math.round(hours)}h`;
  }
  const days = Math.round(hours / 24);
  return `${days} dni`;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "scheduled":
      return (
        <Badge className="bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300">
          <Timer className="w-3 h-3 mr-1" />
          Zaplanowana
        </Badge>
      );
    case "confirmed":
      return (
        <Badge className="bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300">
          <CalendarCheck className="w-3 h-3 mr-1" />
          Potwierdzona
        </Badge>
      );
    case "completed":
      return (
        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Zakonczona
        </Badge>
      );
    case "cancelled":
      return (
        <Badge className="bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300">
          <CalendarX className="w-3 h-3 mr-1" />
          Anulowana
        </Badge>
      );
    case "no_show":
      return (
        <Badge className="bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300">
          <AlertCircle className="w-3 h-3 mr-1" />
          Nieobecnosc
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function isUpcoming(startTime: string, status: string): boolean {
  return (
    new Date(startTime) > new Date() &&
    status !== "cancelled" &&
    status !== "completed" &&
    status !== "no_show"
  );
}

export default function AppointmentDetailPage() {
  const params = useParams();
  const appointmentId = params.id as string;
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [appointment, setAppointment] = useState<AppointmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cancel dialog state
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelInfo, setCancelInfo] = useState<CancelInfo | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Review state
  const [existingReview, setExistingReview] = useState<ReviewInfo | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewHoverRating, setReviewHoverRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  const fetchAppointment = useCallback(async () => {
    try {
      const res = await fetch(`/api/client/appointments/${appointmentId}`);
      const json = await res.json();
      if (json.success) {
        setAppointment(json.data);
      } else {
        setError(json.error || "Nie znaleziono wizyty");
      }
    } catch {
      setError("Blad ladowania danych wizyty");
    } finally {
      setLoading(false);
    }
  }, [appointmentId]);

  // Fetch existing review for this appointment
  const fetchReview = useCallback(async () => {
    setReviewLoading(true);
    try {
      const res = await fetch(`/api/client/appointments/${appointmentId}/review`);
      const json = await res.json();
      if (json.success && json.data) {
        setExistingReview(json.data);
      }
    } catch {
    } finally {
      setReviewLoading(false);
    }
  }, [appointmentId]);

  // Submit review
  const handleSubmitReview = async () => {
    if (reviewRating === 0) {
      toast.error("Wybierz ocene od 1 do 5 gwiazdek");
      return;
    }
    setSubmittingReview(true);
    try {
      const res = await mutationFetch(`/api/client/appointments/${appointmentId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: reviewRating,
          comment: reviewComment.trim() || null,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success("Opinia zostala dodana!", {
          description: "Dziekujemy za Twoja opinie. Opinia oczekuje na moderacje.",
        });
        setExistingReview(json.data);
        setShowReviewForm(false);
        setReviewRating(0);
        setReviewComment("");
      } else {
        toast.error("Nie udalo sie dodac opinii", {
          description: json.error,
        });
      }
    } catch {
      toast.error("Blad podczas dodawania opinii");
    } finally {
      setSubmittingReview(false);
    }
  };

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/login");
      return;
    }
    if (session) {
      fetchAppointment();
    }
  }, [session, isPending, router, fetchAppointment]);

  // Fetch review once appointment is loaded and is completed
  useEffect(() => {
    if (appointment?.status === "completed") {
      fetchReview();
    }
  }, [appointment?.status, fetchReview]);

  // Fetch cancellation info when dialog opens
  const fetchCancelInfo = useCallback(async () => {
    setCancelLoading(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/client/appointments/${appointmentId}/cancel`);
      const data = await res.json();
      if (data.success) {
        setCancelInfo(data.data);
      } else {
        setCancelError(data.error || "Nie udalo sie pobrac informacji o anulowaniu");
      }
    } catch {
      setCancelError("Blad polaczenia z serwerem");
    } finally {
      setCancelLoading(false);
    }
  }, [appointmentId]);

  useEffect(() => {
    if (cancelDialogOpen) {
      fetchCancelInfo();
    } else {
      setCancelInfo(null);
      setCancelError(null);
    }
  }, [cancelDialogOpen, fetchCancelInfo]);

  // Handle the actual cancellation
  const handleCancelAppointment = async () => {
    setCancelling(true);
    try {
      const res = await mutationFetch(`/api/client/appointments/${appointmentId}/cancel`, {
        method: "POST",
      });
      const data = await res.json();

      if (data.success) {
        const details = data.cancellationDetails;
        let description = "Twoja wizyta zostala pomyslnie anulowana.";

        if (details?.depositRefunded) {
          description += ` Zadatek ${details.depositAmount.toFixed(2)} PLN zostanie zwrocony.`;
        } else if (details?.depositForfeited) {
          description += ` Zadatek ${details.depositAmount.toFixed(2)} PLN nie podlega zwrotowi.`;
        }

        toast.success("Wizyta anulowana", { description });
        setCancelDialogOpen(false);
        // Refresh appointment data to show updated status
        fetchAppointment();
      } else {
        toast.error("Nie udalo sie anulowac wizyty", {
          description: data.error,
        });
      }
    } catch {
      toast.error("Blad podczas anulowania wizyty");
    } finally {
      setCancelling(false);
    }
  };

  if (isPending || loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  if (error || !appointment) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <div className="mb-6">
          <Button variant="ghost" asChild>
            <Link href="/appointments">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Powrot do moich wizyt
            </Link>
          </Button>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold mb-2">
              {error || "Wizyta nie znaleziona"}
            </h2>
            <Button asChild>
              <Link href="/appointments">Powrot do moich wizyt</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Calculate effective price
  const basePrice = appointment.servicePrice ? parseFloat(appointment.servicePrice) : 0;
  const variantPriceModifier = appointment.variantPriceModifier
    ? parseFloat(appointment.variantPriceModifier)
    : 0;
  const effectivePrice = basePrice + variantPriceModifier;

  // Calculate effective duration
  const baseDuration = appointment.serviceDuration || 0;
  const variantDurationModifier = appointment.variantDurationModifier || 0;
  const effectiveDuration = baseDuration + variantDurationModifier;

  // Can this appointment be cancelled?
  const canCancel = isUpcoming(appointment.startTime, appointment.status);

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      {/* Back navigation */}
      <div className="mb-6">
        <Button variant="ghost" asChild>
          <Link href="/appointments">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Powrot do moich wizyt
          </Link>
        </Button>
      </div>

      {/* Header with status */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <Receipt className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Szczegoly wizyty</h1>
            <p className="text-sm text-muted-foreground">
              Zarezerwowano {new Date(appointment.createdAt).toLocaleDateString("pl-PL")}
            </p>
          </div>
        </div>
        {getStatusBadge(appointment.status)}
      </div>

      {/* Main appointment info */}
      <Card className="mb-4" data-testid="appointment-detail-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="w-5 h-5 text-primary" />
            Termin wizyty
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm" data-testid="detail-date">
            <span className="text-muted-foreground">Data:</span>
            <span className="font-medium">{formatDate(appointment.startTime)}</span>
          </div>
          <div className="flex justify-between text-sm" data-testid="detail-time">
            <span className="text-muted-foreground">Godzina:</span>
            <span className="font-medium">
              {formatTime(appointment.startTime)} - {formatTime(appointment.endTime)}
            </span>
          </div>
          {effectiveDuration > 0 && (
            <div className="flex justify-between text-sm" data-testid="detail-duration">
              <span className="text-muted-foreground">Czas trwania:</span>
              <span className="font-medium">{formatDuration(effectiveDuration)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Service info */}
      <Card className="mb-4" data-testid="service-detail-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Scissors className="w-5 h-5 text-primary" />
            Usluga
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm" data-testid="detail-service">
            <span className="text-muted-foreground">Usluga:</span>
            <span className="font-medium">{appointment.serviceName}</span>
          </div>
          {appointment.variantName && (
            <div className="flex justify-between text-sm" data-testid="detail-variant">
              <span className="text-muted-foreground">Wariant:</span>
              <span className="font-medium">{appointment.variantName}</span>
            </div>
          )}
          {appointment.serviceDescription && (
            <div className="text-sm" data-testid="detail-service-desc">
              <span className="text-muted-foreground">Opis: </span>
              <span>{appointment.serviceDescription}</span>
            </div>
          )}
          <div className="flex justify-between text-sm" data-testid="detail-employee">
            <span className="text-muted-foreground">Pracownik:</span>
            <div className="flex items-center gap-1.5">
              {appointment.employeeColor && (
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: appointment.employeeColor }}
                />
              )}
              <span className="font-medium">{appointment.employeeName}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Receipt / Pricing */}
      <Card className="mb-4" data-testid="receipt-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="w-5 h-5 text-primary" />
            Podsumowanie kosztow
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {appointment.serviceName}
              {appointment.variantName ? ` - ${appointment.variantName}` : ""}
            </span>
            <span className="font-medium">{effectivePrice.toFixed(2)} PLN</span>
          </div>
          {appointment.variantPriceModifier && variantPriceModifier !== 0 && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                Cena bazowa: {basePrice.toFixed(2)} PLN + wariant:{" "}
                {variantPriceModifier > 0 ? "+" : ""}
                {variantPriceModifier.toFixed(2)} PLN
              </span>
            </div>
          )}

          {/* Deposit info */}
          {appointment.depositAmount && parseFloat(appointment.depositAmount) > 0 && (
            <>
              <Separator />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Wallet className="w-3 h-3" />
                  Zadatek:
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {parseFloat(appointment.depositAmount).toFixed(2)} PLN
                  </span>
                  {appointment.depositPaid ? (
                    <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300">
                      <ShieldCheck className="w-3 h-3 mr-1" />
                      Oplacony
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300">
                      Oczekujacy
                    </Badge>
                  )}
                </div>
              </div>
              {appointment.depositPaid && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Do zaplaty w salonie:</span>
                  <span className="font-semibold">
                    {(effectivePrice - parseFloat(appointment.depositAmount)).toFixed(2)} PLN
                  </span>
                </div>
              )}
            </>
          )}

          <Separator />
          <div className="flex justify-between text-base font-semibold" data-testid="detail-total-price">
            <span>Razem:</span>
            <span>{effectivePrice.toFixed(2)} PLN</span>
          </div>

          {/* Deposit payment details */}
          {appointment.depositPayment && (
            <div className="mt-3 p-3 bg-muted/50 rounded-md">
              <p className="text-xs font-medium text-muted-foreground mb-2">Platnosc zadatku:</p>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Metoda:</span>
                  <span className="flex items-center gap-1">
                    <CreditCard className="w-3 h-3" />
                    {appointment.depositPayment.paymentMethod === "stripe" ? "Karta" : "BLIK P2P"}
                  </span>
                </div>
                {appointment.depositPayment.paymentMethod === "blik" && appointment.depositPayment.blikPhoneNumber && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Telefon BLIK:</span>
                    <span>{appointment.depositPayment.blikPhoneNumber}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Status:</span>
                  <span className={
                    appointment.depositPayment.status === "succeeded" ? "text-green-600" :
                    appointment.depositPayment.status === "refunded" ? "text-blue-600" :
                    appointment.depositPayment.status === "forfeited" ? "text-red-600 font-medium" : ""
                  }>
                    {appointment.depositPayment.status === "succeeded" ? "Zrealizowana" :
                     appointment.depositPayment.status === "refunded" ? "Zwrocona" :
                     appointment.depositPayment.status === "forfeited" ? "Przepadek (zatrzymana przez salon)" :
                     appointment.depositPayment.status}
                  </span>
                </div>
                {appointment.depositPayment.paidAt && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Data platnosci:</span>
                    <span>{new Date(appointment.depositPayment.paidAt).toLocaleDateString("pl-PL")}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Salon info */}
      <Card className="mb-4" data-testid="salon-detail-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MapPin className="w-5 h-5 text-primary" />
            Salon
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm" data-testid="detail-salon">
            <span className="text-muted-foreground">Nazwa:</span>
            <Link
              href={`/salons/${appointment.salonId}`}
              className="font-medium text-primary hover:underline"
            >
              {appointment.salonName}
            </Link>
          </div>
          {appointment.salonAddress && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Adres:</span>
              <span className="font-medium text-right max-w-[200px]">
                {appointment.salonAddress}
              </span>
            </div>
          )}
          {appointment.salonPhone && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Telefon:</span>
              <a href={`tel:${appointment.salonPhone}`} className="font-medium flex items-center gap-1 text-primary hover:underline">
                <Phone className="w-3 h-3" />
                {appointment.salonPhone}
              </a>
            </div>
          )}
          {appointment.salonEmail && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Email:</span>
              <a href={`mailto:${appointment.salonEmail}`} className="font-medium flex items-center gap-1 text-primary hover:underline">
                <Mail className="w-3 h-3" />
                {appointment.salonEmail}
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Treatment notes (for completed appointments) */}
      {appointment.treatment && (
        <Card className="mb-4" data-testid="treatment-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="w-5 h-5 text-primary" />
              Notatki z zabiegu
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {appointment.treatment.recipe && (
              <div className="text-sm">
                <span className="text-muted-foreground font-medium">Receptura: </span>
                <span>{appointment.treatment.recipe}</span>
              </div>
            )}
            {appointment.treatment.techniques && (
              <div className="text-sm">
                <span className="text-muted-foreground font-medium">Techniki: </span>
                <span>{appointment.treatment.techniques}</span>
              </div>
            )}
            {appointment.treatment.notes && (
              <div className="text-sm">
                <span className="text-muted-foreground font-medium">Uwagi: </span>
                <span>{appointment.treatment.notes}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Appointment notes */}
      {appointment.notes && (
        <Card className="mb-4" data-testid="notes-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="w-5 h-5 text-primary" />
              Notatki
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{appointment.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Review section - only for completed appointments */}
      {appointment.status === "completed" && (
        <Card className="mb-4" data-testid="review-section-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Star className="w-5 h-5 text-primary" />
              Opinia
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reviewLoading && (
              <div className="flex justify-center items-center py-6">
                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Existing review display */}
            {!reviewLoading && existingReview && (
              <div className="space-y-3" data-testid="existing-review">
                <div className="flex items-center gap-1" data-testid="review-stars-display">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`w-5 h-5 ${
                        star <= existingReview.rating
                          ? "fill-yellow-400 text-yellow-400"
                          : "text-gray-300 dark:text-gray-600"
                      }`}
                    />
                  ))}
                  <span className="text-sm font-medium ml-2">
                    {existingReview.rating}/5
                  </span>
                </div>

                {existingReview.comment && (
                  <div className="p-3 rounded-md bg-muted/50 border" data-testid="review-comment-display">
                    <p className="text-sm">{existingReview.comment}</p>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      existingReview.status === "pending"
                        ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700"
                        : existingReview.status === "approved"
                        ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700"
                        : "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700"
                    }
                    data-testid="review-status-badge"
                  >
                    {existingReview.status === "pending" && "Oczekuje na moderacje"}
                    {existingReview.status === "approved" && "Zatwierdzona"}
                    {existingReview.status === "rejected" && "Odrzucona"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(existingReview.createdAt).toLocaleDateString("pl-PL")}
                  </span>
                </div>
              </div>
            )}

            {/* Leave Review button */}
            {!reviewLoading && !existingReview && !showReviewForm && (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground mb-3">
                  Podziel sie swoimi wrazeniami z wizyty
                </p>
                <Button
                  onClick={() => setShowReviewForm(true)}
                  data-testid="leave-review-btn"
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Wystaw opinie
                </Button>
              </div>
            )}

            {/* Review form */}
            {!reviewLoading && !existingReview && showReviewForm && (
              <div className="space-y-4" data-testid="review-form">
                {/* Star rating input */}
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Ocena
                  </label>
                  <div
                    className="flex items-center gap-1"
                    data-testid="star-rating-input"
                  >
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setReviewRating(star)}
                        onMouseEnter={() => setReviewHoverRating(star)}
                        onMouseLeave={() => setReviewHoverRating(0)}
                        className="p-0.5 transition-transform hover:scale-110"
                        data-testid={`star-${star}`}
                      >
                        <Star
                          className={`w-8 h-8 transition-colors ${
                            star <= (reviewHoverRating || reviewRating)
                              ? "fill-yellow-400 text-yellow-400"
                              : "text-gray-300 dark:text-gray-600"
                          }`}
                        />
                      </button>
                    ))}
                    {reviewRating > 0 && (
                      <span className="text-sm font-medium ml-2" data-testid="rating-label">
                        {reviewRating}/5
                      </span>
                    )}
                  </div>
                </div>

                {/* Comment textarea */}
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Komentarz (opcjonalnie)
                  </label>
                  <Textarea
                    placeholder="Opisz swoje wrazenia z wizyty..."
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    rows={4}
                    className="resize-none"
                    data-testid="review-comment-input"
                  />
                </div>

                {/* Submit buttons */}
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowReviewForm(false);
                      setReviewRating(0);
                      setReviewComment("");
                    }}
                    disabled={submittingReview}
                    data-testid="cancel-review-btn"
                  >
                    Anuluj
                  </Button>
                  <Button
                    onClick={handleSubmitReview}
                    disabled={submittingReview || reviewRating === 0}
                    data-testid="submit-review-btn"
                  >
                    {submittingReview ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Wysylanie...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Wyslij opinie
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3 mt-6">
        {/* Cancel button - only for upcoming appointments that haven't been cancelled/completed */}
        {canCancel && (
          <Button
            variant="destructive"
            onClick={() => setCancelDialogOpen(true)}
            data-testid="cancel-appointment-btn"
          >
            <Ban className="w-4 h-4 mr-2" />
            Anuluj wizyte
          </Button>
        )}

        {/* Cancelled status message */}
        {appointment.status === "cancelled" && (
          <Card className="border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20" data-testid="cancelled-status-card">
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <CalendarX className="w-5 h-5" />
                <span className="font-medium">Ta wizyta zostala anulowana</span>
              </div>
              {/* Show forfeited deposit info */}
              {appointment.depositPayment?.status === "forfeited" && appointment.depositAmount && (
                <div className="mt-3 p-3 rounded-md bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800" data-testid="forfeited-deposit-info">
                  <div className="flex items-start gap-2">
                    <DollarSign className="w-4 h-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium text-red-700 dark:text-red-400">
                        Zadatek przepadl: {parseFloat(appointment.depositAmount).toFixed(2)} PLN
                      </p>
                      <p className="text-red-600 dark:text-red-400 text-xs mt-1">
                        Anulacja mniej niz 24h przed wizyta - zadatek nie podlega zwrotowi i zostaje zatrzymany przez salon.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {/* Show refunded deposit info */}
              {appointment.depositPayment?.status === "refunded" && appointment.depositAmount && (
                <div className="mt-3 p-3 rounded-md bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800" data-testid="refunded-deposit-info">
                  <div className="flex items-start gap-2">
                    <DollarSign className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium text-blue-700 dark:text-blue-400">
                        Zadatek zwrocony: {parseFloat(appointment.depositAmount).toFixed(2)} PLN
                      </p>
                      <p className="text-blue-600 dark:text-blue-400 text-xs mt-1">
                        Zwrot zostanie przetworzony w ciagu 5-10 dni roboczych.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Button asChild variant="outline">
          <Link href={`/salons/${appointment.salonId}/book`}>
            <CalendarDays className="w-4 h-4 mr-2" />
            Zarezerwuj ponownie w tym salonie
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/appointments">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Powrot do moich wizyt
          </Link>
        </Button>
      </div>

      {/* Cancel Appointment Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="max-w-md" data-testid="client-cancel-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Ban className="h-5 w-5" />
              Anulowanie wizyty
            </DialogTitle>
          </DialogHeader>

          {cancelLoading && (
            <div className="flex justify-center items-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {cancelError && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
              <XCircle className="h-4 w-4 shrink-0" />
              {cancelError}
            </div>
          )}

          {cancelInfo && !cancelLoading && (
            <div className="space-y-4">
              {/* Appointment summary */}
              <div className="space-y-2 p-3 rounded-lg bg-muted/50 border">
                {cancelInfo.service && (
                  <div className="flex items-center gap-2 text-sm">
                    <Scissors className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{cancelInfo.service.name}</span>
                    <span className="text-muted-foreground ml-auto">
                      {parseFloat(cancelInfo.service.price).toFixed(2)} PLN
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{formatDateTime(cancelInfo.startTime)}</span>
                </div>
                {cancelInfo.employee && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    Pracownik: {cancelInfo.employee.name}
                  </div>
                )}
                {cancelInfo.salon && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {cancelInfo.salon.name}
                  </div>
                )}
              </div>

              {/* Cancellation policy */}
              <div
                className={`p-3 rounded-lg border ${
                  cancelInfo.isMoreThan24h
                    ? "bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700"
                    : "bg-orange-50 dark:bg-orange-950/30 border-orange-300 dark:border-orange-700"
                }`}
                data-testid="cancellation-policy"
              >
                <div className="flex items-start gap-2">
                  {cancelInfo.isMoreThan24h ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
                  )}
                  <div className="text-sm">
                    <p className="font-medium" data-testid="cancellation-policy-title">
                      {cancelInfo.isMoreThan24h
                        ? "Anulacja bez kosztow"
                        : "Anulacja z utrata zadatku"}
                    </p>
                    <p className="text-muted-foreground mt-1">
                      Do wizyty pozostalo: {formatTimeRemaining(cancelInfo.hoursUntilAppointment)}
                    </p>
                    <p className="text-muted-foreground mt-1">
                      {cancelInfo.isMoreThan24h
                        ? "Wizyta moze byc anulowana bez kosztow (wiecej niz 24h do wizyty)."
                        : "Uwaga: Anulacja mniej niz 24h przed wizyta oznacza utrate zadatku."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Deposit info */}
              {cancelInfo.deposit.amount > 0 && cancelInfo.deposit.paid && (
                <div
                  className={`p-3 rounded-lg border ${
                    cancelInfo.deposit.action === "refund"
                      ? "bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700"
                      : "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700"
                  }`}
                  data-testid="deposit-info"
                >
                  <div className="flex items-start gap-2">
                    <DollarSign
                      className={`h-4 w-4 mt-0.5 shrink-0 ${
                        cancelInfo.deposit.action === "refund"
                          ? "text-blue-600 dark:text-blue-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    />
                    <div className="text-sm">
                      <p className="font-medium">
                        Zadatek: {cancelInfo.deposit.amount.toFixed(2)} PLN
                      </p>
                      <p
                        className={
                          cancelInfo.deposit.action === "refund"
                            ? "text-blue-700 dark:text-blue-400"
                            : "text-red-700 dark:text-red-400"
                        }
                        data-testid="deposit-action-message"
                      >
                        {cancelInfo.deposit.action === "refund"
                          ? "Zadatek zostanie zwrocony na Twoje konto."
                          : "Zadatek nie podlega zwrotowi (anulacja < 24h)."}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Warning */}
              <p className="text-sm text-muted-foreground text-center">
                Czy na pewno chcesz anulowac te wizyte? Tej operacji nie mozna cofnac.
              </p>
            </div>
          )}

          <DialogFooter className="mt-2">
            <Button
              variant="outline"
              onClick={() => setCancelDialogOpen(false)}
              disabled={cancelling}
              data-testid="cancel-dialog-back-btn"
            >
              Wstecz
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelAppointment}
              disabled={cancelling || cancelLoading || !!cancelError}
              data-testid="confirm-cancel-btn"
            >
              {cancelling ? "Anulowanie..." : "Anuluj wizyte"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
