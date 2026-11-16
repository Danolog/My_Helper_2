import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// #193 P5a-1: biblioteka zapisuje przez forSalon(salonId).raw — brama deleguje
// do zmockowanego `db`, więc asercje na zapisie zostają bez zmian.
vi.mock("@/lib/server/repository", async () => {
  const { db } = await import("@/lib/db");
  return {
    forSalon: (salonId: string) => ({ salonId, raw: (fn: (tx: unknown) => unknown) => fn(db) }),
  };
});

// Use vi.hoisted for mock variables
const { mockDbReturning, mockDbValues, mockDbInsertInto } = vi.hoisted(() => {
  const mockDbReturning = vi.fn();
  const mockDbValues = vi.fn().mockReturnValue({ returning: mockDbReturning });
  const mockDbInsertInto = vi.fn().mockReturnValue({ values: mockDbValues });
  return { mockDbReturning, mockDbValues, mockDbInsertInto };
});

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    insert: (...args: unknown[]) => mockDbInsertInto(...args),
  },
}));

// Mock schema
vi.mock("@/lib/schema", () => ({
  notifications: "notifications_table",
}));

// Mock logger to keep test output clean
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logger } from "@/lib/logger";
import {
  sendSms,
  sendAppointmentReminderSms,
  sendBookingConfirmationSms,
  sendPaymentConfirmationSms,
  normalizePolishPhoneNumber,
  SMS_SEND_FAILED_ERROR,
  SMS_TEST_PHONE_ERROR,
} from "@/lib/sms";
import {
  TEST_PHONE,
  TEST_PHONE_NUMBERS,
  isTestPhoneNumber,
} from "@/lib/test-phone";

const mockFetch = vi.fn();

/** `error.message` z pierwszego wywołania logger.error (logger zmockowany — bez redakcji). */
function loggedErrorMessage(): string {
  const meta = vi.mocked(logger.error).mock.calls[0]?.[1] as { error?: unknown } | undefined;
  return meta?.error instanceof Error ? meta.error.message : "";
}

function resetDbMocks() {
  vi.clearAllMocks();
  mockDbInsertInto.mockReturnValue({ values: mockDbValues });
  mockDbValues.mockReturnValue({ returning: mockDbReturning });
  vi.stubGlobal("fetch", mockFetch);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("normalizePolishPhoneNumber", () => {
  it("prepends +48 to a 9-digit number", () => {
    expect(normalizePolishPhoneNumber("123456789")).toBe("+48123456789");
  });

  it("keeps an existing +48 number unchanged", () => {
    expect(normalizePolishPhoneNumber("+48123456789")).toBe("+48123456789");
  });

  it("ignores spaces and dashes", () => {
    expect(normalizePolishPhoneNumber("123 456 789")).toBe("+48123456789");
    expect(normalizePolishPhoneNumber("+48 123-456-789")).toBe("+48123456789");
  });

  it("rejects invalid formats", () => {
    expect(normalizePolishPhoneNumber("12345")).toBeNull();
    expect(normalizePolishPhoneNumber("1234567890")).toBeNull();
    expect(normalizePolishPhoneNumber("+49123456789")).toBeNull();
    expect(normalizePolishPhoneNumber("48123456789")).toBeNull();
    expect(normalizePolishPhoneNumber("abc123456")).toBeNull();
    expect(normalizePolishPhoneNumber("")).toBeNull();
  });
});

describe("sendSms (simulation mode - no SMSAPI_TOKEN)", () => {
  beforeEach(() => {
    resetDbMocks();
    vi.stubEnv("SMSAPI_TOKEN", "");
  });

  it("should return success when SMS is logged and saved to DB", async () => {
    mockDbReturning.mockResolvedValue([{ id: "notif-1" }]);

    const result = await sendSms({
      to: "+48123456789",
      message: "Test message",
      salonId: "salon-1",
    });

    expect(result.success).toBe(true);
    expect(result.notificationId).toBe("notif-1");
    expect(result.error).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDbValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent" })
    );
  });

  it("should include clientId in the notification when provided", async () => {
    mockDbReturning.mockResolvedValue([{ id: "notif-2" }]);

    await sendSms({
      to: "+48123456789",
      message: "Test",
      salonId: "salon-1",
      clientId: "client-1",
    });

    expect(mockDbValues).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-1",
      })
    );
  });

  it("should use null for clientId when not provided", async () => {
    mockDbReturning.mockResolvedValue([{ id: "notif-3" }]);

    await sendSms({
      to: "+48123456789",
      message: "Test",
      salonId: "salon-1",
    });

    expect(mockDbValues).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: null,
      })
    );
  });

  it("should return failure when database throws", async () => {
    mockDbReturning.mockRejectedValue(new Error("DB error"));

    const result = await sendSms({
      to: "+48123456789",
      message: "Test",
      salonId: "salon-1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(SMS_SEND_FAILED_ERROR);
    expect(result.error).not.toContain("DB error");
  });

  it("should handle notification with undefined id gracefully", async () => {
    mockDbReturning.mockResolvedValue([undefined]);

    const result = await sendSms({
      to: "+48123456789",
      message: "Test",
      salonId: "salon-1",
    });

    expect(result.success).toBe(true);
    expect(result.notificationId).toBeUndefined();
  });
});

describe("sendSms (real delivery via SMSAPI)", () => {
  beforeEach(() => {
    resetDbMocks();
    vi.stubEnv("SMSAPI_TOKEN", "test-token");
    mockDbReturning.mockResolvedValue([{ id: "notif-real" }]);
  });

  it("should POST to SMSAPI with correct URL, headers and body on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ count: 1, list: [{ id: "msg-1" }] }),
    });

    const result = await sendSms({
      to: "+48123456789",
      message: "Hello",
      salonId: "salon-1",
    });

    expect(result.success).toBe(true);
    expect(result.notificationId).toBe("notif-real");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.smsapi.pl/sms.do");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bearer test-token",
        "Content-Type": "application/x-www-form-urlencoded",
      })
    );

    const params = new URLSearchParams(init.body as string);
    expect(params.get("format")).toBe("json");
    expect(params.get("to")).toBe("+48123456789");
    expect(params.get("message")).toBe("Hello");
    expect(params.get("from")).toBe("Info");
    expect(params.get("encoding")).toBe("utf-8");

    expect(mockDbValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent" })
    );
  });

  it("should use SMSAPI_SENDER as sender name when configured", async () => {
    vi.stubEnv("SMSAPI_SENDER", "MojSalon");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ count: 1, list: [{ id: "msg-2" }] }),
    });

    await sendSms({
      to: "+48123456789",
      message: "Hello",
      salonId: "salon-1",
    });

    const params = new URLSearchParams(mockFetch.mock.calls[0]![1].body as string);
    expect(params.get("from")).toBe("MojSalon");
  });

  it("should normalize a 9-digit number to +48 before sending", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ count: 1, list: [{ id: "msg-3" }] }),
    });

    const result = await sendSms({
      to: "123456789",
      message: "Hello",
      salonId: "salon-1",
    });

    expect(result.success).toBe(true);
    const params = new URLSearchParams(mockFetch.mock.calls[0]![1].body as string);
    expect(params.get("to")).toBe("+48123456789");
  });

  it("should fail and save 'failed' status when SMSAPI returns an error payload", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: 101, message: "Authorization failed" }),
    });

    const result = await sendSms({
      to: "+48123456789",
      message: "Hello",
      salonId: "salon-1",
    });

    expect(result.success).toBe(false);
    // Ryan: szczegół dostawcy tylko w logu, wołający dostaje ogólny komunikat
    expect(result.error).toBe(SMS_SEND_FAILED_ERROR);
    expect(result.error).not.toContain("Authorization failed");
    // #75: do logu tylko kod błędu — `message` dostawcy bywa echem danych wejściowych
    expect(loggedErrorMessage()).toBe("SMSAPI error: code 101");
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain("Authorization failed");
    expect(result.notificationId).toBeUndefined();
    expect(mockDbValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    );
  });

  it("nienumeryczny `error` od dostawcy nie trafia do logu (#75)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ error: "Invalid number 48111222333", message: "x" }),
    });

    const result = await sendSms({ to: "+48123456789", message: "Hello", salonId: "salon-1" });

    expect(result.error).toBe(SMS_SEND_FAILED_ERROR);
    expect(loggedErrorMessage()).toBe("SMSAPI error: code unknown");
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain("48111222333");
  });

  it("should fail on non-OK HTTP response without JSON error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    });

    const result = await sendSms({
      to: "+48123456789",
      message: "Hello",
      salonId: "salon-1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(SMS_SEND_FAILED_ERROR);
    expect(loggedErrorMessage()).toContain("HTTP 500");
    expect(mockDbValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    );
  });

  it("should fail and save 'failed' status on network error", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));

    const result = await sendSms({
      to: "+48123456789",
      message: "Hello",
      salonId: "salon-1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(SMS_SEND_FAILED_ERROR);
    expect(mockDbValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    );
  });

  it("N2: błąd nieprawidłowego numeru zawiera numer zamaskowany, nie pełny", async () => {
    const { logger } = await import("@/lib/logger");
    const result = await sendSms({ to: "+49 151 234 5678", message: "Hello", salonId: "salon-1" });

    expect(result.error).toContain("***678");
    expect(result.error).not.toContain("151");
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain("151 234");
  });

  it("should reject an invalid phone number before calling SMSAPI", async () => {
    const result = await sendSms({
      to: "12345",
      message: "Hello",
      salonId: "salon-1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid phone number");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDbValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    );
  });
});

describe("sendSms: logi bez pełnego numeru i bez treści (Ryan)", () => {
  const PHONE = "+48 512 345 678";
  const CONTENT = "Anna Nowak, koloryzacja u Ewy jutro o 10:00";

  function allLogCalls(): string {
    return JSON.stringify([
      vi.mocked(logger.debug).mock.calls,
      vi.mocked(logger.info).mock.calls,
      vi.mocked(logger.warn).mock.calls,
      vi.mocked(logger.error).mock.calls,
    ]);
  }

  function expectNoPii(log: string) {
    expect(log).not.toContain("512345678");
    expect(log).not.toContain("512 345 678");
    expect(log).not.toContain("Anna Nowak");
    expect(log).not.toContain("koloryzacja");
  }

  beforeEach(() => {
    resetDbMocks();
    mockDbReturning.mockResolvedValue([{ id: "notif-log" }]);
  });

  it("tryb symulacji: numer zamaskowany, bez treści", async () => {
    vi.stubEnv("SMSAPI_TOKEN", "");
    const result = await sendSms({ to: PHONE, message: CONTENT, salonId: "salon-1" });

    expect(result.success).toBe(true);
    const log = allLogCalls();
    expectNoPii(log);
    expect(log).toContain("***678");
  });

  it("wysyłka przez SMSAPI: log sukcesu z zamaskowanym numerem", async () => {
    vi.stubEnv("SMSAPI_TOKEN", "test-token");
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ count: 1, list: [{ id: "msg-log" }] }),
    });
    const result = await sendSms({ to: PHONE, message: CONTENT, salonId: "salon-1" });

    expect(result.success).toBe(true);
    expectNoPii(allLogCalls());
  });

  it("catch: log z zamaskowanym numerem, wynik z ogólnym komunikatem", async () => {
    vi.stubEnv("SMSAPI_TOKEN", "test-token");
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));
    const result = await sendSms({ to: PHONE, message: CONTENT, salonId: "salon-1" });

    expect(result).toEqual({ success: false, error: SMS_SEND_FAILED_ERROR });
    const log = allLogCalls();
    expectNoPii(log);
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).toContain("***678");
  });

  it("catch błędu bazy: parametry zapytania nie wracają do wołającego", async () => {
    vi.stubEnv("SMSAPI_TOKEN", "");
    mockDbReturning.mockRejectedValue(
      new Error(`Failed query: insert into notifications\nparams: salon-1,${CONTENT}`)
    );
    const result = await sendSms({ to: PHONE, message: CONTENT, salonId: "salon-1" });

    expect(result).toEqual({ success: false, error: SMS_SEND_FAILED_ERROR });
  });
});

describe("TEST_PHONE: numery testowe", () => {
  it("TEST_PHONE jest na liście i jest rozpoznawany w każdym formacie", () => {
    expect(TEST_PHONE_NUMBERS).toContain("+48000600700");
    expect(isTestPhoneNumber(TEST_PHONE)).toBe(true);
    expect(isTestPhoneNumber("000600700")).toBe(true);
    expect(isTestPhoneNumber("+48-000-600-700")).toBe(true);
  });

  it("numery spoza listy i puste wejście nie są testowe", () => {
    expect(isTestPhoneNumber("+48 500 600 700")).toBe(false);
    expect(isTestPhoneNumber("+48 000 600 799")).toBe(false);
    expect(isTestPhoneNumber("")).toBe(false);
    expect(isTestPhoneNumber(null)).toBe(false);
    expect(isTestPhoneNumber(undefined)).toBe(false);
  });

  it("lista jest zamrożona (nie da się dopisać numeru w runtime)", () => {
    expect(Object.isFrozen(TEST_PHONE_NUMBERS)).toBe(true);
  });
});

describe("sendSms: blokada numerów testowych", () => {
  beforeEach(() => {
    resetDbMocks();
    vi.stubEnv("SMSAPI_TOKEN", "test-token");
    mockDbReturning.mockResolvedValue([{ id: "notif-test" }]);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ count: 1, list: [{ id: "msg-test" }] }),
    });
  });

  it.each(TEST_PHONE_NUMBERS.map((n) => [n]))(
    "%s: z tokenem SMS nie idzie do dostawcy ani do notifications",
    async (phone) => {
      const result = await sendSms({ to: phone, message: "Hello", salonId: "salon-1" });

      expect(result).toEqual({ success: false, error: SMS_TEST_PHONE_ERROR, skipped: "test_phone" });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockDbInsertInto).not.toHaveBeenCalled();
    }
  );

  it("blokuje numer testowy w formacie krajowym i z odstępami", async () => {
    for (const to of ["000 600 701", "+48 000-600-702"]) {
      const result = await sendSms({ to, message: "Hello", salonId: "salon-1" });
      expect(result.error).toBe(SMS_TEST_PHONE_ERROR);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blokuje też w trybie symulacji (bez tokenu) i loguje numer zamaskowany", async () => {
    vi.stubEnv("SMSAPI_TOKEN", "");
    const result = await sendSms({ to: TEST_PHONE, message: "Hello", salonId: "salon-1" });

    expect(result.error).toBe(SMS_TEST_PHONE_ERROR);
    expect(mockDbInsertInto).not.toHaveBeenCalled();
    const log = JSON.stringify(vi.mocked(logger.info).mock.calls);
    expect(log).toContain("***700");
    expect(log).not.toContain("000600700");
  });

  it("numer spoza listy nadal wychodzi przez dostawcę", async () => {
    const result = await sendSms({ to: "+48 000 600 799", message: "Hello", salonId: "salon-1" });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("sendAppointmentReminderSms", () => {
  beforeEach(() => {
    resetDbMocks();
    vi.stubEnv("SMSAPI_TOKEN", "");
    mockDbReturning.mockResolvedValue([{ id: "notif-reminder" }]);
  });

  it("should send an appointment reminder SMS with correct format", async () => {
    const result = await sendAppointmentReminderSms({
      clientPhone: "+48123456789",
      clientName: "Jan Kowalski",
      serviceName: "Strzyzenie",
      employeeName: "Anna",
      appointmentDate: new Date("2024-01-15T14:00:00"),
      salonName: "Salon Uroda",
      salonId: "salon-1",
      clientId: "client-1",
    });

    expect(result.success).toBe(true);
    const insertedValues = mockDbValues.mock.calls[0]![0];
    expect(insertedValues.message).toContain("Jan Kowalski");
    expect(insertedValues.message).toContain("Strzyzenie");
    expect(insertedValues.message).toContain("Anna");
    expect(insertedValues.message).toContain("Salon Uroda");
    expect(insertedValues.message).toContain("Przypomnienie");
  });

  it("does not include a booking link in the message", async () => {
    await sendAppointmentReminderSms({
      clientPhone: "+48123456789",
      clientName: "Jan",
      serviceName: "Haircut",
      employeeName: "Anna",
      appointmentDate: new Date("2024-01-15T14:00:00"),
      salonName: "Salon",
      salonId: "salon-1",
    });

    const insertedValues = mockDbValues.mock.calls[0]![0];
    expect(insertedValues.message).not.toContain("/book");
    expect(insertedValues.message).not.toMatch(/https?:\/\//);
  });
});

describe("sendBookingConfirmationSms", () => {
  beforeEach(() => {
    resetDbMocks();
    vi.stubEnv("SMSAPI_TOKEN", "");
    mockDbReturning.mockResolvedValue([{ id: "notif-booking" }]);
  });

  it("should send a booking confirmation SMS with correct format", async () => {
    const result = await sendBookingConfirmationSms({
      clientPhone: "+48123456789",
      clientName: "Jan",
      serviceName: "Strzyzenie",
      employeeName: "Anna Nowak",
      appointmentDate: new Date("2024-01-15T14:00:00"),
      salonName: "Salon Uroda",
      salonId: "salon-1",
      clientId: "client-1",
    });

    expect(result.success).toBe(true);
    const insertedValues = mockDbValues.mock.calls[0]![0];
    expect(insertedValues.message).toContain("Potwierdzenie rezerwacji");
    expect(insertedValues.message).toContain("Jan");
    expect(insertedValues.message).toContain("Strzyzenie");
    expect(insertedValues.message).toContain("Anna Nowak");
    expect(insertedValues.message).toContain("Salon Uroda");
    expect(insertedValues.clientId).toBe("client-1");
  });

  it("should fail for an invalid phone number", async () => {
    const result = await sendBookingConfirmationSms({
      clientPhone: "123",
      clientName: "Jan",
      serviceName: "Strzyzenie",
      employeeName: "Anna",
      appointmentDate: new Date("2024-01-15T14:00:00"),
      salonName: "Salon",
      salonId: "salon-1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid phone number");
  });
});

describe("sendPaymentConfirmationSms", () => {
  beforeEach(() => {
    resetDbMocks();
    vi.stubEnv("SMSAPI_TOKEN", "");
    mockDbReturning.mockResolvedValue([{ id: "notif-payment" }]);
  });

  it("should send a payment confirmation SMS", async () => {
    const result = await sendPaymentConfirmationSms({
      clientPhone: "+48123456789",
      clientName: "Jan Kowalski",
      amount: 50.0,
      currency: "PLN",
      serviceName: "Strzyzenie",
      appointmentDate: new Date("2024-01-15T14:00:00"),
      employeeName: "Anna",
      salonName: "Salon Uroda",
      salonId: "salon-1",
      clientId: "client-1",
    });

    expect(result.success).toBe(true);
    const insertedValues = mockDbValues.mock.calls[0]![0];
    expect(insertedValues.message).toContain("50.00");
    expect(insertedValues.message).toContain("PLN");
    expect(insertedValues.message).toContain("Jan Kowalski");
    expect(insertedValues.message).toContain("Potwierdzenie platnosci");
  });

  const paymentParams = {
    clientPhone: "+48123456789",
    clientName: "Jan Kowalski",
    amount: 50.0,
    currency: "PLN",
    serviceName: "Strzyzenie",
    appointmentDate: new Date("2024-01-15T14:00:00"),
    employeeName: "Anna Nowak",
    salonId: "salon-1",
    clientId: "client-1",
  };

  it("treść zawiera nazwę salonu", async () => {
    const result = await sendPaymentConfirmationSms({ ...paymentParams, salonName: "Salon Uroda" });

    expect(result.success).toBe(true);
    const message = mockDbValues.mock.calls[0]![0].message as string;
    expect(message).toContain('za usluge "Strzyzenie" u Anna Nowak w Salon Uroda dnia ');
  });

  it.each([
    ["null", null],
    ["pusty napis", ""],
    ["same spacje", "   "],
  ])("brak nazwy salonu (%s) → treść bez fragmentu o salonie, bez „undefined”/„null”", async (_label, salonName) => {
    const result = await sendPaymentConfirmationSms({ ...paymentParams, salonName });

    expect(result.success).toBe(true);
    const message = mockDbValues.mock.calls[0]![0].message as string;
    expect(message).toContain('za usluge "Strzyzenie" u Anna Nowak dnia ');
    expect(message).not.toMatch(/undefined|null/);
    expect(message).not.toMatch(/ w {1,}dnia/);
  });

  it("nazwa salonu jest przycinana ze spacji na brzegach", async () => {
    await sendPaymentConfirmationSms({ ...paymentParams, salonName: "  Salon Uroda  " });

    const message = mockDbValues.mock.calls[0]![0].message as string;
    expect(message).toContain("u Anna Nowak w Salon Uroda dnia ");
  });
});
