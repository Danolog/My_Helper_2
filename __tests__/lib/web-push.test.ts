import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PUSH_SEND_TIMEOUT_MS } from "@/lib/push-subscription";
import { validSubscription } from "../fixtures/push-subscriptions";

const VALID_SUB = validSubscription();

// Mock web-push before importing the module
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

describe("web-push module", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("isPushConfigured", () => {
    it("should return false when VAPID keys are not set", async () => {
      delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      const { isPushConfigured } = await import("@/lib/web-push");
      expect(isPushConfigured()).toBe(false);
    });

    it("should return false when only public key is set", async () => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public-key";
      delete process.env.VAPID_PRIVATE_KEY;
      const { isPushConfigured } = await import("@/lib/web-push");
      expect(isPushConfigured()).toBe(false);
    });

    it("should return false when only private key is set", async () => {
      delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      process.env.VAPID_PRIVATE_KEY = "private-key";
      const { isPushConfigured } = await import("@/lib/web-push");
      expect(isPushConfigured()).toBe(false);
    });

    it("should return true when both VAPID keys are set", async () => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public-key";
      process.env.VAPID_PRIVATE_KEY = "private-key";
      const { isPushConfigured } = await import("@/lib/web-push");
      expect(isPushConfigured()).toBe(true);
    });
  });

  describe("sendPushNotification", () => {
    it("should return failure when VAPID keys are not configured", async () => {
      delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { sendPushNotification } = await import("@/lib/web-push");

      const result = await sendPushNotification(
        VALID_SUB,
        { title: "Test", body: "Test body" }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("VAPID");
    });

    it("should send notification when configured", async () => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public-key";
      process.env.VAPID_PRIVATE_KEY = "private-key";
      vi.spyOn(console, "log").mockImplementation(() => {});

      const webpush = (await import("web-push")).default;
      (webpush.sendNotification as ReturnType<typeof vi.fn>).mockResolvedValue({
        statusCode: 201,
      });

      const { sendPushNotification } = await import("@/lib/web-push");

      const result = await sendPushNotification(
        VALID_SUB,
        { title: "Test", body: "Test body" }
      );

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(201);
    });

    it("should handle expired subscription (410 status)", async () => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public-key";
      process.env.VAPID_PRIVATE_KEY = "private-key";
      vi.spyOn(console, "error").mockImplementation(() => {});

      const webpush = (await import("web-push")).default;
      (webpush.sendNotification as ReturnType<typeof vi.fn>).mockRejectedValue({
        statusCode: 410,
        message: "Gone",
      });

      const { sendPushNotification } = await import("@/lib/web-push");

      const result = await sendPushNotification(
        VALID_SUB,
        { title: "Test", body: "Test body" }
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(410);
      expect(result.error).toContain("expired");
    });

    it("should handle 404 subscription errors", async () => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public-key";
      process.env.VAPID_PRIVATE_KEY = "private-key";
      vi.spyOn(console, "error").mockImplementation(() => {});

      const webpush = (await import("web-push")).default;
      (webpush.sendNotification as ReturnType<typeof vi.fn>).mockRejectedValue({
        statusCode: 404,
        message: "Not Found",
      });

      const { sendPushNotification } = await import("@/lib/web-push");

      const result = await sendPushNotification(
        VALID_SUB,
        { title: "Test", body: "Test body" }
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
    });

    it("should handle generic send errors", async () => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public-key";
      process.env.VAPID_PRIVATE_KEY = "private-key";
      vi.spyOn(console, "error").mockImplementation(() => {});

      const webpush = (await import("web-push")).default;
      (webpush.sendNotification as ReturnType<typeof vi.fn>).mockRejectedValue({
        statusCode: 500,
        message: "Internal Server Error",
      });

      const { sendPushNotification } = await import("@/lib/web-push");

      const result = await sendPushNotification(
        VALID_SUB,
        { title: "Test", body: "Test body" }
      );

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toBe("Internal Server Error");
    });

    it("passes socket timeout to web-push", async () => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public-key";
      process.env.VAPID_PRIVATE_KEY = "private-key";
      const webpush = (await import("web-push")).default;
      const send = webpush.sendNotification as ReturnType<typeof vi.fn>;
      send.mockResolvedValue({ statusCode: 201 });

      const { sendPushNotification } = await import("@/lib/web-push");
      await sendPushNotification(VALID_SUB, { title: "Test", body: "Test body" });

      expect(send.mock.calls.at(-1)?.[2]).toMatchObject({ timeout: PUSH_SEND_TIMEOUT_MS });
    });

    it.each([
      ["metadane chmury", "http://169.254.169.254/computeMetadata/v1/"],
      ["obcy host", "https://evil.example/x"],
      ["sufiks doklejony do FCM", "https://fcm.googleapis.com.evil.example/fcm/send/x"],
    ])("does not send to endpoint outside allowlist: %s", async (_name, endpoint) => {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public-key";
      process.env.VAPID_PRIVATE_KEY = "private-key";
      const webpush = (await import("web-push")).default;
      const send = webpush.sendNotification as ReturnType<typeof vi.fn>;
      send.mockClear();

      const { sendPushNotification } = await import("@/lib/web-push");
      const result = await sendPushNotification(
        { endpoint, keys: VALID_SUB.keys },
        { title: "Test", body: "Test body" }
      );

      expect(send).not.toHaveBeenCalled();
      expect(result).toMatchObject({ success: false, invalidSubscription: true });
    });
  });
});
