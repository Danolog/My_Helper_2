import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// Mock the fetch API globally before importing the hook
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocking
import { useDiagnostics } from "@/hooks/use-diagnostics";

/** Helper that builds a valid DiagnosticsResponse payload. */
function makeDiagnosticsResponse(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: new Date().toISOString(),
    env: {
      POSTGRES_URL: true,
      BETTER_AUTH_SECRET: true,
      GOOGLE_CLIENT_ID: false,
      GOOGLE_CLIENT_SECRET: false,
      OPENROUTER_API_KEY: true,
      NEXT_PUBLIC_APP_URL: true,
    },
    database: { connected: true, schemaApplied: true },
    auth: { configured: true, routeResponding: true },
    ai: { configured: true },
    overallStatus: "ok",
    ...overrides,
  };
}

describe("useDiagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Initialization ---

  it("should start with loading=true, data=null, error=null", () => {
    // Never resolve the fetch so we can observe the initial state
    mockFetch.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useDiagnostics());

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isAuthReady).toBe(false);
    expect(result.current.isAiReady).toBe(false);
  });

  // --- Happy path ---

  it("should fetch diagnostics on mount and populate data", async () => {
    const payload = makeDiagnosticsResponse();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => payload,
    });

    const { result } = renderHook(() => useDiagnostics());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/diagnostics", {
      cache: "no-store",
    });
    expect(result.current.data).toEqual(payload);
    expect(result.current.error).toBeNull();
    expect(result.current.isAuthReady).toBe(true);
    expect(result.current.isAiReady).toBe(true);
  });

  it("should derive isAuthReady correctly when auth/db are configured", async () => {
    const payload = makeDiagnosticsResponse({
      auth: { configured: true, routeResponding: true },
      database: { connected: true, schemaApplied: true },
    });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => payload });

    const { result } = renderHook(() => useDiagnostics());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAuthReady).toBe(true);
  });

  it("should derive isAuthReady as false when database is not connected", async () => {
    const payload = makeDiagnosticsResponse({
      database: { connected: false, schemaApplied: false },
    });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => payload });

    const { result } = renderHook(() => useDiagnostics());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAuthReady).toBe(false);
  });

  it("should derive isAiReady as false when AI is not configured", async () => {
    const payload = makeDiagnosticsResponse({
      ai: { configured: false },
    });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => payload });

    const { result } = renderHook(() => useDiagnostics());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAiReady).toBe(false);
  });

  // --- Error handling ---

  it("should set error when fetch returns a non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useDiagnostics());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("HTTP 500");
    expect(result.current.data).toBeNull();
  });

  it("should set error when fetch throws a network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Failed to fetch"));

    const { result } = renderHook(() => useDiagnostics());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to fetch");
    expect(result.current.data).toBeNull();
  });

  it("should set a generic error message for non-Error thrown values", async () => {
    mockFetch.mockRejectedValueOnce("some string error");

    const { result } = renderHook(() => useDiagnostics());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Failed to load diagnostics");
  });

  // --- Refetch ---

  it("should allow refetching diagnostics via refetch()", async () => {
    const initialPayload = makeDiagnosticsResponse({ overallStatus: "warn" });
    const updatedPayload = makeDiagnosticsResponse({ overallStatus: "ok" });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => initialPayload,
    });

    const { result } = renderHook(() => useDiagnostics());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.overallStatus).toBe("warn");

    // Trigger refetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => updatedPayload,
    });

    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.overallStatus).toBe("ok");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("should clear previous error on successful refetch", async () => {
    // First call: error
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));

    const { result } = renderHook(() => useDiagnostics());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Network failure");

    // Second call: success
    const payload = makeDiagnosticsResponse();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => payload });

    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(payload);
  });

  // --- Edge cases ---

  it("should set loading=true during refetch", async () => {
    const payload = makeDiagnosticsResponse();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => payload });

    const { result } = renderHook(() => useDiagnostics());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Start a new fetch that never resolves
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    act(() => {
      result.current.refetch();
    });

    // loading should be true while request is in-flight
    expect(result.current.loading).toBe(true);
  });

  it("should derive isAuthReady as false when auth is not configured", async () => {
    const payload = makeDiagnosticsResponse({
      auth: { configured: false, routeResponding: true },
    });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => payload });

    const { result } = renderHook(() => useDiagnostics());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAuthReady).toBe(false);
  });

  it("should derive isAuthReady as false when schema is not applied", async () => {
    const payload = makeDiagnosticsResponse({
      database: { connected: true, schemaApplied: false },
    });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => payload });

    const { result } = renderHook(() => useDiagnostics());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAuthReady).toBe(false);
  });
});
