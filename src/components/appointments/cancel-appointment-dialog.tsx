"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertTriangle,
  Ban,
  Clock,
  DollarSign,
  Bell,
  CheckCircle,
  XCircle,
  RefreshCw,
  User,
  Scissors,
} from "lucide-react";
import { toast } from "sonner";

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
        setError(data.error || "Nie udalo sie pobrac informacji o wizycie");
      }
    } catch {
      setError("Blad polaczenia z serwerem");
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

      const res = await fetch(`/api/appointments/${appointmentId}?${params}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (data.success) {
        const details = data.cancellationDetails;
        let description = "Wizyta zostala pomyslnie anulowana.";

        if (details?.depositRefunded && details?.refund?.processed) {
          description += ` Zwrot zadatku ${details.refund.amount?.toFixed(2) || details.depositAmount.toFixed(2)} PLN zostal zainicjowany automatycznie.`;
        } else if (details?.depositRefunded) {
          description += ` Zadatek ${details.depositAmount.toFixed(2)} PLN do zwrotu.`;
        } else if (details?.depositForfeited) {
          description += ` Zadatek ${details.depositAmount.toFixed(2)} PLN zostaje zatrzymany.`;
        }

        if (details?.clientNotified) {
          description += " Klient zostanie powiadomiony.";
        }

        toast.success("Wizyta anulowana", { description });
        onOpenChange(false);
        onAppointmentCancelled();
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
            Anulowanie wizyty
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
                  <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
                )}
                <div className="text-sm">
                  <p className="font-medium">
                    {cancelInfo.isPast
                      ? "Wizyta juz sie odbyla"
                      : cancelInfo.isMoreThan24h
                        ? "Anulacja bez kosztow"
                        : "Anulacja z utrata zadatku"}
                  </p>
                  <p className="text-muted-foreground mt-1">
                    {cancelInfo.isPast
                      ? "Ta wizyta jest juz w przeszlosci."
                      : `Do wizyty pozostalo: ${formatTimeRemaining(cancelInfo.hoursUntilAppointment)}`}
                  </p>
                  {!cancelInfo.isPast && (
                    <p className="text-muted-foreground mt-1">
                      {cancelInfo.isMoreThan24h
                        ? "Wizyta moze byc anulowana bez kosztow (wiecej niz 24h do wizyty)."
                        : "Uwaga: Anulacja mniej niz 24h przed wizyta oznacza utrate zadatku."}
                    </p>
                  )}
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
                        ? "Zadatek zostanie zwrocony klientowi."
                        : "Zadatek nie podlega zwrotowi (anulacja < 24h)."}
                    </p>
                  </div>
                </div>
              </div>
            )}

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
                    Powiadom klienta o anulowaniu
                  </label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {cancelInfo.client.name}
                    {cancelInfo.client.phone ? ` - ${cancelInfo.client.phone}` : ""}
                  </p>
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
            onClick={() => onOpenChange(false)}
            disabled={cancelling}
            data-testid="cancel-dialog-back-btn"
          >
            Wstecz
          </Button>
          <Button
            variant="destructive"
            onClick={handleCancel}
            disabled={cancelling || loading || !!error}
            data-testid="confirm-cancel-btn"
          >
            {cancelling ? "Anulowanie..." : "Anuluj wizyte"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
