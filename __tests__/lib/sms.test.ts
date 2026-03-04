import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { sendSms, sendAppointmentReminderSms, sendPaymentConfirmationSms } from "@/lib/sms";

describe("sendSms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsertInto.mockReturnValue({ values: mockDbValues });
    mockDbValues.mockReturnValue({ returning: mockDbReturning });
    vi.spyOn(console, "log").mockImplementation(() => {});
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
    vi.spyOn(console, "error").mockImplementation(() => {});

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

describe("sendAppointmentReminderSms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsertInto.mockReturnValue({ values: mockDbValues });
    mockDbValues.mockReturnValue({ returning: mockDbReturning });
    mockDbReturning.mockResolvedValue([{ id: "notif-reminder" }]);
    vi.spyOn(console, "log").mockImplementation(() => {});
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

describe("sendPaymentConfirmationSms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsertInto.mockReturnValue({ values: mockDbValues });
    mockDbValues.mockReturnValue({ returning: mockDbReturning });
    mockDbReturning.mockResolvedValue([{ id: "notif-payment" }]);
    vi.spyOn(console, "log").mockImplementation(() => {});
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
