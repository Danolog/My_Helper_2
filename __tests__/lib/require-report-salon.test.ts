import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetSalonContext = vi.fn();
vi.mock("@/lib/salon-context", () => ({
  getSalonContext: () => mockGetSalonContext(),
}));

import { requireReportSalon } from "@/lib/reports/require-report-salon";

const OWN = "3c0b7926-3bcf-41ee-82c2-0b65ed48585c";
const OTHER = "00000000-0000-0000-0000-000000000001";

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
});
