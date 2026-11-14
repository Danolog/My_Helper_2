import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSalonContext = vi.fn();
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: () => mockGetSalonContext(),
}));

import { requireReportSalon } from "@/lib/reports/require-report-salon";

const OWN = "3c0b7926-3bcf-41ee-82c2-0b65ed48585c";
const OTHER = "00000000-0000-4000-8000-000000000001";

function req(salonId?: string) {
  const url = salonId
    ? `http://localhost/api/reports/revenue?salonId=${salonId}`
    : `http://localhost/api/reports/revenue`;
  return new Request(url);
}

describe("requireReportSalon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSalonContext.mockResolvedValue({
      salonId: OWN,
      role: "owner",
      employeeId: null,
      userId: "u1",
    });
  });

  it("returns the session salon when the param matches", async () => {
    const r = await requireReportSalon(req(OWN));
    expect(r).toEqual({ salonId: OWN });
  });

  // UAT X-1: cross-tenant read — inny salonId niz sesyjny musi byc odrzucony
  it("returns 403 when the param is a different salon", async () => {
    const r = await requireReportSalon(req(OTHER));
    expect("error" in r).toBe(true);
    expect((r as { error: Response }).error.status).toBe(403);
  });

  it("returns 400 when salonId is missing", async () => {
    const r = await requireReportSalon(req());
    expect((r as { error: Response }).error.status).toBe(400);
  });

  it("returns 401 when there is no session/salon", async () => {
    mockGetSalonContext.mockResolvedValue(null);
    const r = await requireReportSalon(req(OWN));
    expect((r as { error: Response }).error.status).toBe(401);
  });

  // UAT F2: niepoprawny format daty -> 400, nie 500 z DB
  it("returns 400 for an unparseable dateFrom", async () => {
    const request = new Request(
      `http://localhost/api/reports/revenue?salonId=${OWN}&dateFrom=garbage&dateTo=2026-07-01`,
    );
    const r = await requireReportSalon(request);
    expect((r as { error: Response }).error.status).toBe(400);
  });

  it("accepts valid dateFrom/dateTo", async () => {
    const request = new Request(
      `http://localhost/api/reports/revenue?salonId=${OWN}&dateFrom=2026-06-01&dateTo=2026-07-01`,
    );
    const r = await requireReportSalon(request);
    expect(r).toEqual({ salonId: OWN });
  });
});
