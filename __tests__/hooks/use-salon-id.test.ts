import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the auth-client module that provides useSession
vi.mock("@/lib/auth-client", () => ({
  useSession: vi.fn(),
}));

import { useSalonId } from "@/hooks/use-salon-id";
import { useSession } from "@/lib/auth-client";

const mockUseSession = vi.mocked(useSession);

describe("useSalonId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Initialization ---

  it("should start with salonId=null and loading=true when session exists", () => {
    mockUseSession.mockReturnValue({
      data: { session: {} as never, user: { id: "u1", name: "Test" } as never },
    } as never);
    mockFetch.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useSalonId());

    expect(result.current.salonId).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  // --- No session ---

  it("should set loading=false and salonId=null when no session", async () => {
    mockUseSession.mockReturnValue({ data: null } as never);

    const { result } = renderHook(() => useSalonId());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.salonId).toBeNull();
    // Should not have called fetch at all
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should set loading=false when session exists but user is null", async () => {
    mockUseSession.mockReturnValue({
      data: { session: {} as never, user: null },
    } as never);

    const { result } = renderHook(() => useSalonId());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.salonId).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // --- Happy path ---

  it("should fetch and set salonId when session has user", async () => {
    mockUseSession.mockReturnValue({
      data: { session: {} as never, user: { id: "u1", name: "Test" } as never },
    } as never);

    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        salon: { id: "salon-123", name: "My Salon" },
      }),
    });

    const { result } = renderHook(() => useSalonId());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.salonId).toBe("salon-123");
    expect(mockFetch).toHaveBeenCalledWith("/api/salons/mine");
  });

  // --- Error handling ---

  it("should set loading=false and salonId=null on fetch error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockUseSession.mockReturnValue({
      data: { session: {} as never, user: { id: "u1" } as never },
    } as never);

    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useSalonId());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.salonId).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to fetch salon:",
      expect.any(Error)
    );
  });

  it("should handle API returning success=false", async () => {
    mockUseSession.mockReturnValue({
      data: { session: {} as never, user: { id: "u1" } as never },
    } as never);

    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: false, salon: null }),
    });

    const { result } = renderHook(() => useSalonId());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.salonId).toBeNull();
  });

  it("should handle API returning success=true but no salon object", async () => {
    mockUseSession.mockReturnValue({
      data: { session: {} as never, user: { id: "u1" } as never },
    } as never);

    mockFetch.mockResolvedValueOnce({
      json: async () => ({ success: true, salon: null }),
    });

    const { result } = renderHook(() => useSalonId());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.salonId).toBeNull();
  });

  // --- Edge cases ---

  it("should cancel fetch on unmount (not update state)", async () => {
    mockUseSession.mockReturnValue({
      data: { session: {} as never, user: { id: "u1" } as never },
    } as never);

    // Create a promise we can control
    let resolvePromise!: (value: unknown) => void;
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    const { result, unmount } = renderHook(() => useSalonId());

    // Unmount before fetch resolves
    unmount();

    // Resolve the fetch after unmount
    resolvePromise({
      json: async () => ({
        success: true,
        salon: { id: "salon-late" },
      }),
    });

    // State should remain at initial values (no error thrown)
    expect(result.current.salonId).toBeNull();
  });

  it("should refetch when session changes", async () => {
    const initialSession = {
      data: { session: {} as never, user: { id: "u1" } as never },
    } as never;

    mockUseSession.mockReturnValue(initialSession);
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        salon: { id: "salon-1" },
      }),
    });

    const { result, rerender } = renderHook(() => useSalonId());

    await waitFor(() => {
      expect(result.current.salonId).toBe("salon-1");
    });

    // Session changes (different user)
    const newSession = {
      data: { session: {} as never, user: { id: "u2" } as never },
    } as never;
    mockUseSession.mockReturnValue(newSession);
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        salon: { id: "salon-2" },
      }),
    });

    rerender();

    await waitFor(() => {
      expect(result.current.salonId).toBe("salon-2");
    });
  });
});
