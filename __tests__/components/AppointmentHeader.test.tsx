import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AppointmentHeader } from "@/components/appointments/detail/appointment-header";
import type {
  AppointmentDetail,
  InvoiceData,
} from "@/components/appointments/detail/types";
import { ModulesProvider } from "@/components/dashboard/modules-provider";
import { DEFAULT_MODULES, type ModulesState } from "@/lib/features";

const appointment = {
  id: "appt-1",
  status: "completed",
  startTime: "2026-11-10T10:00:00.000Z",
  service: { id: "svc-1", name: "Strzyzenie", basePrice: "100.00", baseDuration: 30 },
} as AppointmentDetail;

const invoice = { id: "inv-1", invoiceNumber: "FV/1/2026" } as unknown as InvoiceData;

function renderHeader(opts: {
  modules?: ModulesState;
  invoice?: InvoiceData | null;
  status?: string;
}) {
  return render(
    <ModulesProvider modules={opts.modules ?? DEFAULT_MODULES}>
      <AppointmentHeader
        appointment={{ ...appointment, status: opts.status ?? "completed" }}
        invoice={opts.invoice ?? null}
        fiscalReceipt={null}
        onBack={vi.fn()}
        onEdit={vi.fn()}
        onComplete={vi.fn()}
        onInvoiceAction={vi.fn()}
        onReceiptAction={vi.fn()}
      />
    </ModulesProvider>
  );
}

describe("AppointmentHeader — faktury zamrożone", () => {
  it("zakończona wizyta bez faktury: nie ma przycisku „Generuj fakturę”", () => {
    renderHeader({});

    expect(screen.queryByTestId("generate-invoice-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("view-invoice-btn")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/faktur/i);
  });

  it("zakończona wizyta z fakturą sprzed zamrożenia: nie ma przycisku podglądu", () => {
    renderHeader({ invoice });

    expect(screen.queryByTestId("view-invoice-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("generate-invoice-btn")).not.toBeInTheDocument();
  });

  it("pozostałe akcje wizyty działają bez zmian", () => {
    renderHeader({ status: "scheduled" });

    expect(screen.getByTestId("edit-appointment-btn")).toBeInTheDocument();
    expect(screen.getByTestId("complete-appointment-btn")).toBeInTheDocument();
    expect(screen.getByTestId("back-btn")).toBeInTheDocument();
  });

  it("kontrola: przy module faktur włączonym przyciski wracają", () => {
    const thawed = { ...DEFAULT_MODULES, invoices: true };

    const first = renderHeader({ modules: thawed });
    expect(screen.getByTestId("generate-invoice-btn")).toBeInTheDocument();
    first.unmount();

    renderHeader({ modules: thawed, invoice });
    expect(screen.getByTestId("view-invoice-btn")).toBeInTheDocument();
  });
});
