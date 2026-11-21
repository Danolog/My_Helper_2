import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useBookingData } from "@/app/(client)/salons/[id]/book/_hooks/use-booking-data";
import { TEST_PHONE, TEST_PHONE_NUMBERS } from "@/lib/test-phone";

// Portal rezerwacji, zadatek BLIK-iem na telefon salonu: gdy przełącznik
// isBlikDepositFlow() jest włączony, hook rezerwuje przez
// POST /api/deposits/blik-booking (bez Stripe) i trzyma dane przelewu
// wyłącznie z odpowiedzi 201 serwera.

const SALON_ID = "salon-1";
const SERVICE_ID = "service-1";
const EMPLOYEE_ID = "employee-1";

// Numery wyłącznie z listy testowej (SMS na nie nigdy nie wychodzi).
const BLIK_PHONE = TEST_PHONE_NUMBERS[4]!;
const SALON_CONTACT_PHONE = TEST_PHONE_NUMBERS[3]!;
const GUEST_PHONE = TEST_PHONE;

const flags = vi.hoisted(() => ({ blik: true }));
vi.mock("@/lib/features", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/features")>()),
  isBlikDepositFlow: () => flags.blik,
}));

const sessionState = vi.hoisted(() => ({
  data: null as null | { user: { id: string; email: string } },
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: SALON_ID }) }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: sessionState.data }) }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const mutationFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ mutationFetch }));

const salonDetail = {
  id: SALON_ID,
  name: "Salon Testowy",
  services: [
    {
      id: SERVICE_ID,
      name: "Koloryzacja",
      basePrice: "100.00",
      baseDuration: 60,
      variants: [],
      depositRequired: true,
      depositPercentage: 30,
    },
  ],
};

global.fetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  let body: unknown = { success: true, data: [] };
  if (url.startsWith(`/api/salons/${SALON_ID}`)) body = { success: true, data: salonDetail };
  // Zalogowany klient bez własnych ustawień zadatku — liczy się usługa.
  if (url.startsWith("/api/clients/deposit-settings")) body = { success: false };
  return { ok: true, json: async () => body } as Response;
}) as unknown as typeof fetch;

const BLIK_DATA = {
  appointmentId: "apt-blik-1",
  startTime: "2026-12-01T09:00:00.000Z",
  endTime: "2026-12-01T10:00:00.000Z",
  depositAmount: 30,
  blik: { phone: BLIK_PHONE, recipient: "Salon Testowy", title: "Zadatek MH-APTBLI" },
  status: "scheduled",
  depositPaid: false,
};

const EXPECTED_INSTRUCTIONS = {
  appointmentId: BLIK_DATA.appointmentId,
  startTime: BLIK_DATA.startTime,
  endTime: BLIK_DATA.endTime,
  depositAmount: BLIK_DATA.depositAmount,
  phone: BLIK_PHONE,
  recipient: "Salon Testowy",
  title: "Zadatek MH-APTBLI",
};

const GENERIC_ERROR = "Nie udalo sie zarezerwowac wizyty z zadatkiem";

function response(status: number, json: unknown) {
  return { status, ok: status < 400, json: async () => json } as Response;
}

async function readyToBook() {
  const hook = renderHook(() => useBookingData());
  await waitFor(() => expect(hook.result.current.salon).not.toBeNull());
  act(() => hook.result.current.handleServiceSelect(SERVICE_ID));
  act(() => hook.result.current.handleEmployeeSelect(EMPLOYEE_ID));
  act(() => hook.result.current.handleDateChange("2026-12-01"));
  act(() => {
    hook.result.current.setSelectedTimeSlot("10:00");
    hook.result.current.setGuestName("Jan Kowalski");
    hook.result.current.setGuestPhone(GUEST_PHONE);
  });
  return hook;
}

async function book(result: { current: ReturnType<typeof useBookingData> }) {
  await act(async () => {
    await result.current.handleBookAppointment();
  });
}

function calledUrls(): string[] {
  return mutationFetch.mock.calls.map(([url]) => String(url));
}

function sentBody(callIndex = 0): Record<string, unknown> {
  return JSON.parse(String((mutationFetch.mock.calls[callIndex]![1] as RequestInit).body));
}

/** Krajowa część numeru (9 cyfr) — szukana w argumentach console.* po zdjęciu nie-cyfr. */
function nationalDigits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-9);
}

const consoleMethods = ["log", "info", "warn", "error"] as const;

const activeConsoleSpies: Array<{ mockRestore: () => void }> = [];

function spyConsole() {
  const spies = consoleMethods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  activeConsoleSpies.push(...spies);
  return spies;
}

function expectNoPhoneInConsole(spies: ReturnType<typeof spyConsole>) {
  const forbidden = [nationalDigits(BLIK_PHONE), nationalDigits(GUEST_PHONE)];
  for (const spy of spies) {
    for (const call of spy.mock.calls) {
      const digits = call
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg) ?? String(arg)))
        .join(" ")
        .replace(/\D/g, "");
      for (const number of forbidden) {
        expect(digits).not.toContain(number);
      }
    }
  }
}

function expectFormKeptAfterError(result: { current: ReturnType<typeof useBookingData> }) {
  expect(result.current.isProcessingPayment).toBe(false);
  expect(result.current.bookingSuccess).toBe(false);
  expect(result.current.blikInstructions).toBeNull();
  // Formularz zostaje na miejscu — bez pustego ekranu.
  expect(result.current.selectedServiceId).toBe(SERVICE_ID);
  expect(result.current.selectedTimeSlot).toBe("10:00");
}

describe("useBookingData — zadatek BLIK na telefon salonu", () => {
  beforeEach(() => {
    mutationFetch.mockReset();
    vi.clearAllMocks();
    flags.blik = true;
    sessionState.data = null;
  });

  afterEach(() => {
    // Tylko szpiedzy console — atrapy modułów i fetch zostają.
    activeConsoleSpies.splice(0).forEach((spy) => spy.mockRestore());
  });

  it("gość, 201 → tylko blik-booking, bez Stripe i przekierowania; instrukcje z odpowiedzi", async () => {
    const consoleSpies = spyConsole();
    mutationFetch.mockResolvedValueOnce(response(201, { success: true, data: BLIK_DATA }));
    const { result } = await readyToBook();
    const hrefBefore = window.location.href;

    await book(result);

    expect(calledUrls()).toEqual(["/api/deposits/blik-booking"]);
    expect(calledUrls()).not.toContain("/api/deposits/create-session");
    expect(calledUrls()).not.toContain("/api/deposits/confirm");
    expect(window.location.href).toBe(hrefBefore);
    expect(result.current.bookingSuccess).toBe(true);
    expect(result.current.isProcessingPayment).toBe(false);
    expect(result.current.blikInstructions).toEqual(EXPECTED_INSTRUCTIONS);
    expect(toast.success).toHaveBeenCalledWith("Wizyta zarezerwowana. Oplac zadatek BLIK-iem wedlug instrukcji.");
    expect(toast.error).not.toHaveBeenCalled();
    expectNoPhoneInConsole(consoleSpies);
  });

  it("kwota w instrukcjach pochodzi z serwera, nie z wyliczenia portalu", async () => {
    mutationFetch.mockResolvedValueOnce(
      response(201, { success: true, data: { ...BLIK_DATA, depositAmount: 31 } }),
    );
    const { result } = await readyToBook();

    await book(result);

    // Usługa 100 zł, 30% → portal liczy 30; serwer odsyła 31.
    expect(result.current.derived.depositAmount).toBe(30);
    expect(sentBody().depositAmount).toBe(30);
    expect(result.current.blikInstructions?.depositAmount).toBe(31);
  });

  it("body gościa: pola rezerwacji, kwota i dane gościa, bez paymentMethod", async () => {
    mutationFetch.mockResolvedValueOnce(response(201, { success: true, data: BLIK_DATA }));
    const { result } = await readyToBook();

    await book(result);

    const body = sentBody();
    expect(Object.keys(body).sort()).toEqual(
      [
        "salonId",
        "clientId",
        "employeeId",
        "serviceId",
        "variantId",
        "startTime",
        "endTime",
        "notes",
        "depositAmount",
        "guestName",
        "guestPhone",
        "guestEmail",
      ].sort(),
    );
    expect(body).not.toHaveProperty("paymentMethod");
    expect(body).toMatchObject({
      salonId: SALON_ID,
      clientId: null,
      employeeId: EMPLOYEE_ID,
      serviceId: SERVICE_ID,
      variantId: null,
      depositAmount: 30,
      guestName: "Jan Kowalski",
      guestPhone: GUEST_PHONE,
      guestEmail: null,
    });
    const init = mutationFetch.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("zalogowany klient: body bez pól gościa, 201 → instrukcje ustawione", async () => {
    sessionState.data = { user: { id: "user-1", email: "klient@example.com" } };
    mutationFetch.mockResolvedValueOnce(response(201, { success: true, data: BLIK_DATA }));
    const { result } = await readyToBook();

    await book(result);

    const body = sentBody();
    expect(body).not.toHaveProperty("guestName");
    expect(body).not.toHaveProperty("guestPhone");
    expect(body).not.toHaveProperty("guestEmail");
    expect(body).not.toHaveProperty("paymentMethod");
    expect(result.current.isLoggedIn).toBe(true);
    expect(result.current.blikInstructions).toEqual(EXPECTED_INSTRUCTIONS);
    expect(result.current.bookingSuccess).toBe(true);
  });

  it("przełącznik wyłączony → create-session, bez blik-booking", async () => {
    flags.blik = false;
    mutationFetch.mockResolvedValueOnce(response(400, { success: false, error: "Nieprawidlowa kwota zadatku" }));
    const { result } = await readyToBook();

    await book(result);

    expect(calledUrls()).toEqual(["/api/deposits/create-session"]);
    expect(calledUrls()).not.toContain("/api/deposits/blik-booking");
    expect(sentBody()).toHaveProperty("paymentMethod");
    expect(result.current.blikInstructions).toBeNull();
  });

  it("400 DEPOSIT_NOT_APPLICABLE → zwykła rezerwacja przez /api/appointments, sukces bez instrukcji", async () => {
    mutationFetch
      .mockResolvedValueOnce(
        response(400, {
          success: false,
          code: "DEPOSIT_NOT_APPLICABLE",
          error: "Zadatek nie jest wymagany dla tej rezerwacji",
        }),
      )
      .mockResolvedValueOnce(response(201, { success: true, data: { id: "apt-1" } }));
    const { result } = await readyToBook();

    await book(result);

    expect(calledUrls()).toEqual(["/api/deposits/blik-booking", "/api/appointments"]);
    expect(result.current.bookingSuccess).toBe(true);
    expect(result.current.blikInstructions).toBeNull();
    expect(result.current.isProcessingPayment).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("409 DEPOSIT_BLIK_NOT_CONFIGURED → komunikat serwera z telefonem salonu, bez fallbacku", async () => {
    const consoleSpies = spyConsole();
    const message = `Ten salon nie przyjmuje teraz rezerwacji online z zadatkiem. Zadzwoń: ${SALON_CONTACT_PHONE}`;
    mutationFetch.mockResolvedValueOnce(
      response(409, { success: false, code: "DEPOSIT_BLIK_NOT_CONFIGURED", error: message }),
    );
    const { result } = await readyToBook();

    await book(result);

    expect(calledUrls()).toEqual(["/api/deposits/blik-booking"]);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(message);
    expectFormKeptAfterError(result);
    expectNoPhoneInConsole(consoleSpies);
  });

  it("409 bez kodu → komunikat serwera (niedostępny pracownik)", async () => {
    mutationFetch.mockResolvedValueOnce(
      response(409, { success: false, error: "Pracownik nie jest dostepny w wybranym terminie." }),
    );
    const { result } = await readyToBook();

    await book(result);

    expect(calledUrls()).toEqual(["/api/deposits/blik-booking"]);
    expect(toast.error).toHaveBeenCalledWith("Pracownik nie jest dostepny w wybranym terminie.");
    expectFormKeptAfterError(result);
  });

  it("409 bez kodu i bez komunikatu → tekst o zajętym terminie", async () => {
    mutationFetch.mockResolvedValueOnce(response(409, { success: false }));
    const { result } = await readyToBook();

    await book(result);

    expect(toast.error).toHaveBeenCalledWith("Wybrany termin jest juz zajety. Wybierz inny termin.");
    expectFormKeptAfterError(result);
  });

  it.each([
    [400, { success: false, code: "VALIDATION_FAILED", error: "Kwota zadatku musi byc wieksza od 0" }],
    [404, { success: false, error: "Service not found" }],
    [429, { success: false, error: "Zbyt wiele żądań. Spróbuj ponownie później." }],
    [500, { success: false, error: "Nie udalo sie utworzyc rezerwacji" }],
    [503, { success: false, error: "Sprawdzenie zadatku jest chwilowo niedostepne" }],
  ])("%i → toast z komunikatem serwera, formularz zostaje", async (status, json) => {
    mutationFetch.mockResolvedValueOnce(response(status, json));
    const { result } = await readyToBook();

    await book(result);

    expect(calledUrls()).toEqual(["/api/deposits/blik-booking"]);
    expect(toast.error).toHaveBeenCalledWith(json.error);
    expectFormKeptAfterError(result);
  });

  it("błąd bez komunikatu serwera → tekst ogólny", async () => {
    mutationFetch.mockResolvedValueOnce(response(500, { success: false }));
    const { result } = await readyToBook();

    await book(result);

    expect(toast.error).toHaveBeenCalledWith(GENERIC_ERROR);
    expectFormKeptAfterError(result);
  });

  it("wyjątek sieci → 'Blad rezerwacji z zadatkiem', przetwarzanie zakończone", async () => {
    mutationFetch.mockRejectedValueOnce(new Error("network down"));
    const { result } = await readyToBook();

    await book(result);

    expect(toast.error).toHaveBeenCalledWith("Blad rezerwacji z zadatkiem");
    expectFormKeptAfterError(result);
  });

  it("odpowiedź nie-JSON → 'Blad rezerwacji z zadatkiem'", async () => {
    mutationFetch.mockResolvedValueOnce({
      status: 502,
      ok: false,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    } as unknown as Response);
    const { result } = await readyToBook();

    await book(result);

    expect(toast.error).toHaveBeenCalledWith("Blad rezerwacji z zadatkiem");
    expectFormKeptAfterError(result);
  });

  it("201 z niepełnymi danymi przelewu → sukces bez instrukcji i ostrzeżenie", async () => {
    const { title: _omitted, ...blikWithoutTitle } = BLIK_DATA.blik;
    void _omitted;
    mutationFetch.mockResolvedValueOnce(
      response(201, { success: true, data: { ...BLIK_DATA, blik: blikWithoutTitle } }),
    );
    const { result } = await readyToBook();

    await book(result);

    expect(result.current.bookingSuccess).toBe(true);
    expect(result.current.blikInstructions).toBeNull();
    expect(result.current.isProcessingPayment).toBe(false);
    expect(toast.warning).toHaveBeenCalledWith(
      "Wizyta zarezerwowana, ale nie udalo sie wyswietlic danych przelewu zadatku. Skontaktuj sie z salonem.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each([
    ["kwota zero", { ...BLIK_DATA, depositAmount: 0 }],
    ["kwota jako napis", { ...BLIK_DATA, depositAmount: "30" }],
    ["pusty numer", { ...BLIK_DATA, blik: { ...BLIK_DATA.blik, phone: "  " } }],
    ["brak danych", undefined],
  ])("201 z błędnym kształtem (%s) → instrukcje null", async (_label, data) => {
    mutationFetch.mockResolvedValueOnce(response(201, { success: true, data }));
    const { result } = await readyToBook();

    await book(result);

    expect(result.current.bookingSuccess).toBe(true);
    expect(result.current.blikInstructions).toBeNull();
    expect(toast.warning).toHaveBeenCalledTimes(1);
  });

  it("resetBooking() po sukcesie czyści instrukcje", async () => {
    mutationFetch.mockResolvedValueOnce(response(201, { success: true, data: BLIK_DATA }));
    const { result } = await readyToBook();
    await book(result);
    expect(result.current.blikInstructions).not.toBeNull();

    act(() => result.current.resetBooking());

    expect(result.current.blikInstructions).toBeNull();
    expect(result.current.bookingSuccess).toBe(false);
  });

  it("prawdziwy przełącznik isBlikDepositFlow() zwraca true i czyta rejestr (onlineDeposits)", async () => {
    const actual = await vi.importActual<typeof import("@/lib/features")>("@/lib/features");
    expect(actual.isBlikDepositFlow()).toBe(true);
    expect(actual.isBlikDepositFlow()).toBe(actual.isModuleFrozen("onlineDeposits"));
  });
});
