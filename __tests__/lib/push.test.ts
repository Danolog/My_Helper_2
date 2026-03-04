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

import {
  sendPushNotification,
  sendAppointmentReminderPush,
  sendAppointmentReminder24hPush,
} from "@/lib/push";

describe("sendPushNotification (push.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
