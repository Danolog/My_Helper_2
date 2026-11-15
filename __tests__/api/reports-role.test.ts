/**
 * Raporty — rola, nie tylko salon (P1 z przeglądu Ethana).
 *
 * requireReportSalon sprawdzał wyłącznie, czy salonId z query = salon sesji.
 * Każdy aktywny pracownik (rola employee/receptionist) dostawał więc
 * revenue (przychód salonu) i employee-payroll (prowizje i wynagrodzenia
 * kolegów). Teraz: właściciel albo czasowy grant "reports" (temporary_access),
 * jak finance/commissions dla grantu "finance".
 *
 * Przez prawdziwą bramkę (salon-context + forSalon) — mockowane tylko krawędzie
 * (sesja, db, granty), patrz salon-staff-harness.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as cancellations } from "@/app/api/reports/cancellations/route";
import { GET as employeeOccupancy } from "@/app/api/reports/employee-occupancy/route";
import { GET as employeePayroll } from "@/app/api/reports/employee-payroll/route";
import { GET as employeePopularity } from "@/app/api/reports/employee-popularity/route";
import { GET as materials } from "@/app/api/reports/materials/route";
import { GET as materialsProfitloss } from "@/app/api/reports/materials-profitloss/route";
import { GET as monthlyComparison } from "@/app/api/reports/monthly-comparison/route";
import { GET as promotions } from "@/app/api/reports/promotions/route";
import { GET as revenue } from "@/app/api/reports/revenue/route";
import { GET as serviceProfitability } from "@/app/api/reports/service-profitability/route";
import { GET as servicesPopularity } from "@/app/api/reports/services-popularity/route";
import { GET as yearlyComparison } from "@/app/api/reports/yearly-comparison/route";
import { SALON_A } from "./salon-staff-harness";

const m = await vi.hoisted(async () =>
  (await import("./salon-staff-harness")).createSalonStaffMocks()
);

vi.mock("next/headers", () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.getSession } } }));
vi.mock("@/lib/db", () => ({ db: m.db }));
vi.mock("@/lib/temporary-access", () => ({ hasTemporaryAccess: m.hasTemporaryAccess }));

type Handler = (request: Request) => Promise<Response>;

const ALL_REPORTS: Record<string, Handler> = {
  cancellations,
  "employee-occupancy": employeeOccupancy,
  "employee-payroll": employeePayroll,
  "employee-popularity": employeePopularity,
  materials,
  "materials-profitloss": materialsProfitloss,
  "monthly-comparison": monthlyComparison,
  promotions,
  revenue,
  "service-profitability": serviceProfitability,
  "services-popularity": servicesPopularity,
  "yearly-comparison": yearlyComparison,
};

function call(name: string, handler: Handler) {
  return handler(
    new Request(
      `http://localhost/api/reports/${name}?salonId=${SALON_A}&dateFrom=2026-10-01&dateTo=2026-10-31` +
        // komplet parametrów comparison — 400 z walidacji nie może maskować braku 403
        `&month1=2026-09&month2=2026-10&year1=2025&year2=2026`
    )
  );
}

/**
 * Sesja jest pobierana dwa razy (requireAuth + getSalonContext), a kontekst
 * salonu zużywa wiersze z ctxRows — przy każdym wywołaniu trasy doładowujemy.
 */
function asOwner() {
  m.asOwnerOf(SALON_A);
}
function asStaff(role: "employee" | "receptionist") {
  m.asStaffOf(SALON_A, role);
}

describe("raporty — dostęp wg roli", () => {
  beforeEach(() => m.reset());

  describe.each(["revenue", "employee-payroll"])("%s", (name) => {
    const handler = ALL_REPORTS[name]!;

    it("pracownik bez grantu => 403, zero zapytań o dane", async () => {
      asStaff("employee");
      const res = await call(name, handler);
      expect(res.status).toBe(403);
      expect(m.rlsSalonIds()).toEqual([]);
      // (userId, feature) — #42 dokłada trzeci argument salonId z sesji
      expect(m.hasTemporaryAccess.mock.calls.map((c) => c.slice(0, 2))).toEqual([
        ["staff-a", "reports"],
      ]);
    });

    it("recepcja bez grantu => 403", async () => {
      asStaff("receptionist");
      const res = await call(name, handler);
      expect(res.status).toBe(403);
    });

    it("właściciel => 200 (bez sprawdzania grantu)", async () => {
      asOwner();
      const res = await call(name, handler);
      expect(res.status).toBe(200);
      expect(m.hasTemporaryAccess).not.toHaveBeenCalled();
      expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
    });

    it("pracownik z grantem reports => 200", async () => {
      asStaff("employee");
      m.hasTemporaryAccess.mockResolvedValue(true);
      const res = await call(name, handler);
      expect(res.status).toBe(200);
      expect(new Set(m.rlsSalonIds())).toEqual(new Set([SALON_A]));
    });
  });

  // #101: jeden strażnik (requireSalonStaff) — konto bez salonu 404, nie 401.
  it.each(Object.keys(ALL_REPORTS))(
    "%s: zalogowany bez salonu => 404, zero zapytań o dane",
    async (name) => {
      m.signIn("client-1");
      m.ctxRows.push([], []);
      const res = await call(name, ALL_REPORTS[name]!);
      expect(res.status).toBe(404);
      expect(m.rlsSalonIds()).toEqual([]);
    }
  );

  it.each(Object.keys(ALL_REPORTS))(
    "%s: bez sesji => 401",
    async (name) => {
      m.getSession.mockResolvedValue(null);
      const res = await call(name, ALL_REPORTS[name]!);
      expect(res.status).toBe(401);
    }
  );

  it.each(Object.keys(ALL_REPORTS))(
    "%s: pracownik bez grantu => 403",
    async (name) => {
      asStaff("employee");
      const res = await call(name, ALL_REPORTS[name]!);
      expect(res.status).toBe(403);
      expect(m.rlsSalonIds()).toEqual([]);
    }
  );
});
