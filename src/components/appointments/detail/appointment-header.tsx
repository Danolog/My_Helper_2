"use client";

import {
  ArrowLeft,
  Pencil,
  CheckCircle,
  FileText,
  Printer,
  Receipt,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppointmentDetail, InvoiceData, FiscalReceiptData } from "./types";

interface AppointmentHeaderProps {
  appointment: AppointmentDetail;
  invoice: InvoiceData | null;
  fiscalReceipt: FiscalReceiptData | null;
  onBack: () => void;
  onEdit: () => void;
  onComplete: () => void;
  onInvoiceAction: () => void;
  onReceiptAction: () => void;
}

export function AppointmentHeader({
  appointment,
  invoice,
  fiscalReceipt,
  onBack,
  onEdit,
  onComplete,
  onInvoiceAction,
  onReceiptAction,
}: AppointmentHeaderProps) {
  const startDate = new Date(appointment.startTime);
  const isActive = appointment.status !== "completed" && appointment.status !== "cancelled";
  const isCompleted = appointment.status === "completed";

  return (
    <div className="flex items-center gap-4 mb-6">
      <Button
        variant="outline"
        size="icon"
        onClick={onBack}
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
      {isActive && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={onEdit}
            data-testid="edit-appointment-btn"
          >
            <Pencil className="h-4 w-4 mr-2" />
            Edytuj
          </Button>
          <Button
            onClick={onComplete}
            data-testid="complete-appointment-btn"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Zakoncz wizyte
          </Button>
        </div>
      )}
      {isCompleted && (
        <div className="flex items-center gap-2">
          {invoice ? (
            <Button
              variant="outline"
              onClick={onInvoiceAction}
              data-testid="view-invoice-btn"
            >
              <FileText className="h-4 w-4 mr-2" />
              Podglad faktury
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={onInvoiceAction}
              data-testid="generate-invoice-btn"
            >
              <FileText className="h-4 w-4 mr-2" />
              Generuj fakture
            </Button>
          )}
          {fiscalReceipt ? (
            <Button
              variant="outline"
              onClick={onReceiptAction}
              data-testid="view-receipt-btn"
            >
              <Receipt className="h-4 w-4 mr-2" />
              Podglad paragonu
            </Button>
          ) : (
            <Button
              onClick={onReceiptAction}
              data-testid="print-receipt-btn"
            >
              <Printer className="h-4 w-4 mr-2" />
              Drukuj paragon
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
