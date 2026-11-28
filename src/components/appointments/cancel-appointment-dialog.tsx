"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Ban,
  Clock,
  DollarSign,
  Bell,
  XCircle,
  RefreshCw,
  User,
  Scissors,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { mutationFetch } from "@/lib/api-client";
import { APPOINTMENT_ERROR_CODES } from "@/lib/appointment-codes";
import type { CancellationDepositVariant } from "@/lib/salon-cancellation";
import {
  ALREADY_CANCELLED_TOAST_DESCRIPTION,
  ALREADY_CANCELLED_TOAST_TITLE,
  APPOINTMENT_GONE_TOAST_DESCRIPTION,
  APPOINTMENT_GONE_TOAST_TITLE,
  CANCEL_FAILED_SERVER_DESCRIPTION,
  CANCEL_FAILED_TOAST_TITLE,
  CANCEL_DIALOG_BACK,
  CANCEL_DIALOG_CONFIRM,
  CANCEL_DIALOG_TITLE,
  cancelDialogBody,
  salonCancelToast,
} from "./cancel-appointment-texts";

interface CancellationInfo {
  appointmentId: string;
  status: string;
  startTime: string;
  endTime: string;
  hoursUntilAppointment: number;
  isMoreThan24h: boolean;
  isPast: boolean;
  deposit: {
    amount: number;
    paid: boolean;
    action: "refund" | "forfeit" | "none";
    variant: CancellationDepositVariant;
  };
  client: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
  } | null;
  employee: {
    id: string;
    name: string;
  } | null;
  service: {
    id: string;
    name: string;
    price: string;
  } | null;
}

interface CancelAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentId: string | null;
  onAppointmentCancelled: () => void;
}

export function CancelAppointmentDialog({
  open,
  onOpenChange,
  appointmentId,
  onAppointmentCancelled,
}: CancelAppointmentDialogProps) {
  const [cancelInfo, setCancelInfo] = useState<CancellationInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [notifyClient, setNotifyClient] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch cancellation info when dialog opens
  const fetchCancelInfo = useCallback(async () => {
    if (!appointmentId) return;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${appointmentId}/cancel-info`);
      const data = await res.json();
      if (data.success) {
        setCancelInfo(data.data);
      } else {
        setError(data.error || "Nie udało się pobrać informacji o wizycie");
      }
    } catch {
      setError("Błąd połączenia z serwerem");
    } finally {
      setLoading(false);
    }
  }, [appointmentId]);

  useEffect(() => {
    if (open && appointmentId) {
      fetchCancelInfo();
    } else {
      setCancelInfo(null);
      setError(null);
      setNotifyClient(true);
    }
  }, [open, appointmentId, fetchCancelInfo]);

  // Handle cancellation
  const handleCancel = async () => {
    if (!appointmentId) return;

    setCancelling(true);
    try {
      const params = new URLSearchParams();
      if (notifyClient && cancelInfo?.client) {
        params.set("notifyClient", "true");
      }

      const res = await mutationFetch(`/api/appointments/${appointmentId}?${params}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (data.success) {
        // RF3: toast zależny od wyniku zwrotu; nieudany zwrot bez auto-zamknięcia.
        const notice = salonCancelToast(data.cancellationDetails);
        if (notice.kind === "error") {
          toast.error(notice.title, { description: notice.description, duration: notice.duration });
        } else {
          toast.success(notice.title, notice.description ? { description: notice.description } : undefined);
        }
        onOpenChange(false);
        onAppointmentCancelled();
      } else if (data.code === APPOINTMENT_ERROR_CODES.appointmentNotFound) {
        // Wizyty nie ma w salonie (albo pracownik już jej nie prowadzi): zamknięcie
        // i odświeżenie jak po sukcesie, własny tekst zamiast `data.error`.
        toast.info(APPOINTMENT_GONE_TOAST_TITLE, { description: APPOINTMENT_GONE_TOAST_DESCRIPTION });
        onOpenChange(false);
        onAppointmentCancelled();
      } else if (data.code === APPOINTMENT_ERROR_CODES.appointmentCancelled) {
        // Wizyta już odwołana: informacja, nie błąd ani sukces; zamknięcie i odświeżenie.
        toast.info(ALREADY_CANCELLED_TOAST_TITLE, { description: ALREADY_CANCELLED_TOAST_DESCRIPTION });
        onOpenChange(false);
        onAppointmentCancelled();
      } else {
        toast.error(CANCEL_FAILED_TOAST_TITLE, {
          description: res.status === 500 ? CANCEL_FAILED_SERVER_DESCRIPTION : data.error,
        });
      }
    } catch {
      toast.error("Błąd podczas odwoływania wizyty");
    } finally {
      setCancelling(false);
    }
  };

  // Format time remaining
  const formatTimeRemaining = (hours: number) => {
    if (hours < 1) {
      const minutes = Math.round(hours * 60);
      return `${minutes} min`;
    }
    if (hours < 48) {
      return `${Math.round(hours)}h`;
    }
    const days = Math.round(hours / 24);
    return `${days} dni`;
  };

  // Format date for display
  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("pl-PL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="cancel-appointment-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Ban className="h-5 w-5" />
            {CANCEL_DIALOG_TITLE}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex justify-center items-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            <XCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {cancelInfo && !loading && (
          <div className="space-y-4">
            {/* Appointment details */}
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
              {cancelInfo.client && (
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{cancelInfo.client.name}</span>
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
            </div>

            {/* Czas do wizyty (informacyjnie — salon zwraca zadatek zawsze, RF1) */}
            <div className="p-3 rounded-lg border bg-muted/30 text-sm" data-testid="cancellation-policy">
              <p className="text-muted-foreground">
                {cancelInfo.isPast
                  ? "Ta wizyta jest już w przeszłości."
                  : `Do wizyty zostało: ${formatTimeRemaining(cancelInfo.hoursUntilAppointment)}`}
              </p>
            </div>

            {/* Zadatek i skutek odwołania (RF3) */}
            <div className="p-3 rounded-lg border" data-testid="deposit-info">
              <div className="flex items-start gap-2">
                <DollarSign className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <p className="text-sm" data-testid="deposit-action-message">
                  {cancelDialogBody(cancelInfo.deposit.variant, cancelInfo.deposit.amount)}
                </p>
              </div>
            </div>

            {/* Notify client option */}
            {cancelInfo.client && (
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30" data-testid="notify-client-section">
                <Checkbox
                  id="cancel-notify-client"
                  checked={notifyClient}
                  onCheckedChange={(checked) => setNotifyClient(checked === true)}
                  data-testid="cancel-notify-checkbox"
                />
                <div className="flex-1">
                  <label
                    htmlFor="cancel-notify-client"
                    className="text-sm font-medium flex items-center gap-1.5 cursor-pointer"
                  >
                    <Bell className="h-3.5 w-3.5 text-primary" />
                    Powiadom klienta o odwołaniu
                  </label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {cancelInfo.client.name}
                    {cancelInfo.client.phone ? ` - ${cancelInfo.client.phone}` : ""}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="mt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={cancelling}
            data-testid="cancel-dialog-back-btn"
          >
            {CANCEL_DIALOG_BACK}
          </Button>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={cancelling || loading || !!error}
            data-testid="confirm-cancel-btn"
          >
            {cancelling ? "Odwoływanie..." : CANCEL_DIALOG_CONFIRM}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
