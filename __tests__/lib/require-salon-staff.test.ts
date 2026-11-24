/**
 * requireSalonStaff — bramka tras salon-scoped (P0 z przeglądu bezpieczeństwa).
 *
 * Salon pochodzi WYŁĄCZNIE z sesji (salons.ownerId / employees.userId);
 * salonId z żądania jest tylko porównywany. Mocki jak w salon-context.test.ts
 * (łańcuch db.select().from().where().limit()), kolejność zapytań:
 *   1. salon właścicielski, 2a. (owner) własny rekord employees,
 *   2b. (nie-owner) aktywny pracownik.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireSalonStaff } from "@/lib/salon-context";

const { mockGetSession, mockDbLimit, mockHasTemporaryAccess } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDbLimit: vi.fn(),
  mockHasTemporaryAccess: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mockDbLimit }) }) }),
  },
}));

vi.mock("@/lib/temporary-access", () => ({
  hasTemporaryAccess: (...args: unknown[]) => mockHasTemporaryAccess(...args),
}));

const SALON_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALON_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function asOwner(salonId = SALON_A) {
  mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
  mockDbLimit
    .mockResolvedValueOnce([{ id: salonId }]) // salon właścicielski
    .mockResolvedValueOnce([]); // brak własnego rekordu employees
}

function asStaff(role: string, salonId = SALON_A) {
  mockGetSession.mockResolvedValue({ user: { id: "staff-1" } });
  mockDbLimit
    .mockResolvedValueOnce([]) // nie właściciel
    .mockResolvedValueOnce([{ id: "emp-1", salonId, role }]);
}

async function status(result: Awaited<ReturnType<typeof requireSalonStaff>>) {
  return result.error ? result.error.status : 200;
}

describe("requireSalonStaff", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockHasTemporaryAccess.mockResolvedValue(false);
  });

  it("401 bez sesji (zero zapytań do bazy)", async () => {
    mockGetSession.mockResolvedValue(null);
    const r = await requireSalonStaff();
    expect(await status(r)).toBe(401);
    expect(mockDbLimit).not.toHaveBeenCalled();
  });

  it("404 gdy konto nie ma salonu (ani właściciel, ani aktywny pracownik)", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "client-1" } });
    mockDbLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const r = await requireSalonStaff();
    expect(await status(r)).toBe(404);
  });

  it("właściciel: ctx z salonem z sesji", async () => {
    asOwner();
    const r = await requireSalonStaff({ roles: ["owner"] });
    expect(r.ctx).toEqual({
      salonId: SALON_A,
      role: "owner",
      employeeId: null,
      userId: "owner-1",
    });
  });

  it("właściciel salonu A z salonId salonu B w żądaniu => 403", async () => {
    asOwner(SALON_A);
    const r = await requireSalonStaff({ roles: ["owner"], requestedSalonId: SALON_B });
    expect(await status(r)).toBe(403);
  });

  it("salonId z żądania równy salonowi sesji => OK", async () => {
    asOwner(SALON_A);
    const r = await requireSalonStaff({ requestedSalonId: SALON_A });
    expect(r.ctx?.salonId).toBe(SALON_A);
  });

  it("pusty salonId z żądania => salon sesji (nigdy wybór z żądania)", async () => {
    asStaff("receptionist", SALON_A);
    const r = await requireSalonStaff({ requestedSalonId: null });
    expect(r.ctx?.salonId).toBe(SALON_A);
  });

  it("pracownik z salonId innego salonu => 403 (nawet z grantem)", async () => {
    asStaff("employee", SALON_A);
    mockHasTemporaryAccess.mockResolvedValue(true);
    const r = await requireSalonStaff({ feature: "promotions", requestedSalonId: SALON_B });
    expect(await status(r)).toBe(403);
  });

  it("pracownik bez wymaganej roli i bez grantu => 403", async () => {
    asStaff("employee");
    const r = await requireSalonStaff({ roles: ["owner"], feature: "promotions" });
    expect(await status(r)).toBe(403);
    expect(mockHasTemporaryAccess).toHaveBeenCalledWith("staff-1", "promotions", SALON_A);
  });

  it("grant sprawdzany w salonie z sesji (grant z salonu B nie otwiera salonu A)", async () => {
    // Pracownik salonu A; grant istnieje tylko w salonie B => sprawdzenie
    // zawężone do SALON_A musi go nie znaleźć.
    asStaff("employee", SALON_A);
    mockHasTemporaryAccess.mockImplementation(
      async (_u: string, _f: string, salonId?: string) => salonId === SALON_B
    );
    const r = await requireSalonStaff({ roles: ["owner"], feature: "promotions" });
    expect(await status(r)).toBe(403);
    expect(mockHasTemporaryAccess).toHaveBeenCalledWith("staff-1", "promotions", SALON_A);
  });

  it("pracownik z grantem feature => OK", async () => {
    asStaff("employee");
    mockHasTemporaryAccess.mockResolvedValue(true);
    const r = await requireSalonStaff({ roles: ["owner"], feature: "promotions" });
    expect(r.ctx?.role).toBe("employee");
  });

  it("samo feature (bez roles) => tylko właściciel albo grant", async () => {
    asStaff("receptionist");
    const r = await requireSalonStaff({ feature: "finance" });
    expect(await status(r)).toBe(403);
  });

  it("roles obejmuje rolę pracownika => OK bez sprawdzania grantu", async () => {
    asStaff("receptionist");
    const r = await requireSalonStaff({ roles: ["receptionist"], feature: "clients" });
    expect(r.ctx?.role).toBe("receptionist");
    expect(mockHasTemporaryAccess).not.toHaveBeenCalled();
  });

  it("bez opcji => każdy członek personelu własnego salonu", async () => {
    asStaff("employee");
    const r = await requireSalonStaff();
    expect(r.ctx?.salonId).toBe(SALON_A);
  });

  it("konto z kilkoma aktywnymi rekordami pracownika => 403 z komunikatem (bez zgadywania salonu)", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "staff-2" } });
    mockDbLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: "emp-1", salonId: SALON_A, role: "employee" },
      { id: "emp-2", salonId: SALON_B, role: "employee" },
    ]);
    const r = await requireSalonStaff();
    expect(await status(r)).toBe(403);
    const body = await r.error!.json();
    expect(body.error).toMatch(/kilku aktywnych rekord/);
  });

  it("nie polega na user.role: konto z user.role='owner' bez salonu => 404", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u-x", role: "owner" } });
    mockDbLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const r = await requireSalonStaff({ roles: ["owner"] });
    expect(await status(r)).toBe(404);
  });
});
