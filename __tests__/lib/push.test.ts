import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock variables
const {
  mockWebpushSendNotification,
  mockDbReturning,
  mockDbValues,
  mockDbInsertInto,
  mockDbDelete,
  mockDbSelectWhere,
  mockDbSelectFrom,
  mockDbSelect,
} = vi.hoisted(() => {
  const mockWebpushSendNotification = vi.fn();
  const mockDbReturning = vi.fn();
  const mockDbValues = vi.fn().mockReturnValue({ returning: mockDbReturning });
  const mockDbInsertInto = vi.fn().mockReturnValue({ values: mockDbValues });
  const _mockDbDeleteWhere = vi.fn().mockResolvedValue(undefined);
  const mockDbDelete = vi.fn().mockReturnValue({ where: _mockDbDeleteWhere });
  const mockDbSelectWhere = vi.fn();
  const mockDbSelectFrom = vi.fn().mockReturnValue({ where: mockDbSelectWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockDbSelectFrom });
  return {
    mockWebpushSendNotification,
    mockDbReturning,
    mockDbValues,
    mockDbInsertInto,
    _mockDbDeleteWhere,
    mockDbDelete,
    mockDbSelectWhere,
    mockDbSelectFrom,
    mockDbSelect,
  };
});

// Mock web-push module
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => mockWebpushSendNotification(...args),
  },
}));

// Mock database
vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsertInto(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
  },
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
}));

// Mock schema
vi.mock("@/lib/schema", () => ({
  notifications: "notifications_table",
  pushSubscriptions: {
    userId: "pushSubscriptions.userId",
    id: "pushSubscriptions.id",
  },
}));

// Push jest zamrożony w rejestrze modułów (hardOff w src/lib/features.ts).
// Kod wysyłki zostaje w repo i czeka na odmrożenie — jego testy też zostają:
// `pushThaw.on = true` symuluje moduł odmrożony. Test blokady niżej używa
// prawdziwego rejestru.
const pushThaw = vi.hoisted(() => ({ on: false }));

vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return {
    ...actual,
    isModuleFrozen: (key: Parameters<typeof actual.isModuleFrozen>[0]) =>
      key === "pushNotifications" && pushThaw.on ? false : actual.isModuleFrozen(key),
  };
});

import {
  sendPushNotification,
  sendAppointmentReminderPush,
  sendAppointmentReminder24hPush,
} from "@/lib/push";

describe("sendPushNotification (push.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushThaw.on = true;
    mockDbSelect.mockReturnValue({ from: mockDbSelectFrom });
    mockDbSelectFrom.mockReturnValue({ where: mockDbSelectWhere });
    mockDbInsertInto.mockReturnValue({ values: mockDbValues });
    mockDbValues.mockReturnValue({ returning: mockDbReturning });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("should return failure when no subscriptions found", async () => {
    mockDbSelectWhere.mockResolvedValue([]);

    const result = await sendPushNotification("user-1", {
      title: "Test",
      body: "Test body",
      salonId: "salon-1",
    });

    expect(result.success).toBe(false);
    expect(result.sent).toBe(0);
    expect(result.error).toContain("No subscriptions");
  });

  it("should send to all subscriptions and count successes", async () => {
    mockDbSelectWhere.mockResolvedValue([
      { id: "sub-1", endpoint: "https://push1.example.com", p256dh: "key1", auth: "auth1" },
      { id: "sub-2", endpoint: "https://push2.example.com", p256dh: "key2", auth: "auth2" },
    ]);
    mockWebpushSendNotification.mockResolvedValue({});
    mockDbReturning.mockResolvedValue([{ id: "notif-1" }]);

    const result = await sendPushNotification("user-1", {
      title: "Test",
      body: "Body",
      salonId: "salon-1",
    });

    expect(result.success).toBe(true);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.notificationId).toBe("notif-1");
  });

  it("should handle mixed success and failure", async () => {
    mockDbSelectWhere.mockResolvedValue([
      { id: "sub-1", endpoint: "https://push1.example.com", p256dh: "key1", auth: "auth1" },
      { id: "sub-2", endpoint: "https://push2.example.com", p256dh: "key2", auth: "auth2" },
    ]);
    mockWebpushSendNotification
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ statusCode: 500 });
    mockDbReturning.mockResolvedValue([{ id: "notif-1" }]);

    const result = await sendPushNotification("user-1", {
      title: "Test",
      body: "Body",
      salonId: "salon-1",
    });

    expect(result.success).toBe(true);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("should remove expired subscriptions (410)", async () => {
    mockDbSelectWhere.mockResolvedValue([
      { id: "sub-1", endpoint: "https://push1.example.com", p256dh: "key1", auth: "auth1" },
    ]);
    mockWebpushSendNotification.mockRejectedValue({ statusCode: 410 });
    mockDbReturning.mockResolvedValue([{ id: "notif-1" }]);

    await sendPushNotification("user-1", {
      title: "Test",
      body: "Body",
      salonId: "salon-1",
    });

    expect(mockDbDelete).toHaveBeenCalled();
  });

  it("should handle top-level exception gracefully", async () => {
    mockDbSelectWhere.mockRejectedValue(new Error("DB failure"));
    // Mock the fallback insert too
    mockDbInsertInto.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await sendPushNotification("user-1", {
      title: "Test",
      body: "Body",
      salonId: "salon-1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("DB failure");
  });
});

describe("sendAppointmentReminderPush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushThaw.on = true;
    mockDbSelect.mockReturnValue({ from: mockDbSelectFrom });
    mockDbSelectFrom.mockReturnValue({ where: mockDbSelectWhere });
    mockDbSelectWhere.mockResolvedValue([]);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("should call sendPushNotification and return result", async () => {
    const result = await sendAppointmentReminderPush({
      userId: "user-1",
      clientName: "Jan",
      serviceName: "Strzyzenie",
      employeeName: "Anna",
      appointmentDate: new Date("2024-01-15T14:00:00"),
      salonName: "Salon Uroda",
      salonId: "salon-1",
      clientId: "client-1",
      appointmentId: "appt-1",
    });

    expect(result).toBeDefined();
    // No subscriptions so it returns failure
    expect(result.success).toBe(false);
  });
});

describe("sendAppointmentReminder24hPush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushThaw.on = true;
    mockDbSelect.mockReturnValue({ from: mockDbSelectFrom });
    mockDbSelectFrom.mockReturnValue({ where: mockDbSelectWhere });
    mockDbSelectWhere.mockResolvedValue([]);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("should call sendPushNotification and return result", async () => {
    const result = await sendAppointmentReminder24hPush({
      userId: "user-1",
      clientName: "Jan",
      serviceName: "Strzyzenie",
      employeeName: "Anna",
      appointmentDate: new Date("2024-01-16T14:00:00"),
      salonName: "Salon Uroda",
      salonId: "salon-1",
      clientId: "client-1",
      appointmentId: "appt-1",
    });

    expect(result).toBeDefined();
    expect(result.success).toBe(false);
  });
});

describe("push zamrożony (prawdziwy rejestr)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushThaw.on = false;
    mockDbSelect.mockReturnValue({ from: mockDbSelectFrom });
    mockDbSelectFrom.mockReturnValue({ where: mockDbSelectWhere });
    // Użytkownik MA subskrypcję — gdyby blokada nie zadziałała, push by wyszedł.
    mockDbSelectWhere.mockResolvedValue([
      { id: "sub-1", userId: "user-1", endpoint: "https://push.example/1", p256dh: "k", auth: "a" },
    ]);
    mockWebpushSendNotification.mockResolvedValue({});
  });

  it("sendPushNotification nic nie wysyła, nie czyta subskrypcji i nie zapisuje powiadomienia", async () => {
    const result = await sendPushNotification("user-1", {
      title: "Zwolnil sie termin!",
      body: "Test",
      salonId: "salon-1",
    });

    expect(result).toEqual({
      success: false,
      sent: 0,
      failed: 0,
      error: "Push notifications are disabled",
    });
    expect(mockWebpushSendNotification).not.toHaveBeenCalled();
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockDbInsertInto).not.toHaveBeenCalled();
  });

  it("przypomnienia push 1 h i 24 h też nic nie wysyłają", async () => {
    const params = {
      userId: "user-1",
      clientName: "Anna",
      serviceName: "Strzyzenie",
      employeeName: "Ewa",
      salonName: "Salon",
      appointmentDate: new Date("2026-11-20T10:00:00Z"),
      salonId: "salon-1",
      clientId: "client-1",
      appointmentId: "appt-1",
    };

    expect((await sendAppointmentReminderPush(params)).success).toBe(false);
    expect((await sendAppointmentReminder24hPush(params)).success).toBe(false);
    expect(mockWebpushSendNotification).not.toHaveBeenCalled();
  });

  it("wynik ma ten sam kształt co „brak subskrypcji” — wywołujący (lista oczekujących) działa dalej", async () => {
    const frozen = await sendPushNotification("user-1", { title: "T", body: "B", salonId: "s" });

    pushThaw.on = true;
    mockDbSelectWhere.mockResolvedValue([]);
    const noSubscriptions = await sendPushNotification("user-1", { title: "T", body: "B", salonId: "s" });

    expect(Object.keys(frozen).sort()).toEqual(Object.keys(noSubscriptions).sort());
    expect(frozen.success).toBe(noSubscriptions.success);
    expect(frozen.sent).toBe(0);
  });
});
