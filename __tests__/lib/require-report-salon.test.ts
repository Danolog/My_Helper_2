import { NextResponse } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireSalonStaff = vi.fn();
vi.mock("@/lib/salon-context", () => ({
  requireSalonStaff: (...args: unknown[]) => mockRequireSalonStaff(...args),
}));

import { requireReportSalon, REPORTS_FEATURE } from "@/lib/reports/require-report-salon";

const OWN = "3c0b7926-3bcf-41ee-82c2-0b65ed48585c";
const OTHER = "00000000-0000-4000-8000-000000000001";

function req(query = "") {
  return new Request(`http://localhost/api/reports/revenue${query}`);
}
const deny = (status: number) => ({
  error: NextResponse.json({ success: false, error: "x" }, { status }),
});

/**
 * #101: requireReportSalon to cienkie opakowanie — autoryzacja w
 * requireSalonStaff (pełne ścieżki ról i salonu: reports-role.test.ts,
 * salon-query-scope-contract.test.ts), tu tylko delegacja i walidacja 400.
 */
describe("requireReportSalon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSalonStaff.mockResolvedValue({
      ctx: { salonId: OWN, role: "owner", employeeId: null, userId: "u1" },
    });
  });

  it("deleguje do requireSalonStaff z salonId z query i grantem reports", async () => {
    const r = await requireReportSalon(req(`?salonId=${OTHER}`));
    expect(mockRequireSalonStaff).toHaveBeenCalledWith({ requestedSalonId: OTHER, feature: REPORTS_FEATURE });
    expect(REPORTS_FEATURE).toBe("reports");
    expect(r).toEqual({ salonId: OWN });
  });

  it("zwraca salon z sesji, gdy strażnik przepuszcza", async () => {
    expect(await requireReportSalon(req(`?salonId=${OWN}`))).toEqual({ salonId: OWN });
  });

  it.each([401, 403, 404])("odmowa strażnika %i przechodzi bez zmian", async (status) => {
    mockRequireSalonStaff.mockResolvedValue(deny(status));
    const r = await requireReportSalon(req(`?salonId=${OWN}`));
    expect((r as { error: Response }).error.status).toBe(status);
  });

  it("odmowa strażnika ma pierwszeństwo przed walidacją 400", async () => {
    mockRequireSalonStaff.mockResolvedValue(deny(404));
    const r = await requireReportSalon(req(`?dateFrom=garbage`));
    expect((r as { error: Response }).error.status).toBe(404);
  });

  it("brak salonId => 400", async () => {
    const r = await requireReportSalon(req());
    expect(mockRequireSalonStaff).toHaveBeenCalledWith({ requestedSalonId: null, feature: REPORTS_FEATURE });
    expect((r as { error: Response }).error.status).toBe(400);
  });

  // UAT F2: niepoprawny format daty -> 400, nie 500 z DB
  it.each(["dateFrom", "dateTo"])("nieparsowalne %s => 400", async (key) => {
    const r = await requireReportSalon(req(`?salonId=${OWN}&${key}=garbage`));
    expect((r as { error: Response }).error.status).toBe(400);
  });

  it("poprawne dateFrom/dateTo przechodzą", async () => {
    const r = await requireReportSalon(req(`?salonId=${OWN}&dateFrom=2026-06-01&dateTo=2026-07-01`));
    expect(r).toEqual({ salonId: OWN });
  });
});
