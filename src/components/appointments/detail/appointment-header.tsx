"use client";

import {
  ArrowLeft,
  Pencil,
  CheckCircle,
  FileText,
} from "lucide-react";
import { useModuleEnabled } from "@/components/dashboard/modules-provider";
import { Button } from "@/components/ui/button";
import type { AppointmentDetail, InvoiceData } from "./types";

interface AppointmentHeaderProps {
  appointment: AppointmentDetail;
  invoice: InvoiceData | null;
  onBack: () => void;
  onEdit: () => void;
  onComplete: () => void;
  onInvoiceAction: () => void;
}

export function AppointmentHeader({
  appointment,
  invoice,
  onBack,
  onEdit,
  onComplete,
  onInvoiceAction,
}: AppointmentHeaderProps) {
  const startDate = new Date(appointment.startTime);
  const isActive = appointment.status !== "completed" && appointment.status !== "cancelled";
  const isCompleted = appointment.status === "completed";
  // Faktury to moduł z rejestru (src/lib/features.ts) — wyłączony albo
  // zamrożony chowa przyciski faktury.
  const invoicesEnabled = useModuleEnabled("invoices");

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
          {invoicesEnabled &&
            (invoice ? (
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
            ))}
        </div>
      )}
    </div>
  );
}
