/**
 * Raport przychodu na ekranie i w PDF: karty podsumowania, karta metod płatności
 * i tabele PDF (bez polskich liter, stopki RAZEM z jedną regułą udziału).
 */
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SummaryCards } from "@/app/dashboard/reports/revenue/_components/summary-cards";
import { useRevenueData } from "@/app/dashboard/reports/revenue/_hooks/use-revenue-data";
import type { PaymentMethodBreakdown, ReportData } from "@/app/dashboard/reports/revenue/_types";
import type { PDFReportOptions } from "@/lib/pdf-export";
import { REVENUE_NO_RECORD_NOTE, REVENUE_SOURCE_NOTE } from "@/lib/reports/revenue-amount";

const pdf = vi.hoisted(() => ({ generateReportPDF: vi.fn() }));

vi.mock("@/lib/pdf-export", () => ({ generateReportPDF: pdf.generateReportPDF }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: null }) }));
vi.mock("@/hooks/use-salon-id", () => ({ useSalonId: () => ({ salonId: "salon-a", loading: false }) }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("dateFrom=2026-10-01&dateTo=2026-10-31"),
  usePathname: () => "/dashboard/reports/revenue",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SOURCE_NOTE_LITERAL =
  "Przychód to kwoty wpisane przy zakończeniu wizyty. Nie pochodzi z kasy fiskalnej ani z terminala płatniczego.";
const NO_RECORD_NOTE_LITERAL =
  "Bez zapisu płatności: wizyty zakończone, zanim aplikacja zaczęła pytać o kwotę i metodę. Ich kwota to cena usługi minus rabat.";

function methods(noneCount: number): PaymentMethodBreakdown[] {
  return [
    { method: "cash", label: "Gotówka", count: 2, revenue: "80.00", share: "40.0" },
    { method: "card", label: "Karta", count: 1, revenue: "60.00", share: "30.0" },
    { method: "blik", label: "BLIK", count: 1, revenue: noneCount > 0 ? "20.00" : "60.00", share: noneCount > 0 ? "10.0" : "30.0" },
    { method: "none", label: "Bez zapisu płatności", count: noneCount, revenue: noneCount > 0 ? "40.00" : "0.00", share: noneCount > 0 ? "20.0" : "0.0" },
  ];
}

function reportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    summary: {
      totalRevenue: "200.00",
      totalAppointments: 5,
      avgRevenuePerAppointment: "40.00",
      totalDiscount: "10.00",
    },
    byService: [{ serviceId: "svc-1", serviceName: "Strzyzenie", count: 5, revenue: "200.00", avgPrice: "40.00", share: "100.0" }],
    byEmployee: [{ employeeId: "emp-1", employeeName: "Anna Nowak", count: 5, revenue: "200.00", avgPrice: "40.00", share: "100.0" }],
    byPaymentMethod: methods(1),
    trend: [{ date: "2026-10-15", revenue: "200.00", count: 5 }],
    filters: { salonId: "salon-a", dateFrom: "2026-10-01", dateTo: "2026-10-31", employeeIds: null },
    ...overrides,
  };
}

/** Wiersze tabeli metod (bez nagłówka) jako teksty komórek. */
function methodRows(): string[][] {
  // jedyna tabela w komponencie to tabela metod
  return within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((tr) => within(tr).getAllByRole("cell").map((td) => td.textContent ?? ""));
}

describe("SummaryCards — karty i karta metod płatności", () => {
  it("karty podsumowania z polskimi znakami", () => {
    render(<SummaryCards reportData={reportData()} />);
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual([
      "Całkowity przychód",
      "Liczba wizyt",
      "Średni przychód / wizytę",
      "Zniżki",
      "Przychód według metody płatności",
    ]);
  });

  it("karta metod: tytuł i kolumny", () => {
    render(<SummaryCards reportData={reportData()} />);
    expect(screen.getByText("Przychód według metody płatności")).toBeInTheDocument();
    const headers = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Metoda płatności", "Liczba wizyt", "Przychód", "Udział"]);
  });

  it("grupa „Bez zapisu płatności” z wizytami: 4 wiersze i oba zdania dosłownie", () => {
    render(<SummaryCards reportData={reportData({ byPaymentMethod: methods(1) })} />);
    expect(methodRows()).toEqual([
      ["Gotówka", "2", "80.00 PLN", "40.0%"],
      ["Karta", "1", "60.00 PLN", "30.0%"],
      ["BLIK", "1", "20.00 PLN", "10.0%"],
      ["Bez zapisu płatności", "1", "40.00 PLN", "20.0%"],
    ]);
    expect(screen.getByText(REVENUE_SOURCE_NOTE)).toBeInTheDocument();
    expect(screen.getByText(SOURCE_NOTE_LITERAL)).toBeInTheDocument();
    expect(screen.getByText(REVENUE_NO_RECORD_NOTE)).toBeInTheDocument();
    expect(screen.getByText(NO_RECORD_NOTE_LITERAL)).toBeInTheDocument();
  });

  it("grupa „Bez zapisu płatności” bez wizyt: 3 wiersze, zdanie źródła tak, drugie zdanie nie", () => {
    render(<SummaryCards reportData={reportData({ byPaymentMethod: methods(0) })} />);
    expect(methodRows().map((r) => r[0])).toEqual(["Gotówka", "Karta", "BLIK"]);
    expect(screen.queryByText("Bez zapisu płatności")).not.toBeInTheDocument();
    expect(screen.getByText(SOURCE_NOTE_LITERAL)).toBeInTheDocument();
    expect(screen.queryByText(NO_RECORD_NOTE_LITERAL)).not.toBeInTheDocument();
  });

  it("brak wizyt w okresie: trzy wiersze z zerami, tylko zdanie źródła", () => {
    const zero: PaymentMethodBreakdown[] = methods(0).map((r) => ({ ...r, count: 0, revenue: "0.00", share: "0.0" }));
    render(<SummaryCards reportData={reportData({ byPaymentMethod: zero })} />);
    expect(methodRows()).toEqual([
      ["Gotówka", "0", "0.00 PLN", "0.0%"],
      ["Karta", "0", "0.00 PLN", "0.0%"],
      ["BLIK", "0", "0.00 PLN", "0.0%"],
    ]);
    expect(screen.getByText(SOURCE_NOTE_LITERAL)).toBeInTheDocument();
    expect(screen.queryByText(NO_RECORD_NOTE_LITERAL)).not.toBeInTheDocument();
  });
});

describe("useRevenueData — PDF z tabelą metod płatności", () => {
  beforeEach(() => {
    pdf.generateReportPDF.mockReset();
  });

  async function exportPdf(data: ReportData): Promise<PDFReportOptions> {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data }) })
    );
    const { result } = renderHook(() => useRevenueData());
    await waitFor(() => expect(result.current.reportData).not.toBeNull());
    act(() => result.current.handleExportPDF());
    vi.unstubAllGlobals();
    expect(pdf.generateReportPDF).toHaveBeenCalledTimes(1);
    return pdf.generateReportPDF.mock.calls[0]![0] as PDFReportOptions;
  }

  function table(options: PDFReportOptions, title: string) {
    const found = options.tables?.find((t) => t.title === title);
    expect(found, `tabela ${title}`).toBeDefined();
    return found!;
  }

  it("tabela metod bez polskich liter, 4 wiersze przy grupie bez zapisu, stopki RAZEM 100.0%", async () => {
    const options = await exportPdf(reportData({ byPaymentMethod: methods(1) }));

    expect(options.tables?.[0]?.title).toBe("Przychod wg metody platnosci");
    const methodsTable = table(options, "Przychod wg metody platnosci");
    expect(methodsTable.headers).toEqual(["Metoda platnosci", "Liczba wizyt", "Przychod", "Udzial"]);
    expect(methodsTable.rows).toEqual([
      ["Gotowka", "2", "80.00 PLN", "40.0%"],
      ["Karta", "1", "60.00 PLN", "30.0%"],
      ["BLIK", "1", "20.00 PLN", "10.0%"],
      ["Bez zapisu platnosci", "1", "40.00 PLN", "20.0%"],
    ]);
    expect(methodsTable.footerRow).toEqual(["RAZEM", "5", "200.00 PLN", "100.0%"]);
    expect(table(options, "Przychod wg uslugi").footerRow).toEqual(["RAZEM", "5", "200.00 PLN", "40.00 PLN", "100.0%"]);
    expect(table(options, "Przychod wg pracownika").footerRow).toEqual(["RAZEM", "5", "200.00 PLN", "40.00 PLN", "100.0%"]);

    // Helvetica w PDF nie ma polskich liter: żadna komórka tabeli metod ich nie zawiera
    const cells = [methodsTable.title, ...methodsTable.headers, ...methodsTable.rows.flat(), ...(methodsTable.footerRow ?? [])];
    expect(cells.filter((c) => /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(c))).toEqual([]);
  });

  it("grupa bez zapisu z 0 wizyt: w PDF 3 wiersze metod", async () => {
    const options = await exportPdf(reportData({ byPaymentMethod: methods(0) }));
    expect(table(options, "Przychod wg metody platnosci").rows.map((r) => r[0])).toEqual(["Gotowka", "Karta", "BLIK"]);
  });

  it("okres bez przychodu (wizyty za 0 zł): stopki RAZEM z udziałem 0.0%", async () => {
    const zero: PaymentMethodBreakdown[] = methods(0).map((r) =>
      r.method === "cash" ? { ...r, count: 2, revenue: "0.00", share: "0.0" } : { ...r, count: 0, revenue: "0.00", share: "0.0" }
    );
    const options = await exportPdf(
      reportData({
        summary: { totalRevenue: "0.00", totalAppointments: 2, avgRevenuePerAppointment: "0.00", totalDiscount: "0.00" },
        byService: [{ serviceId: "svc-1", serviceName: "Strzyzenie", count: 2, revenue: "0.00", avgPrice: "0.00", share: "0.0" }],
        byEmployee: [{ employeeId: "emp-1", employeeName: "Anna Nowak", count: 2, revenue: "0.00", avgPrice: "0.00", share: "0.0" }],
        byPaymentMethod: zero,
      })
    );

    // wiersze metod z zerem zostają, a grupa „bez zapisu” z 0 wizyt jest pominięta
    expect(table(options, "Przychod wg metody platnosci").rows).toEqual([
      ["Gotowka", "2", "0.00 PLN", "0.0%"],
      ["Karta", "0", "0.00 PLN", "0.0%"],
      ["BLIK", "0", "0.00 PLN", "0.0%"],
    ]);
    expect(table(options, "Przychod wg metody platnosci").footerRow).toEqual(["RAZEM", "2", "0.00 PLN", "0.0%"]);
    expect(table(options, "Przychod wg uslugi").footerRow).toEqual(["RAZEM", "2", "0.00 PLN", "0.00 PLN", "0.0%"]);
    expect(table(options, "Przychod wg pracownika").footerRow).toEqual(["RAZEM", "2", "0.00 PLN", "0.00 PLN", "0.0%"]);
  });
});
