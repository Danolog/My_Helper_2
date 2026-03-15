"use client";

import {
  Ban,
  Scissors,
  Clock,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatDateTime, formatTimeRemaining } from "../_types";
import type { CancelInfo } from "../_types";

interface CancelAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cancelInfo: CancelInfo | null;
  cancelLoading: boolean;
  cancelling: boolean;
  cancelError: string | null;
  onConfirmCancel: () => void;
}

export function CancelAppointmentDialog({
  open,
  onOpenChange,
  cancelInfo,
  cancelLoading,
  cancelling,
  cancelError,
  onConfirmCancel,
}: CancelAppointmentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <CancelInfoDetails cancelInfo={cancelInfo} />
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
            onClick={onConfirmCancel}
            disabled={cancelling || cancelLoading || !!cancelError}
            data-testid="confirm-cancel-btn"
          >
            {cancelling ? "Anulowanie..." : "Anuluj wizyte"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Cancellation details (private sub-component)
// ---------------------------------------------------------------------------

function CancelInfoDetails({ cancelInfo }: { cancelInfo: CancelInfo }) {
  return (
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
              Do wizyty pozostalo:{" "}
              {formatTimeRemaining(cancelInfo.hoursUntilAppointment)}
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
  );
}
