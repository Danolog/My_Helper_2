/**
 * Integration tests for /api/health endpoint.
 *
 * Tests cover:
 * - GET /api/health (healthy response)
 * - GET /api/health (unhealthy response when DB is down)
 * - schema guard: applied migrations in the database vs. entries of the
 *   migration journal bundled into the image (equal, fewer, more, missing
 *   table, permission denied, query error, missing journal). Public body is
 *   generic; counts and reason go to the server log only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    type: "sql",
    text: strings.join("?"),
    values,
  })),
}));

// Journal bundled into the image. `missing` simulates a build without the file
// (import fails); `journal` replaces its content.
const journalState = vi.hoisted(() => ({
  missing: false,
  journal: { entries: [{ idx: 0 }, { idx: 1 }, { idx: 2 }] } as unknown,
}));

vi.mock("../../drizzle/meta/_journal.json", () => ({
  get default() {
    if (journalState.missing) throw new Error("Cannot find module '_journal.json'");
    return journalState.journal;
  },
}));

// -------------------------------------------------------
// Import route handler
// -------------------------------------------------------

import { GET as healthCheck } from "@/app/api/health/route";
import { logger } from "@/lib/logger";

const DATABASE_UNAVAILABLE_MESSAGE = "Database unavailable";
const SERVICE_NOT_READY_MESSAGE = "Service not ready";
const JOURNAL_ENTRIES = 3;

function queryText(query: unknown): string {
  return (query as { text?: string }).text ?? "";
}

const isMigrationsCount = (query: unknown) => queryText(query).includes("drizzle.__drizzle_migrations");

/** Ping succeeds; the migrations count query resolves/rejects as given. */
function database(count: () => Promise<unknown>) {
  mockExecute.mockImplementation((query: unknown) =>
    isMigrationsCount(query) ? count() : Promise.resolve([{ connected: 1 }])
  );
}

/** Error shaped like drizzle's wrapper around a postgres.js error. */
function wrappedPgError(code: string, message: string) {
  const cause = Object.assign(new Error(message), { code });
  return Object.assign(new Error("Failed query: SELECT count(*) ..."), { cause });
}

function migrationQueries() {
  return mockExecute.mock.calls.filter(([q]) => isMigrationsCount(q)).length;
}

let errorSpy: ReturnType<typeof vi.spyOn>;

function schemaLog(): Record<string, unknown> | undefined {
  const calls = errorSpy.mock.calls as unknown[][];
  const call = calls.find((args) => args[0] === "Health check: schema not ready");
  return call?.[1] as Record<string, unknown> | undefined;
}

async function expectNotReady() {
  const response = await healthCheck();
  const { status, body } = await parseResponse(response);
  expect(status).toBe(503);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(Object.keys(body).sort()).toEqual(["error", "responseTimeMs", "status", "timestamp"]);
  expect(body.status).toBe("unhealthy");
  expect(body.error).toBe(SERVICE_NOT_READY_MESSAGE);
  const raw = JSON.stringify(body);
  expect(raw).not.toMatch(/migrat|journal|schema|SCHEMA|42P01|42501|db\.example\.internal/);
  return body;
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    journalState.missing = false;
    journalState.journal = { entries: Array.from({ length: JOURNAL_ENTRIES }, (_, idx) => ({ idx })) };
    errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("should return 200 with healthy status when DB is connected and schema matches the journal", async () => {
    database(() => Promise.resolve([{ applied: JOURNAL_ENTRIES }]));

    const response = await healthCheck();
    const { status, body } = await parseResponse(response);

    expect(status).toBe(200);
    expect(body.status).toBe("healthy");
    expect((body as any).database.status).toBe("connected");
    expect((body as any).database.type).toBe("postgresql");
    expect(body.timestamp).toBeDefined();
    expect(body.responseTimeMs).toBeDefined();
    expect(typeof body.responseTimeMs).toBe("number");
    expect(migrationQueries()).toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();
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
    expect(migrationQueries()).toBe(0);
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

    await healthCheck();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Health check failed",
      expect.objectContaining({ error: thrown })
    );
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

  describe("schema guard", () => {
    it("fewer applied migrations than journal entries → 503, counts only in the server log", async () => {
      database(() => Promise.resolve([{ applied: JOURNAL_ENTRIES - 1 }]));

      await expectNotReady();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(schemaLog()).toEqual({
        reason: "SCHEMA_BEHIND",
        applied: JOURNAL_ENTRIES - 1,
        expected: JOURNAL_ENTRIES,
        sqlstate: undefined,
      });
    });

    it("no applied migrations at all (empty table) → 503", async () => {
      database(() => Promise.resolve([{ applied: 0 }]));

      await expectNotReady();

      expect(schemaLog()).toMatchObject({ reason: "SCHEMA_BEHIND", applied: 0, expected: JOURNAL_ENTRIES });
    });

    it("more applied migrations than journal entries (older image) → 200", async () => {
      database(() => Promise.resolve([{ applied: JOURNAL_ENTRIES + 2 }]));

      const response = await healthCheck();
      const { status, body } = await parseResponse(response);

      expect(status).toBe(200);
      expect(body.status).toBe("healthy");
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("migrations table missing (42P01) → 503, reason code without the error message", async () => {
      database(() =>
        Promise.reject(wrappedPgError("42P01", 'relation "drizzle.__drizzle_migrations" does not exist at db.example.internal'))
      );

      await expectNotReady();

      expect(schemaLog()).toEqual({
        reason: "MIGRATIONS_TABLE_MISSING",
        applied: undefined,
        expected: JOURNAL_ENTRIES,
        sqlstate: "42P01",
      });
      expect(JSON.stringify(schemaLog())).not.toContain("db.example.internal");
    });

    it("no privilege on the migrations table (42501) → 503 with its own reason code", async () => {
      database(() => Promise.reject(wrappedPgError("42501", "permission denied for schema drizzle")));

      await expectNotReady();

      expect(schemaLog()).toMatchObject({ reason: "MIGRATIONS_TABLE_DENIED", sqlstate: "42501" });
    });

    it("other query error → 503 MIGRATIONS_QUERY_FAILED with SQLSTATE only", async () => {
      database(() => Promise.reject(wrappedPgError("57014", "canceling statement due to statement timeout")));

      await expectNotReady();

      expect(schemaLog()).toEqual({
        reason: "MIGRATIONS_QUERY_FAILED",
        applied: undefined,
        expected: JOURNAL_ENTRIES,
        sqlstate: "57014",
      });
    });

    it("query error without a SQLSTATE → 503 MIGRATIONS_QUERY_FAILED, no sqlstate", async () => {
      database(() => Promise.reject(new Error("socket closed: db.example.internal:5432")));

      await expectNotReady();

      expect(schemaLog()).toEqual({
        reason: "MIGRATIONS_QUERY_FAILED",
        applied: undefined,
        expected: JOURNAL_ENTRIES,
        sqlstate: undefined,
      });
    });

    it("count query returns no row → 503 MIGRATIONS_QUERY_FAILED", async () => {
      database(() => Promise.resolve([]));

      await expectNotReady();

      expect(schemaLog()).toMatchObject({ reason: "MIGRATIONS_QUERY_FAILED", expected: JOURNAL_ENTRIES });
    });

    it("journal file missing from the image → 503 JOURNAL_UNAVAILABLE, no count query", async () => {
      journalState.missing = true;
      database(() => Promise.resolve([{ applied: JOURNAL_ENTRIES }]));

      await expectNotReady();

      expect(schemaLog()).toEqual({
        reason: "JOURNAL_UNAVAILABLE",
        applied: undefined,
        expected: undefined,
        sqlstate: undefined,
      });
      expect(migrationQueries()).toBe(0);
    });

    it("journal without entries → 503 JOURNAL_UNAVAILABLE", async () => {
      journalState.journal = { version: "7", entries: [] };
      database(() => Promise.resolve([{ applied: 0 }]));

      await expectNotReady();

      expect(schemaLog()).toMatchObject({ reason: "JOURNAL_UNAVAILABLE" });
    });
  });
});
