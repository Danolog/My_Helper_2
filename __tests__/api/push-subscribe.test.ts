/**
 * POST /api/push/subscribe — endpoint tylko z allowlisty usług push.
 *
 * Przed poprawką schemat sprawdzał wyłącznie niepusty string (max 200), więc
 * dowolne konto zapisywało `endpoint` na metadane chmury, sieć wewnętrzną albo
 * obcy serwer, a wysyłka (web-push) szła tam z naszego serwera (SSRF, P1).
 * Limit 200 znaków odrzucał też prawdziwe endpointy Firefox/Edge/Safari.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockRequest, parseResponse } from "./helpers";
import {
  VALID_AUTH,
  VALID_ENDPOINTS,
  VALID_P256DH,
  validSubscription,
} from "../fixtures/push-subscriptions";

const USER = { id: "user-a", name: "Anna", email: "anna@example.com" };

const mockInsertValues = vi.fn();
const mockUpdateSet = vi.fn();
let existingRows: unknown[] = [];

function chain(result: () => unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit", "returning"]) c[m] = vi.fn(() => c);
  c.values = vi.fn((v: unknown) => {
    mockInsertValues(v);
    return c;
  });
  c.set = vi.fn((v: unknown) => {
    mockUpdateSet(v);
    return c;
  });
  c.then = (resolve: (v: unknown[]) => unknown) => resolve(result());
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain(() => existingRows),
    insert: () => chain(() => [{ id: "sub-new" }]),
    update: () => chain(() => []),
  },
}));

vi.mock("@/lib/auth-middleware", () => ({
  requireAuth: vi.fn(async () => ({ user: USER, session: {} })),
  isAuthError: (r: unknown) => r instanceof Response,
}));

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { check: () => ({ success: true, reset: 0 }) },
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from "@/app/api/push/subscribe/route";

function subscribe(subscription: unknown) {
  return POST(
    createMockRequest("http://localhost:3000/api/push/subscribe", {
      method: "POST",
      body: { subscription, userAgent: "vitest" },
    })
  );
}

const withEndpoint = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
});

beforeEach(() => {
  vi.clearAllMocks();
  existingRows = [];
});

describe("POST /api/push/subscribe — odrzuca endpoint spoza allowlisty (400, bez zapisu)", () => {
  it.each([
    ["metadane chmury (http)", "http://169.254.169.254/computeMetadata/v1/"],
    ["metadane chmury (https)", "https://169.254.169.254/latest/meta-data/"],
    ["obcy host", "https://evil.example/fcm/send/abc"],
    ["sufiks doklejony do FCM", "https://fcm.googleapis.com.evil.example/fcm/send/abc"],
    ["userinfo", "https://user:pass@fcm.googleapis.com/fcm/send/abc"],
    ["FCM@obcy host", "https://fcm.googleapis.com@169.254.169.254/fcm/send/abc"],
    ["port", "https://fcm.googleapis.com:8443/fcm/send/abc"],
    ["IP literal", "https://10.0.0.5/fcm/send/abc"],
    ["trailing dot", "https://fcm.googleapis.com./fcm/send/abc"],
  ])("%s", async (_name, endpoint) => {
    const { status, body } = await parseResponse<{ success: boolean; details: Record<string, string> }>(
      await subscribe(withEndpoint(endpoint))
    );
    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.details.endpoint).toBeDefined();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("odrzuca nieprawidłowe klucze p256dh/auth", async () => {
    const res = await subscribe({ endpoint: VALID_ENDPOINTS.chromeFcm, keys: { p256dh: "key", auth: "auth" } });
    const { status, body } = await parseResponse<{ details: Record<string, string> }>(res);
    expect(status).toBe(400);
    expect(body.details["keys.p256dh"]).toBeDefined();
    expect(body.details["keys.auth"]).toBeDefined();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});

describe("POST /api/push/subscribe — przyjmuje usługi push przeglądarek", () => {
  it.each(Object.entries(VALID_ENDPOINTS))("%s → zapis", async (_name, endpoint) => {
    const { status, body } = await parseResponse<{ success: boolean; data: { created: boolean } }>(
      await subscribe(validSubscription(endpoint))
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.created).toBe(true);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER.id, endpoint })
    );
  });

  it("istniejący endpoint użytkownika → aktualizacja kluczy", async () => {
    existingRows = [{ id: "sub-1" }];
    const { status, body } = await parseResponse<{ data: { updated: boolean } }>(
      await subscribe(validSubscription())
    );
    expect(status).toBe(200);
    expect(body.data.updated).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ p256dh: VALID_P256DH, auth: VALID_AUTH })
    );
  });
});
