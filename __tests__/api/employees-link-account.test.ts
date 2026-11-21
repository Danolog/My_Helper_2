/**
 * Faza 3 — łączenie konta użytkownika z pracownikiem:
 * PUT /api/employees/[id]/link-account.
 *
 * Tylko właściciel salonu (getUserSalonId). Body { email: string | null }:
 * email => podpięcie konta (404 brak konta, 409 e-mail niepotwierdzony,
 * 409 konto już podpięte pod innego pracownika, 409 konto właściciela salonu),
 * null => odłączenie.
 *
 * #193: trasa nie sięga do surowego `db` — pracownik przez forSalon(salonId),
 * konto przez wyjście systemowe findAccountForEmployeeLink. Atrapa `@/lib/db`
 * rzuca przy każdym użyciu.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { employees } from "@/lib/schema";
import {
  createMockRequest,
  createRouteParams,
  parseResponse,
  TEST_IDS,
  makeEmployee,
} from "./helpers";

// -------------------------------------------------------
// Mocks (fabryki leniwe: tylko vi.hoisted i wnętrza strzałek)
// -------------------------------------------------------

const m = vi.hoisted(() => ({
  findOne: vi.fn(),
  updateOwned: vi.fn(),
  forSalon: vi.fn(),
  findAccount: vi.fn(),
  requireAuth: vi.fn(),
  validateBody: vi.fn(),
  revokeGrants: vi.fn(),
  getUserSalonId: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: () => {
        throw new Error("surowy db niedozwolony w link-account (#193)");
      },
    }
  ),
}));

vi.mock("@/lib/server/repository", () => ({
  forSalon: (...args: unknown[]) => m.forSalon(...args),
}));

vi.mock("@/lib/server/system", () => ({
  findAccountForEmployeeLink: (...args: unknown[]) => m.findAccount(...args),
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: (...args: unknown[]) => m.requireAuth(...args),
  isAuthError: () => false,
}));

vi.mock("@/lib/api-validation", () => ({
  validateBody: (...args: unknown[]) => m.validateBody(...args),
  linkEmployeeAccountSchema: {},
}));

vi.mock("@/lib/temporary-access", () => ({
  revokeSalonGrantsForUser: (...args: unknown[]) => m.revokeGrants(...args),
}));

vi.mock("@/lib/get-user-salon", () => ({
  getUserSalonId: (...args: unknown[]) => m.getUserSalonId(...args),
}));

const OWNER_ID = "owner-A";
const LINKED_USER_ID = "user-777";
const URL_BASE = `http://localhost:3000/api/employees/${TEST_IDS.EMPLOYEE_UUID}/link-account`;

const okAccount = (over: Record<string, unknown> = {}) => ({
  id: LINKED_USER_ID,
  emailVerified: true,
  linkedElsewhere: false,
  ownsSalon: false,
  ...over,
});

import { PUT as putLinkAccount } from "@/app/api/employees/[id]/link-account/route";

function callPut(body: unknown) {
  return putLinkAccount(
    createMockRequest(URL_BASE, { method: "PUT", body }),
    createRouteParams(TEST_IDS.EMPLOYEE_UUID)
  );
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("PUT /api/employees/[id]/link-account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.validateBody.mockReturnValue(null);
    m.requireAuth.mockResolvedValue({ user: { id: OWNER_ID } });
    m.getUserSalonId.mockResolvedValue(TEST_IDS.SALON_UUID);
    m.forSalon.mockReturnValue({ findOne: m.findOne, updateOwned: m.updateOwned });
    m.findOne.mockResolvedValue(makeEmployee());
    m.updateOwned.mockImplementation(async (_t: unknown, _id: unknown, patch: Record<string, unknown>) =>
      makeEmployee(patch)
    );
    m.findAccount.mockResolvedValue(null);
    m.revokeGrants.mockResolvedValue(0);
  });

  it("happy path: podpina istniejace konto do pracownika salonu", async () => {
    m.findAccount.mockResolvedValue(okAccount());

    const response = await callPut({ email: "anna@example.invalid" });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body.data as Record<string, unknown>).userId).toBe(LINKED_USER_ID);
    // Salon tylko z sesji; pracownik szukany i zapisywany w salonie wolajacego.
    expect(m.forSalon).toHaveBeenCalledWith(TEST_IDS.SALON_UUID);
    expect(m.forSalon.mock.calls.every((c) => c[0] === TEST_IDS.SALON_UUID)).toBe(true);
    expect(m.findOne).toHaveBeenCalledWith(employees, TEST_IDS.EMPLOYEE_UUID);
    // exceptEmployeeId = pracownik z URL, juz sprawdzony w salonie wolajacego.
    expect(m.findAccount).toHaveBeenCalledWith("anna@example.invalid", TEST_IDS.EMPLOYEE_UUID);
    expect(m.updateOwned).toHaveBeenCalledWith(employees, TEST_IDS.EMPLOYEE_UUID, { userId: LINKED_USER_ID });
  });

  it("zwraca 404, gdy brak salonu wlascicielskiego (pracownik/obcy user)", async () => {
    m.getUserSalonId.mockResolvedValue(null);

    const response = await callPut({ email: "anna@example.invalid" });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(m.forSalon).not.toHaveBeenCalled();
    expect(m.findAccount).not.toHaveBeenCalled();
  });

  it("zwraca 404 dla pracownika spoza salonu wolajacego (cudzy/nieistniejacy)", async () => {
    m.findOne.mockResolvedValue(null);

    const response = await callPut({ email: "anna@example.invalid" });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Nie znaleziono pracownika");
    expect(m.findAccount).not.toHaveBeenCalled();
    expect(m.updateOwned).not.toHaveBeenCalled();
  });

  it("zwraca 404, gdy konto o podanym emailu nie istnieje", async () => {
    m.findAccount.mockResolvedValue(null);

    const response = await callPut({ email: "nieistnieje@example.invalid" });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Nie znaleziono konta o tym adresie e-mail");
    expect(m.updateOwned).not.toHaveBeenCalled();
  });

  // Konto znalezione po e-mailu podpinamy tylko przy potwierdzonym adresie:
  // inaczej ktos, kto zalozy konto na e-mail przyszlego pracownika, dostanie
  // po podpieciu dostep pracownika do salonu (straznik jak src/lib/client-match.ts).
  it("zwraca 409 z czytelnym bledem, gdy konto ma niepotwierdzony e-mail (bez podpiecia)", async () => {
    m.findAccount.mockResolvedValue(okAccount({ emailVerified: false }));

    const response = await callPut({ email: "anna@example.invalid" });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toBe(
      "To konto nie ma potwierdzonego adresu e-mail. Popros pracownika o potwierdzenie adresu (link z wiadomosci po rejestracji) i sprobuj ponownie."
    );
    expect(m.updateOwned).not.toHaveBeenCalled();
  });

  it("niepotwierdzony e-mail ma pierwszenstwo przed pozostalymi odmowami (kolejnosc bez zmian)", async () => {
    m.findAccount.mockResolvedValue(okAccount({ emailVerified: false, linkedElsewhere: true, ownsSalon: true }));

    const { status, body } = await parseResponse(await callPut({ email: "anna@example.invalid" }));

    expect(status).toBe(409);
    expect(body.error).toContain("nie ma potwierdzonego adresu e-mail");
  });

  it("zwraca 409, gdy konto jest juz podpiete pod pracownika innego salonu", async () => {
    m.findAccount.mockResolvedValue(okAccount({ linkedElsewhere: true }));

    const response = await callPut({ email: "anna@example.invalid" });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toBe("To konto jest juz przypisane do innego pracownika");
    expect(m.updateOwned).not.toHaveBeenCalled();
    expect(m.revokeGrants).not.toHaveBeenCalled();
  });

  it("podpiete gdzie indziej ma pierwszenstwo przed wlascicielem salonu (kolejnosc bez zmian)", async () => {
    m.findAccount.mockResolvedValue(okAccount({ linkedElsewhere: true, ownsSalon: true }));

    const { status, body } = await parseResponse(await callPut({ email: "anna@example.invalid" }));

    expect(status).toBe(409);
    expect(body.error).toBe("To konto jest juz przypisane do innego pracownika");
  });

  it("zwraca 409, gdy konto nalezy do wlasciciela innego salonu", async () => {
    m.findAccount.mockResolvedValue(okAccount({ ownsSalon: true }));

    const response = await callPut({ email: "wlasciciel@example.invalid" });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toBe("Wlasciciel salonu nie moze byc pracownikiem innego salonu");
    expect(m.updateOwned).not.toHaveBeenCalled();
    expect(m.revokeGrants).not.toHaveBeenCalled();
  });

  it("odpowiedz sukcesu nie zawiera flag konta (tylko zapisany pracownik)", async () => {
    m.findAccount.mockResolvedValue(okAccount());

    const { body } = await parseResponse(await callPut({ email: "anna@example.invalid" }));

    expect(body).not.toHaveProperty("linkedElsewhere");
    expect(body).not.toHaveProperty("ownsSalon");
    expect(body.data as Record<string, unknown>).not.toHaveProperty("ownsSalon");
  });

  it("email=null odlacza konto od pracownika bez lookupu konta", async () => {
    m.findOne.mockResolvedValue(makeEmployee({ userId: LINKED_USER_ID }));

    const response = await callPut({ email: null });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(m.updateOwned).toHaveBeenCalledWith(employees, TEST_IDS.EMPLOYEE_UUID, { userId: null });
    expect(m.findAccount).not.toHaveBeenCalled();
  });

  it("email=null kasuje granty czasowe nadane temu kontu przez wlasciciela salonu", async () => {
    m.findOne.mockResolvedValue(makeEmployee({ userId: LINKED_USER_ID }));

    const response = await callPut({ email: null });

    expect(response.status).toBe(200);
    // Tylko granty TEGO salonu (granted_by = wlasciciel z sesji) dla odpinanego konta.
    expect(m.revokeGrants).toHaveBeenCalledWith(LINKED_USER_ID, OWNER_ID);
  });

  it("email=null na pracowniku bez konta nie kasuje niczego", async () => {
    m.findOne.mockResolvedValue(makeEmployee({ userId: null }));

    const response = await callPut({ email: null });

    expect(response.status).toBe(200);
    expect(m.revokeGrants).not.toHaveBeenCalled();
  });

  it("przepiecie na inne konto kasuje granty poprzedniego konta", async () => {
    m.findOne.mockResolvedValue(makeEmployee({ userId: "user-old" }));
    m.findAccount.mockResolvedValue(okAccount());

    const response = await callPut({ email: "anna@example.invalid" });

    expect(response.status).toBe(200);
    expect(m.revokeGrants).toHaveBeenCalledWith("user-old", OWNER_ID);
  });

  it("ponowne podpiecie tego samego konta nie kasuje jego grantow", async () => {
    m.findOne.mockResolvedValue(makeEmployee({ userId: LINKED_USER_ID }));
    m.findAccount.mockResolvedValue(okAccount());

    const response = await callPut({ email: "anna@example.invalid" });

    expect(response.status).toBe(200);
    expect(m.revokeGrants).not.toHaveBeenCalled();
  });

  it("blad wyjscia systemowego => 500 bez zapisu", async () => {
    m.findAccount.mockRejectedValue(new Error("db down"));

    const response = await callPut({ email: "anna@example.invalid" });
    const { status, body } = await parseResponse(response);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(m.updateOwned).not.toHaveBeenCalled();
  });
});
