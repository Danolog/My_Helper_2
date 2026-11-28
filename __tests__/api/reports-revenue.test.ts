/**
 * Raport przychodu: kwota zapisana przy zakończeniu wizyty i podział na metody płatności.
 *
 * Przez prawdziwą bramkę (salon-context + forSalon) — mockowane tylko krawędzie
 * (sesja, db, granty) z salon-staff-harness.ts oraz zapis skoroszytu XLSX.
 * Wiersze zapytania trasy podaje `txRows` (wynik `forSalon(...).raw`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/reports/revenue/route";
import { REVENUE_NO_RECORD_NOTE, REVENUE_SOURCE_NOTE } from "@/lib/reports/revenue-amount";
import { SALON_A } from "./salon-staff-harness";

const m = await vi.hoisted(async () =>
  (await import("./salon-staff-harness")).createSalonStaffMocks()
);
const excel = vi.hoisted(() => ({ createExcelWorkbook: vi.fn() }));

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/server/system/db-system", () => ({ dbSystem: m.dbSystem }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: m.hasTemporaryAccess }));
vi.mock("@/lib/excel-export", () => ({
  createExcelWorkbook: excel.createExcelWorkbook,
  excelResponseHeaders: (filename: string) => ({
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${filename}"`,
  }),
}));

interface MethodRow {
  method: string;
  label: string;
  count: number;
  revenue: string;
  share: string;
}

interface RevenueBody {
  success: boolean;
  data: {
    summary: {
      totalRevenue: string;
      totalAppointments: number;
      avgRevenuePerAppointment: string;
      totalDiscount: string;
    };
    byService: { serviceId: string; revenue: string; count: number }[];
    byEmployee: { employeeId: string; revenue: string; count: number }[];
    byPaymentMethod: MethodRow[];
    trend: { date: string; revenue: string; count: number }[];
  };
}

let seq = 0;

/** Wiersz zapytania trasy (kształt `select` z route.ts). */
function appt(overrides: {
  paidAmount?: string | null;
  paymentMethod?: string | null;
  basePrice?: string | null;
  discountAmount?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  employeeId?: string;
  day?: string;
}) {
  seq += 1;
  const start = new Date(`${overrides.day ?? "2026-10-15"}T10:00:00.000Z`);
  return {
    appointmentId: `appt-${seq}`,
    startTime: start,
    endTime: new Date(start.getTime() + 3_600_000),
    serviceId: overrides.serviceId === undefined ? "svc-1" : overrides.serviceId,
    serviceName: overrides.serviceName === undefined ? "Strzyżenie" : overrides.serviceName,
    basePrice: overrides.basePrice === undefined ? "120.00" : overrides.basePrice,
    employeeId: overrides.employeeId ?? "emp-1",
    employeeFirstName: "Anna",
    employeeLastName: "Nowak",
    clientId: "client-1",
    clientFirstName: "Ewa",
    clientLastName: "Kowalska",
    discountAmount: overrides.discountAmount ?? null,
    depositAmount: null,
    depositPaid: false,
    paidAmount: overrides.paidAmount ?? null,
    paymentMethod: overrides.paymentMethod ?? null,
  };
}

function call(format?: string) {
  const fmt = format ? `&format=${format}` : "";
  return GET(
    new Request(
      `http://localhost/api/reports/revenue?salonId=${SALON_A}&dateFrom=2026-10-01&dateTo=2026-10-31${fmt}`
    )
  );
}

async function report(rows: unknown[]): Promise<RevenueBody["data"]> {
  m.asOwnerOf(SALON_A);
  m.txRows.push(rows);
  const res = await call();
  expect(res.status).toBe(200);
  const body = (await res.json()) as RevenueBody;
  expect(body.success).toBe(true);
  return body.data;
}

/** Suma kwot grup w groszach (sprawdza niezmiennik bez arytmetyki zmiennoprzecinkowej). */
function sumCents(rows: { revenue: string }[]): number {
  return rows.reduce((acc, r) => acc + Math.round(Number(r.revenue) * 100), 0);
}

describe("GET /api/reports/revenue — kwota zapisana i metody płatności", () => {
  beforeEach(() => {
    m.reset();
    excel.createExcelWorkbook.mockReset();
    excel.createExcelWorkbook.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  it("metody mieszane: cztery grupy w stałej kolejności, suma grup = suma całkowita", async () => {
    const data = await report([
      appt({ paidAmount: "50.00", paymentMethod: "cash" }),
      appt({ paidAmount: "30.00", paymentMethod: "cash" }),
      appt({ paidAmount: "80.00", paymentMethod: "card" }),
      appt({ paidAmount: "20.00", paymentMethod: "blik" }),
      appt({ basePrice: "100.00", discountAmount: "10.00" }),
    ]);

    expect(data.byPaymentMethod).toEqual([
      { method: "cash", label: "Gotówka", count: 2, revenue: "80.00", share: "29.6" },
      { method: "card", label: "Karta", count: 1, revenue: "80.00", share: "29.6" },
      { method: "blik", label: "BLIK", count: 1, revenue: "20.00", share: "7.4" },
      { method: "none", label: "Bez zapisu płatności", count: 1, revenue: "90.00", share: "33.3" },
    ]);
    expect(data.summary.totalRevenue).toBe("270.00");
    expect(data.summary.totalAppointments).toBe(5);
    expect(data.summary.avgRevenuePerAppointment).toBe("54.00");
    expect(data.summary.totalDiscount).toBe("10.00");
    expect(sumCents(data.byPaymentMethod)).toBe(27000);
    expect(data.byPaymentMethod.reduce((n, r) => n + r.count, 0)).toBe(data.summary.totalAppointments);
  });

  it("brak wizyt: cztery pozycje z zerami", async () => {
    const data = await report([]);

    expect(data.byPaymentMethod).toEqual([
      { method: "cash", label: "Gotówka", count: 0, revenue: "0.00", share: "0.0" },
      { method: "card", label: "Karta", count: 0, revenue: "0.00", share: "0.0" },
      { method: "blik", label: "BLIK", count: 0, revenue: "0.00", share: "0.0" },
      { method: "none", label: "Bez zapisu płatności", count: 0, revenue: "0.00", share: "0.0" },
    ]);
    expect(data.summary).toEqual({
      totalRevenue: "0.00",
      totalAppointments: 0,
      avgRevenuePerAppointment: "0.00",
      totalDiscount: "0.00",
    });
  });

  it("tylko wizyty bez zapisu: suma jak dawny wzór max(0, cena − rabat), wszystko w grupie none", async () => {
    const data = await report([
      appt({ basePrice: "120.00", discountAmount: "20.00" }),
      appt({ basePrice: "80.00", discountAmount: "150.00" }),
      appt({ basePrice: null }),
      appt({ basePrice: "59.99" }),
    ]);

    // 100.00 + 0 + 0 + 59.99
    expect(data.summary.totalRevenue).toBe("159.99");
    expect(data.summary.totalDiscount).toBe("170.00");
    expect(data.byPaymentMethod.map((r) => [r.method, r.count, r.revenue])).toEqual([
      ["cash", 0, "0.00"],
      ["card", 0, "0.00"],
      ["blik", 0, "0.00"],
      ["none", 4, "159.99"],
    ]);
    expect(data.byPaymentMethod[3]!.share).toBe("100.0");
  });

  it("podział na usługę, pracownika i trend liczy kwotę wpisaną, nie cenę usługi", async () => {
    const data = await report([appt({ paidAmount: "80.00", paymentMethod: "card", basePrice: "120.00" })]);

    expect(data.summary.totalRevenue).toBe("80.00");
    expect(data.byService).toEqual([
      expect.objectContaining({ serviceId: "svc-1", count: 1, revenue: "80.00", avgPrice: "80.00", share: "100.0" }),
    ]);
    expect(data.byEmployee).toEqual([
      expect.objectContaining({ employeeId: "emp-1", count: 1, revenue: "80.00", avgPrice: "80.00", share: "100.0" }),
    ]);
    expect(data.trend).toEqual([{ date: "2026-10-15", revenue: "80.00", count: 1 }]);
  });

  it("0 zł zapisane gotówką liczy się jako 0 w grupie Gotówka", async () => {
    const data = await report([appt({ paidAmount: "0.00", paymentMethod: "cash", basePrice: "120.00" })]);

    expect(data.summary.totalRevenue).toBe("0.00");
    expect(data.byPaymentMethod[0]).toEqual({ method: "cash", label: "Gotówka", count: 1, revenue: "0.00", share: "0.0" });
    expect(data.byPaymentMethod[3]!.count).toBe(0);
  });

  it("grosze: 99.99 + 0.01 = 100.00, suma grup = suma całkowita", async () => {
    const data = await report([
      appt({ paidAmount: "99.99", paymentMethod: "blik" }),
      appt({ paidAmount: "0.01", paymentMethod: "blik" }),
    ]);

    expect(data.byPaymentMethod[2]).toMatchObject({ count: 2, revenue: "100.00", share: "100.0" });
    expect(data.summary.totalRevenue).toBe("100.00");
    expect(sumCents(data.byPaymentMethod)).toBe(10000);
  });

  it("grosze: udział liczony z groszy, bez błędu liczb zmiennoprzecinkowych", async () => {
    // 0.15 z 0.16 to równo 93.75 %, więc "93.8". Na liczbach zmiennoprzecinkowych
    // 0.01 + 0.14 daje 0.15000000000000002 i udział spada poniżej granicy: "93.7".
    const data = await report([
      appt({ paidAmount: "0.01", paymentMethod: "cash" }),
      appt({ paidAmount: "0.14", paymentMethod: "cash" }),
      appt({ paidAmount: "0.01", paymentMethod: "card" }),
    ]);

    expect(data.summary.totalRevenue).toBe("0.16");
    expect(data.byPaymentMethod[0]).toMatchObject({ revenue: "0.15", share: "93.8" });
    expect(data.byPaymentMethod[1]).toMatchObject({ revenue: "0.01", share: "6.3" });
  });

  it("średnia zaokrąglana do pełnego grosza w górę od połowy: 0.03 / 2 = 0.02", async () => {
    // 3 gr na 2 wizyty to 1.5 gr; zaokrąglenie daje 2 gr, obcięcie dałoby 1 gr
    const data = await report([
      appt({ paidAmount: "0.01", paymentMethod: "cash" }),
      appt({ paidAmount: "0.02", paymentMethod: "card" }),
    ]);

    expect(data.summary.totalRevenue).toBe("0.03");
    expect(data.summary.avgRevenuePerAppointment).toBe("0.02");
    expect(data.byService).toEqual([
      expect.objectContaining({ serviceId: "svc-1", count: 2, revenue: "0.03", avgPrice: "0.02" }),
    ]);
    expect(data.byEmployee).toEqual([
      expect.objectContaining({ employeeId: "emp-1", count: 2, revenue: "0.03", avgPrice: "0.02" }),
    ]);
  });

  it("CSV: sekcja metod płatności, cztery etykiety i wiersz źródła w cudzysłowie", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([
      appt({ paidAmount: "50.00", paymentMethod: "cash" }),
      // usunięta usługa: LEFT JOIN daje null w polach usługi, także w cenie
      appt({ basePrice: null, discountAmount: "10.00", serviceId: null, serviceName: null, paidAmount: "90.00", paymentMethod: "card" }),
    ]);

    const res = await call("csv");
    expect(res.status).toBe(200);
    // Response.text() zjada BOM; TextDecoder z ignoreBOM: true zostawia go w tekście
    const bytes = new Uint8Array(await res.arrayBuffer());
    const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    const lines = csv.replace(/^﻿/, "").split("\n");

    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines).toContain("RAPORT PRZYCHODÓW");
    expect(lines).toContain("Całkowity przychód,140.00 PLN");
    expect(lines).toContain("Łączna kwota zniżek,10.00 PLN");
    expect(lines).toContain(`Źródło kwot,"${REVENUE_SOURCE_NOTE}"`);
    expect(lines).toContain(
      'Źródło kwot,"Przychód to kwoty wpisane przy zakończeniu wizyty. Nie pochodzi z kasy fiskalnej ani z terminala płatniczego."'
    );
    // wiersz źródła tuż po wierszu zniżek
    expect(lines.indexOf(`Źródło kwot,"${REVENUE_SOURCE_NOTE}"`)).toBe(lines.indexOf("Łączna kwota zniżek,10.00 PLN") + 1);
    expect(lines).toContain("PRZYCHÓD WG USŁUGI");
    expect(lines).toContain('"Usługa usunięta",1,90.00,90.00,64.3');

    const section = lines.indexOf("PRZYCHÓD WG METODY PŁATNOŚCI");
    expect(section).toBeGreaterThan(lines.indexOf("PRZYCHÓD WG PRACOWNIKA"));
    expect(lines.slice(section, section + 7)).toEqual([
      "PRZYCHÓD WG METODY PŁATNOŚCI",
      "Metoda płatności,Liczba wizyt,Przychód (PLN),Udział (%)",
      '"Gotówka",1,50.00,35.7',
      '"Karta",1,90.00,64.3',
      '"BLIK",0,0.00,0.0',
      '"Bez zapisu płatności",0,0.00,0.0',
      "RAZEM,2,140.00,100.0",
    ]);
  });

  it("XLSX: arkusz „Wg metody płatności” z czterema wierszami i RAZEM, źródło w podsumowaniu", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([
      appt({ paidAmount: "50.00", paymentMethod: "card" }),
      appt({ paidAmount: "25.00", paymentMethod: "blik" }),
    ]);

    const res = await call("xlsx");
    expect(res.status).toBe(200);
    expect(excel.createExcelWorkbook).toHaveBeenCalledTimes(1);
    const sheets = excel.createExcelWorkbook.mock.calls[0]![0] as {
      name: string;
      headers: string[];
      rows: (string | number)[][];
    }[];

    expect(sheets.map((s) => s.name)).toEqual([
      "Podsumowanie",
      "Wg usługi",
      "Wg pracownika",
      "Wg metody płatności",
      "Trend dzienny",
    ]);
    const summary = sheets[0]!;
    expect(summary.headers).toEqual(["Metryka", "Wartość"]);
    expect(summary.rows).toContainEqual(["Źródło kwot", REVENUE_SOURCE_NOTE]);
    expect(summary.rows).toContainEqual(["Całkowity przychód (PLN)", "75.00"]);

    const methods = sheets[3]!;
    expect(methods.headers).toEqual(["Metoda płatności", "Liczba wizyt", "Przychód (PLN)", "Udział (%)"]);
    expect(methods.rows).toEqual([
      ["Gotówka", 0, "0.00", "0.0"],
      ["Karta", 1, "50.00", "66.7"],
      ["BLIK", 1, "25.00", "33.3"],
      ["Bez zapisu płatności", 0, "0.00", "0.0"],
      ["RAZEM", 2, "75.00", "100.0"],
    ]);
  });

  it("CSV bez wizyt: sekcja metod z zerami i wiersz RAZEM z udziałem 0.0", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([]);

    const res = await call("csv");
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\n");

    const section = lines.indexOf("PRZYCHÓD WG METODY PŁATNOŚCI");
    expect(section).toBeGreaterThan(-1);
    expect(lines.slice(section + 2, section + 7)).toEqual([
      '"Gotówka",0,0.00,0.0',
      '"Karta",0,0.00,0.0',
      '"BLIK",0,0.00,0.0',
      '"Bez zapisu płatności",0,0.00,0.0',
      "RAZEM,0,0.00,0.0",
    ]);
  });

  it("XLSX bez wizyt: arkusz metod z zerami i wiersz RAZEM z udziałem 0.0", async () => {
    m.asOwnerOf(SALON_A);
    m.txRows.push([]);

    const res = await call("xlsx");
    expect(res.status).toBe(200);
    const sheets = excel.createExcelWorkbook.mock.calls[0]![0] as {
      name: string;
      rows: (string | number)[][];
    }[];
    const methods = sheets.find((s) => s.name === "Wg metody płatności");

    expect(methods?.rows).toEqual([
      ["Gotówka", 0, "0.00", "0.0"],
      ["Karta", 0, "0.00", "0.0"],
      ["BLIK", 0, "0.00", "0.0"],
      ["Bez zapisu płatności", 0, "0.00", "0.0"],
      ["RAZEM", 0, "0.00", "0.0"],
    ]);
  });

  describe("RAZEM w arkuszach usług i pracowników — jedna reguła udziału", () => {
    async function sheetsFor(rows: unknown[]) {
      m.asOwnerOf(SALON_A);
      m.txRows.push(rows);
      const res = await call("xlsx");
      expect(res.status).toBe(200);
      return excel.createExcelWorkbook.mock.calls[0]![0] as { name: string; rows: (string | number)[][] }[];
    }
    const razem = (sheets: { name: string; rows: (string | number)[][] }[], name: string) =>
      sheets.find((s) => s.name === name)?.rows.find((r) => r[0] === "RAZEM");

    it("suma > 0: udział RAZEM 100.0", async () => {
      const sheets = await sheetsFor([
        appt({ paidAmount: "50.00", paymentMethod: "cash" }),
        appt({ paidAmount: "30.00", paymentMethod: "card", employeeId: "emp-2" }),
      ]);
      expect(razem(sheets, "Wg usługi")).toEqual(["RAZEM", 2, "80.00", "40.00", "100.0"]);
      expect(razem(sheets, "Wg pracownika")).toEqual(["RAZEM", 2, "80.00", "40.00", "100.0"]);
    });

    it("brak wizyt: udział RAZEM 0.0", async () => {
      const sheets = await sheetsFor([]);
      expect(razem(sheets, "Wg usługi")).toEqual(["RAZEM", 0, "0.00", "0.00", "0.0"]);
      expect(razem(sheets, "Wg pracownika")).toEqual(["RAZEM", 0, "0.00", "0.00", "0.0"]);
    });

    it("wizyty za 0 zł: udział RAZEM 0.0", async () => {
      const sheets = await sheetsFor([appt({ paidAmount: "0.00", paymentMethod: "cash" })]);
      expect(razem(sheets, "Wg usługi")).toEqual(["RAZEM", 1, "0.00", "0.00", "0.0"]);
      expect(razem(sheets, "Wg pracownika")).toEqual(["RAZEM", 1, "0.00", "0.00", "0.0"]);
    });
  });

  describe("zdanie o grupie „Bez zapisu płatności” w eksporcie", () => {
    const NO_RECORD_ROW_LITERAL =
      'Bez zapisu płatności,"Bez zapisu płatności: wizyty zakończone, zanim aplikacja zaczęła pytać o kwotę i metodę. Ich kwota to cena usługi minus rabat."';
    const SOURCE_ROW_LITERAL =
      'Źródło kwot,"Przychód to kwoty wpisane przy zakończeniu wizyty. Nie pochodzi z kasy fiskalnej ani z terminala płatniczego."';

    async function csvLines(rows: unknown[]) {
      m.asOwnerOf(SALON_A);
      m.txRows.push(rows);
      const res = await call("csv");
      expect(res.status).toBe(200);
      return (await res.text()).split("\n");
    }

    async function summaryRows(rows: unknown[]) {
      m.asOwnerOf(SALON_A);
      m.txRows.push(rows);
      const res = await call("xlsx");
      expect(res.status).toBe(200);
      const sheets = excel.createExcelWorkbook.mock.calls[0]![0] as { name: string; rows: (string | number)[][] }[];
      return sheets.find((s) => s.name === "Podsumowanie")!.rows;
    }

    it("CSV z wizytą bez zapisu: oba zdania, drugie tuż po zdaniu o źródle", async () => {
      const lines = await csvLines([
        appt({ paidAmount: "50.00", paymentMethod: "cash" }),
        appt({ basePrice: "100.00", discountAmount: "10.00" }),
      ]);
      expect(lines).toContain(SOURCE_ROW_LITERAL);
      expect(lines).toContain(`Bez zapisu płatności,"${REVENUE_NO_RECORD_NOTE}"`);
      expect(lines.indexOf(NO_RECORD_ROW_LITERAL)).toBe(lines.indexOf(SOURCE_ROW_LITERAL) + 1);
      // wiersz grupy w sekcji metod zostaje jak był
      expect(lines).toContain('"Bez zapisu płatności",1,90.00,64.3');
    });

    it("CSV tylko z wizytami z zapisem: zdanie o źródle bez drugiego zdania", async () => {
      const lines = await csvLines([appt({ paidAmount: "50.00", paymentMethod: "cash" })]);
      expect(lines).toContain(SOURCE_ROW_LITERAL);
      expect(lines.filter((l) => l.startsWith("Bez zapisu płatności,"))).toEqual([]);
      expect(lines).toContain('"Bez zapisu płatności",0,0.00,0.0');
    });

    it("CSV bez wizyt: bez drugiego zdania", async () => {
      const lines = await csvLines([]);
      expect(lines.filter((l) => l.startsWith("Bez zapisu płatności,"))).toEqual([]);
    });

    it("XLSX z wizytą bez zapisu: oba zdania w Podsumowaniu, drugie po źródle", async () => {
      const rows = await summaryRows([
        appt({ paidAmount: "50.00", paymentMethod: "cash" }),
        appt({ basePrice: "100.00", discountAmount: "10.00" }),
      ]);
      const sourceIdx = rows.findIndex((r) => r[0] === "Źródło kwot");
      expect(rows[sourceIdx]).toEqual([
        "Źródło kwot",
        "Przychód to kwoty wpisane przy zakończeniu wizyty. Nie pochodzi z kasy fiskalnej ani z terminala płatniczego.",
      ]);
      expect(rows[sourceIdx + 1]).toEqual([
        "Bez zapisu płatności",
        "Bez zapisu płatności: wizyty zakończone, zanim aplikacja zaczęła pytać o kwotę i metodę. Ich kwota to cena usługi minus rabat.",
      ]);
      expect(rows[sourceIdx + 1]).toEqual(["Bez zapisu płatności", REVENUE_NO_RECORD_NOTE]);
    });

    it("XLSX tylko z wizytami z zapisem: bez drugiego zdania", async () => {
      const rows = await summaryRows([appt({ paidAmount: "50.00", paymentMethod: "card" })]);
      expect(rows).toContainEqual(["Źródło kwot", REVENUE_SOURCE_NOTE]);
      expect(rows.filter((r) => r[0] === "Bez zapisu płatności")).toEqual([]);
    });

    it("XLSX bez wizyt: bez drugiego zdania", async () => {
      const rows = await summaryRows([]);
      expect(rows.filter((r) => r[0] === "Bez zapisu płatności")).toEqual([]);
    });
  });

  it("trasa woła forSalon z salonem sesji", async () => {
    await report([appt({ paidAmount: "10.00", paymentMethod: "cash" })]);
    expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
  });

  it("błąd bazy → 500 bez szczegółów", async () => {
    m.asOwnerOf(SALON_A);
    // thenable odrzucany dopiero przy odczycie wiersza przez trasę
    m.txRows.push({
      then: (_ok: unknown, fail: (e: unknown) => void) => fail(new Error("boom")),
    } as unknown as unknown[]);
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: "Failed to generate revenue report" });
  });
});
