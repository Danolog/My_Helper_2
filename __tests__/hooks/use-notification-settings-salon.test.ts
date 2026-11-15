import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useNotificationSettings } from "@/app/dashboard/settings/notifications/_hooks/use-notification-settings";
import { ModulesProvider } from "@/components/dashboard/modules-provider";
import { DEFAULT_MODULES } from "@/lib/features";

// P2: hook ustawień powiadomień brał salon z publicznego katalogu GET /api/salons.
// Katalog nie zwraca ownerId, więc find(ownerId === userId) zawsze dawał null
// i hook brał data[0] (zwykle CUDZY salon) -> 403 na ustawieniach kanałów.
// Salon bez adresu/telefonu/branży w katalogu nie występuje wcale.
// Hook ma pytać o salon konta (/api/salons/mine).

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

type MineMode = "own" | "none" | "error";
let mineMode: MineMode = "own";

const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === "/api/salons/mine") {
    if (mineMode === "error") throw new TypeError("Failed to fetch");
    const body =
      mineMode === "own"
        ? { success: true, salon: { id: OWN_SALON } }
        : { success: true, salon: null };
    return new Response(JSON.stringify(body), { status: 200 });
  }
  if (url === "/api/salons") {
    return new Response(
      JSON.stringify({ success: true, data: [{ id: FOREIGN_SALON }] }),
      { status: 200 },
    );
  }
  if (url.endsWith("/notification-type-settings")) {
    return new Response(
      JSON.stringify({
        success: true,
        data: { smsReminders: false, pushReminders: true, paymentConfirmations: false },
      }),
      { status: 200 },
    );
  }
  return new Response(JSON.stringify({ success: false }), { status: 200 });
});

// clientMarketing włączony, żeby sprawdzić, że WSZYSTKIE trasy ustawień idą na salon konta.
const thawed = ({ children }: { children: ReactNode }) =>
  createElement(ModulesProvider, {
    modules: { ...DEFAULT_MODULES, clientMarketing: true },
    children,
  });

const urls = () => mockFetch.mock.calls.map(([u]) => String(u));

describe("useNotificationSettings — salon konta", () => {
  beforeEach(() => {
    mineMode = "own";
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it("ładuje ustawienia salonu z /api/salons/mine, nie pierwszego z katalogu", async () => {
    const { result } = renderHook(() => useNotificationSettings(), { wrapper: thawed });

    await waitFor(() =>
      expect(urls()).toContain(`/api/salons/${OWN_SALON}/notification-type-settings`),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(urls()).toContain("/api/salons/mine");
    expect(urls()).not.toContain("/api/salons");
    expect(urls().some((u) => u.includes(FOREIGN_SALON))).toBe(false);
    expect(urls()).toContain(`/api/salons/${OWN_SALON}/birthday-settings`);
    expect(urls()).toContain(`/api/salons/${OWN_SALON}/we-miss-you-settings`);
    expect(result.current.channelSettings).toEqual({
      smsReminders: false,
      pushReminders: true,
      paymentConfirmations: false,
    });
  });

  it("konto bez salonu: kończy ładowanie, nie pyta o ustawienia", async () => {
    mineMode = "none";
    const { result } = renderHook(() => useNotificationSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(urls()).toContain("/api/salons/mine");
    expect(urls().some((u) => /\/api\/salons\/[^/]+\/.+-settings$/.test(u))).toBe(false);
    expect(urls()).not.toContain("/api/salons");
  });

  it("błąd fetch /api/salons/mine: kończy ładowanie, bez fallbacku do katalogu", async () => {
    mineMode = "error";
    const { result } = renderHook(() => useNotificationSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(urls()).toContain("/api/salons/mine");
    expect(urls()).not.toContain("/api/salons");
    expect(urls().some((u) => u.includes(FOREIGN_SALON))).toBe(false);
  });
});
