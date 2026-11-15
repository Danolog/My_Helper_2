import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import {
  sendSms,
  sendAppointmentReminderSms,
  sendBookingConfirmationSms,
  sendPaymentConfirmationSms,
  normalizePolishPhoneNumber,
} from "@/lib/sms";

const mockFetch = vi.fn();

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
    expect(result.error).toBe("DB error");
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
    expect(result.error).toContain("SMSAPI error");
    expect(result.error).toContain("Authorization failed");
    expect(result.notificationId).toBeUndefined();
    expect(mockDbValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    );
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
    expect(result.error).toContain("HTTP 500");
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
    expect(result.error).toBe("fetch failed");
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

  it("should include booking link in the message", async () => {
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
    expect(insertedValues.message).toContain("/salons/salon-1/book");
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
});
