import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useNotificationsData } from "@/app/dashboard/notifications/_hooks/use-notifications-data";

// P0 (GET /api/notifications): trasa wymusza salon z sesji. Hook brał salon
// z publicznego katalogu GET /api/salons (data[0] = pierwszy salon w bazie,
// zwykle CUDZY) — po naprawie API dostawałby 403. Hook ma pytać o salon konta.

const OWN_SALON = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN_SALON = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "owner-a" }, session: {} } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(),
}));

const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  let body: unknown = { success: true, data: [] };
  if (url === "/api/salons/mine") body = { success: true, salon: { id: OWN_SALON } };
  else if (url === "/api/salons") body = { success: true, data: [{ id: FOREIGN_SALON }] };
  else if (url.startsWith("/api/notifications?"))
    body = { success: true, data: { notifications: [], total: 0 } };
  return new Response(JSON.stringify(body), { status: 200 });
});

describe("useNotificationsData — salon konta", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it("pyta /api/notifications o salon z /api/salons/mine, nie z katalogu", async () => {
    const { result } = renderHook(() => useNotificationsData());

    await waitFor(() => expect(result.current.salonId).toBe(OWN_SALON));
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([u]) => String(u).startsWith("/api/notifications?"))
      ).toBe(true)
    );

    const urls = mockFetch.mock.calls.map(([u]) => String(u));
    expect(urls).not.toContain("/api/salons");
    const notifUrl = urls.find((u) => u.startsWith("/api/notifications?"))!;
    expect(new URL(notifUrl, "http://x").searchParams.get("salonId")).toBe(OWN_SALON);
  });
});
