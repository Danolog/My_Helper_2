import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock variables
const { mockDbLimit, mockDbWhere, mockDbFrom, mockDbSelect } = vi.hoisted(() => {
  const mockDbLimit = vi.fn();
  const mockDbWhere = vi.fn().mockReturnValue({ limit: mockDbLimit });
  const mockDbFrom = vi.fn().mockReturnValue({ where: mockDbWhere });
  const mockDbSelect = vi.fn().mockReturnValue({ from: mockDbFrom });
  return { mockDbLimit, mockDbWhere, mockDbFrom, mockDbSelect };
});

// Mock the database module
vi.mock("@/lib/db", () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

// Mock drizzle-orm functions
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
}));

// Mock schema to provide salons table reference
vi.mock("@/lib/schema", () => ({
  salons: {
    id: "salons.id",
    settingsJson: "salons.settingsJson",
  },
}));

import {
  DEFAULT_NOTIFICATION_TYPE_SETTINGS,
  getNotificationTypeSettings,
} from "@/lib/notification-settings";

describe("DEFAULT_NOTIFICATION_TYPE_SETTINGS", () => {
  it("should have all notification types enabled by default", () => {
    expect(DEFAULT_NOTIFICATION_TYPE_SETTINGS.smsReminders).toBe(true);
    expect(DEFAULT_NOTIFICATION_TYPE_SETTINGS.pushReminders).toBe(true);
    expect(DEFAULT_NOTIFICATION_TYPE_SETTINGS.birthdayNotifications).toBe(true);
    expect(DEFAULT_NOTIFICATION_TYPE_SETTINGS.weMissYouNotifications).toBe(true);
    expect(DEFAULT_NOTIFICATION_TYPE_SETTINGS.paymentConfirmations).toBe(true);
  });
});

describe("getNotificationTypeSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelect.mockReturnValue({ from: mockDbFrom });
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockReturnValue({ limit: mockDbLimit });
  });

  it("should return defaults when salon has no custom settings", async () => {
    mockDbLimit.mockResolvedValue([{ settingsJson: null }]);

    const settings = await getNotificationTypeSettings("salon-123");
    expect(settings).toEqual(DEFAULT_NOTIFICATION_TYPE_SETTINGS);
  });

  it("should return defaults when salon is not found", async () => {
    mockDbLimit.mockResolvedValue([]);

    const settings = await getNotificationTypeSettings("nonexistent-salon");
    expect(settings).toEqual(DEFAULT_NOTIFICATION_TYPE_SETTINGS);
  });

  it("should merge custom settings with defaults", async () => {
    mockDbLimit.mockResolvedValue([
      {
        settingsJson: {
          notificationTypes: {
            smsReminders: false,
            birthdayNotifications: false,
          },
        },
      },
    ]);

    const settings = await getNotificationTypeSettings("salon-123");
    expect(settings.smsReminders).toBe(false);
    expect(settings.birthdayNotifications).toBe(false);
    expect(settings.pushReminders).toBe(true);
    expect(settings.weMissYouNotifications).toBe(true);
    expect(settings.paymentConfirmations).toBe(true);
  });

  it("should return defaults on database error", async () => {
    mockDbLimit.mockRejectedValue(new Error("DB connection failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const settings = await getNotificationTypeSettings("salon-123");
    expect(settings).toEqual(DEFAULT_NOTIFICATION_TYPE_SETTINGS);
  });

  it("should handle settingsJson without notificationTypes key", async () => {
    mockDbLimit.mockResolvedValue([
      {
        settingsJson: {
          someOtherSetting: "value",
        },
      },
    ]);

    const settings = await getNotificationTypeSettings("salon-123");
    expect(settings).toEqual(DEFAULT_NOTIFICATION_TYPE_SETTINGS);
  });
});
