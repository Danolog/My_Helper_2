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
    mockExecute.mockRejectedValue(new Error("Connection refused"));

    const response = await healthCheck();
    const { status, body } = await parseResponse(response);

    expect(status).toBe(503);
    expect(body.status).toBe("unhealthy");
    expect((body as any).database.status).toBe("disconnected");
    expect((body as any).database.error).toContain("Connection refused");
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
  });
});
