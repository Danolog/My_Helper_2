import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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

import {
  maskEmailAddress,
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  isEmailConfigured,
  renderEmailLayout,
} from "@/lib/email";
import { logger } from "@/lib/logger";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockDbInsertInto.mockReturnValue({ values: mockDbValues });
  mockDbValues.mockReturnValue({ returning: mockDbReturning });
  mockDbReturning.mockResolvedValue([{ id: "notif-1" }]);
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isEmailConfigured", () => {
  it("returns false without RESEND_API_KEY", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(isEmailConfigured()).toBe(false);
  });

  it("returns true with RESEND_API_KEY", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    expect(isEmailConfigured()).toBe(true);
  });
});

describe("sendEmail", () => {
  const baseMsg = {
    to: "klient@example.com",
    subject: "Testowy temat",
    html: "<p>Treść</p>",
  };

  it("simulates the send without RESEND_API_KEY (no fetch, success)", async () => {
    vi.stubEnv("RESEND_API_KEY", "");

    const result = await sendEmail(baseMsg);

    expect(result.success).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
    // No salonId → no notifications insert
    expect(mockDbInsertInto).not.toHaveBeenCalled();
  });

  it("sends through Resend when RESEND_API_KEY is set", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Salon <no-reply@salon.pl>");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "email-123" }),
    });

    const result = await sendEmail(baseMsg);

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    const body = JSON.parse(init.body);
    expect(body.from).toBe("Salon <no-reply@salon.pl>");
    expect(body.to).toEqual(["klient@example.com"]);
    expect(body.subject).toBe("Testowy temat");
  });

  it("saves a notifications audit record when salonId is provided", async () => {
    vi.stubEnv("RESEND_API_KEY", "");

    const result = await sendEmail({
      ...baseMsg,
      salonId: "salon-1",
      clientId: "client-1",
    });

    expect(result.success).toBe(true);
    expect(result.notificationId).toBe("notif-1");
    expect(mockDbValues).toHaveBeenCalledWith(
      expect.objectContaining({
        salonId: "salon-1",
        clientId: "client-1",
        type: "email",
        status: "sent",
      })
    );
  });

  it("rejects an invalid email address without calling the API", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");

    const result = await sendEmail({ ...baseMsg, to: "nie-email" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("invalid_address");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns failure and saves a failed record on Resend API error", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: "Invalid from address" }),
    });

    const result = await sendEmail({ ...baseMsg, salonId: "salon-1" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("provider_http_422_other");
    expect(mockDbValues).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", type: "email" })
    );
  });

  it("returns failure on network error", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockFetch.mockRejectedValue(new Error("network down"));

    const result = await sendEmail(baseMsg);

    expect(result.success).toBe(false);
    expect(result.error).toBe("send_failed");
  });

  it("handles a non-JSON error response body", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    });

    const result = await sendEmail(baseMsg);

    expect(result.success).toBe(false);
    expect(result.error).toBe("provider_http_500_other");
  });
});

describe("transactional templates", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "email-1" }),
    });
  });

  it("sendVerificationEmail includes the verification URL", async () => {
    const result = await sendVerificationEmail({
      to: "nowy@example.com",
      url: "https://app.pl/verify?token=abc",
    });

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.html).toContain("https://app.pl/verify?token=abc");
    expect(body.subject).toContain("potwierdź");
  });

  it("sendPasswordResetEmail includes the reset URL", async () => {
    const result = await sendPasswordResetEmail({
      to: "user@example.com",
      url: "https://app.pl/reset?token=xyz",
    });

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.html).toContain("https://app.pl/reset?token=xyz");
    expect(body.subject).toContain("reset");
  });
});

describe("renderEmailLayout", () => {
  it("wraps the body in an HTML document with the title", () => {
    const html = renderEmailLayout("Tytuł", "<p>Body</p>");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Tytuł");
    expect(html).toContain("<p>Body</p>");
  });
});

describe("logi e-maila bez pełnego adresu (hotfix P1)", () => {
  it("maskEmailAddress: pierwszy znak + domena; brak @ → ***", () => {
    expect(maskEmailAddress("klient@example.com")).toBe("k***@example.com");
    expect(maskEmailAddress("a@b@c.pl")).toBe("a***@c.pl");
    expect(maskEmailAddress("nie-email")).toBe("***");
    expect(maskEmailAddress("@x.pl")).toBe("***");
  });

  it.each([
    ["symulacja", "", undefined],
    ["Resend", "re_test_key", { ok: true, json: async () => ({ id: "e-1" }) }],
    ["błąd Resend", "re_test_key", { ok: false, status: 500, json: async () => ({ message: "x" }) }],
  ])("%s: żaden log nie zawiera adresu klienta", async (_label, key, response) => {
    vi.stubEnv("RESEND_API_KEY", key);
    if (response) mockFetch.mockResolvedValue(response);
    await sendEmail({ to: "anna.kowalska@example.com", subject: "Temat", html: "<p>x</p>" });
    await sendEmail({ to: "anna.kowalska-bez-domeny", subject: "Temat", html: "<p>x</p>" });

    const logged = JSON.stringify(
      [logger.info, logger.warn, logger.error, logger.debug].flatMap((fn) => vi.mocked(fn).mock.calls)
    );
    expect(logged).not.toContain("anna.kowalska");
    expect(logged.length).toBeGreaterThan(2);
  });
});

describe("komunikaty błędów wysyłki poczty bez treści dostawcy", () => {
  const RECIPIENT = "ola.nowak@example.org";

  /** Wszystkie wywołania loggera jako tekst; obiekt błędu z nazwą, treścią i przyczyną. */
  function loggedText(): string {
    const calls = [logger.info, logger.warn, logger.error, logger.debug].flatMap((fn) => vi.mocked(fn).mock.calls);
    return JSON.stringify(calls, (_key, value: unknown) =>
      value instanceof Error
        ? { name: value.name, message: value.message, cause: (value as { cause?: unknown }).cause }
        : value
    );
  }

  it("błąd dostawcy z adresem w treści: adresu nie ma w logach ani w result.error; status w kodzie", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ name: "validation_error", message: `Invalid \`to\` field: ${RECIPIENT} is not allowed` }),
    });

    const result = await sendEmail({ to: RECIPIENT, subject: "Temat", html: "<p>x</p>" });

    expect(result).toEqual({ success: false, error: "provider_http_422_validation_error" });
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to send email",
      expect.objectContaining({ reason: "provider_http_422_validation_error", errorName: "EmailProviderError" })
    );
    expect(loggedText()).not.toContain("ola.nowak");
    expect(loggedText()).not.toContain("is not allowed");
  });

  /** Odpowiedź dostawcy 403 z podanym polem `name`; zwraca wynik wysyłki. */
  async function failWithName(name: unknown) {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({ name, message: "x" }) });
    return sendEmail({ to: RECIPIENT, subject: "Temat", html: "<p>x</p>" });
  }

  it("typ błędu dostawcy spoza listy z adresem e-mail → other; adresu nie ma w logach ani w result.error", async () => {
    const result = await failWithName(`blocked_${RECIPIENT}`);

    expect(result).toEqual({ success: false, error: "provider_http_403_other" });
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to send email",
      expect.objectContaining({ reason: "provider_http_403_other" })
    );
    expect(loggedText()).not.toContain("ola.nowak");
    expect(JSON.stringify(result)).not.toContain("ola.nowak");
  });

  it.each([
    ["wielka litera", "Validation_error"],
    ["spacja na końcu", "validation_error "],
    ["spacja na początku", " validation_error"],
    ["przedrostek znanej wartości", "validation_error_x"],
    ["obiekt", { type: "validation_error" }],
    ["liczba", 422],
    ["brak pola", undefined],
  ])("typ błędu dostawcy: %s → other", async (_label, name) => {
    const result = await failWithName(name);
    expect(result.error).toBe("provider_http_403_other");
  });

  it("odpowiedź dostawcy nie-JSON → other", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    });
    const result = await sendEmail({ to: RECIPIENT, subject: "Temat", html: "<p>x</p>" });
    expect(result.error).toBe("provider_http_502_other");
  });

  it.each(["rate_limit_exceeded", "restricted_api_key", "validation_error"])(
    "znany typ błędu dostawcy %s przechodzi do kodu",
    async (name) => {
      const result = await failWithName(name);
      expect(result.error).toBe(`provider_http_403_${name}`);
    }
  );

  it("błąd sieci: kod send_failed, w logu nazwa klasy i kod przyczyny, bez treści błędu", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    mockFetch.mockRejectedValue(
      new Error(`fetch failed for ${RECIPIENT}`, { cause: { code: "ENOTFOUND" } })
    );

    const result = await sendEmail({ to: RECIPIENT, subject: "Temat", html: "<p>x</p>" });

    expect(result).toEqual({ success: false, error: "send_failed" });
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to send email",
      expect.objectContaining({ reason: "send_failed", errorName: "Error", errorCode: "ENOTFOUND" })
    );
    expect(loggedText()).not.toContain("ola.nowak");
    expect(loggedText()).not.toContain("fetch failed");
  });
});
