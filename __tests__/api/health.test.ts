/**
 * Integration tests for /api/health endpoint.
 *
 * Tests cover:
 * - GET /api/health (healthy response)
 * - GET /api/health (unhealthy response when DB is down)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseResponse } from "./helpers";

// -------------------------------------------------------
// Mocks
// -------------------------------------------------------

const mockExecute = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    execute: (...args: unknown[]) => mockExecute(...args),
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: vi.fn((...args: unknown[]) => ({ type: "sql", args })),
}));

// -------------------------------------------------------
// Import route handler
// -------------------------------------------------------

import { GET as healthCheck } from "@/app/api/health/route";
import { logger } from "@/lib/logger";

const DATABASE_UNAVAILABLE_MESSAGE = "Database unavailable";

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 200 with healthy status when DB is connected", async () => {
    mockExecute.mockResolvedValue([{ connected: 1 }]);

    const response = await healthCheck();
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.status).toBe("healthy");
    expect((body as any).database.status).toBe("connected");
    expect((body as any).database.type).toBe("postgresql");
    expect(body.timestamp).toBeDefined();
    expect(body.responseTimeMs).toBeDefined();
    expect(typeof body.responseTimeMs).toBe("number");
  });

  it("should return 503 with unhealthy status when DB connection fails", async () => {
    mockExecute.mockRejectedValue(
      new Error("connect ECONNREFUSED db.example.internal:5432")
    );

    const response = await healthCheck();
    const { status, body } = await parseResponse(response);

    expect(status).toBe(503);
    expect(body.status).toBe("unhealthy");
    expect((body as any).database.status).toBe("disconnected");
    expect((body as any).database.error).toBe(DATABASE_UNAVAILABLE_MESSAGE);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("db.example.internal");
    expect(raw).not.toContain("ECONNREFUSED");
  });

  it("should return 503 with fixed error text when a non-Error value is thrown", async () => {
    mockExecute.mockRejectedValue("connect ECONNREFUSED db.example.internal:5432");

    const response = await healthCheck();
    const { status, body } = await parseResponse(response);

    expect(status).toBe(503);
    expect(body.status).toBe("unhealthy");
    expect((body as any).database.status).toBe("disconnected");
    expect((body as any).database.error).toBe(DATABASE_UNAVAILABLE_MESSAGE);
    expect(JSON.stringify(body)).not.toContain("db.example.internal");
  });

  it("should log the thrown error once on failure", async () => {
    const thrown = new Error("connect ECONNREFUSED db.example.internal:5432");
    mockExecute.mockRejectedValue(thrown);
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

    try {
      await healthCheck();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        "Health check failed",
        expect.objectContaining({ error: thrown })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("should return 503 when DB query times out", async () => {
    // Simulate a timeout by making execute hang longer than the timeout
    mockExecute.mockImplementation(
      () => new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Operation timed out after 5000ms")), 10)
      )
    );

    const response = await healthCheck();
    const { status, body } = await parseResponse(response);

    expect(status).toBe(503);
    expect(body.status).toBe("unhealthy");
    expect((body as any).database.status).toBe("disconnected");
    expect((body as any).database.error).toBe(DATABASE_UNAVAILABLE_MESSAGE);
    expect(JSON.stringify(body)).not.toContain("timed out");
  });
});
