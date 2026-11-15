/**
 * Urodziny, „tęsknimy” i push są zamrożone (hardOff w src/lib/features.ts:
 * clientMarketing, pushNotifications). Strony powiadomień nie pokazują ich
 * sekcji i nie pytają zamrożonych tras API. Kontrola: przy module włączonym
 * w kontekście (symulacja odmrożenia) sekcje wracają.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import NotificationsPage from "@/app/dashboard/notifications/page";
import NotificationSettingsPage from "@/app/dashboard/settings/notifications/page";
import { ModulesProvider } from "@/components/dashboard/modules-provider";
import { DEFAULT_MODULES, type ModulesState } from "@/lib/features";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Stabilny obiekt sesji — hook ustawień ma go w zależnościach efektu.
const session = vi.hoisted(() => ({ data: { user: { id: "user-1" } }, isPending: false }));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => session,
}));

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(),
}));

const SALON_ID = "salon-1";
const THAWED: ModulesState = {
  ...DEFAULT_MODULES,
  clientMarketing: true,
  pushNotifications: true,
};

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

    if (url.includes("/api/notifications/birthday")) {
      return json({ success: true, data: { clients: [], birthdaySettings: null } });
    }
    if (url.includes("/api/notifications/we-miss-you")) {
      return json({ success: true, data: { clients: [], inactiveDays: 30 } });
    }
    if (url.includes("/api/notifications")) {
      return json({ success: true, data: { notifications: [], total: 0 } });
    }
    if (url.includes("/birthday-settings") || url.includes("/we-miss-you-settings")) {
      return json({ success: false });
    }
    if (url.includes("/notification-type-settings")) {
      return json({
        success: true,
        data: { smsReminders: true, pushReminders: true, paymentConfirmations: true },
      });
    }
    // Salon konta z sesji (useSalonId, #40) — nie publiczny katalog.
    if (url.includes("/api/salons/mine")) {
      return json({ success: true, salon: { id: SALON_ID, ownerId: "user-1" } });
    }
    if (url.includes("/api/salons")) {
      return json({ success: true, data: [{ id: SALON_ID, ownerId: "user-1" }] });
    }
    return json({ success: false });
  });
}

function fetchedUrls(): string[] {
  return (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
}

function withModules(ui: React.ReactNode, modules: ModulesState = DEFAULT_MODULES) {
  return render(<ModulesProvider modules={modules}>{ui}</ModulesProvider>);
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Powiadomienia (/dashboard/notifications)", () => {
  it("zamrożone: bez sekcji urodzin, „tęsknimy” i panelu push; bez zapytań do zamrożonych tras", async () => {
    withModules(<NotificationsPage />);

    await waitFor(() => {
      expect(fetchedUrls().some((u) => u.startsWith("/api/notifications?"))).toBe(true);
    });

    expect(screen.getByText("Powiadomienia")).toBeInTheDocument();
    expect(screen.queryByTestId("birthday-notifications-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("we-miss-you-section")).not.toBeInTheDocument();
    expect(screen.queryByText(/Powiadomienia push/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/urodzin|t[ęe]sknimy/i);

    const frozenCalls = fetchedUrls().filter((u) =>
      /\/api\/notifications\/(birthday|we-miss-you)|\/api\/push\//.test(u)
    );
    expect(frozenCalls).toEqual([]);
  });

  it("kontrola: przy modułach włączonych sekcje wracają", async () => {
    withModules(<NotificationsPage />, THAWED);

    expect(await screen.findByTestId("birthday-notifications-section")).toBeInTheDocument();
    expect(await screen.findByTestId("we-miss-you-section")).toBeInTheDocument();
    expect(await screen.findByText(/Powiadomienia push/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchedUrls().some((u) => u.includes("/api/notifications/birthday"))).toBe(true);
      expect(fetchedUrls().some((u) => u.includes("/api/notifications/we-miss-you"))).toBe(true);
    });
  });
});

describe("Ustawienia powiadomień (/dashboard/settings/notifications)", () => {
  it("zamrożone: bez ustawień urodzin i „tęsknimy”, bez przełącznika push", async () => {
    withModules(<NotificationSettingsPage />);

    expect(await screen.findByTestId("notification-channels-settings")).toBeInTheDocument();

    // Rdzeń zostaje.
    expect(screen.getByText("Przypomnienia SMS")).toBeInTheDocument();
    expect(screen.getByText("Potwierdzenia platnosci")).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(2);

    expect(screen.queryByText("Powiadomienia Push")).not.toBeInTheDocument();
    expect(screen.queryByTestId("birthday-gift-settings")).not.toBeInTheDocument();
    expect(screen.queryByTestId("we-miss-you-settings")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/urodzin|t[ęe]sknimy|re-engagement|push/i);

    const frozenCalls = fetchedUrls().filter((u) =>
      /birthday-settings|we-miss-you-settings/.test(u)
    );
    expect(frozenCalls).toEqual([]);
  });

  it("kontrola: przy modułach włączonych ustawienia i przełącznik push wracają", async () => {
    withModules(<NotificationSettingsPage />, THAWED);

    expect(await screen.findByTestId("birthday-gift-settings")).toBeInTheDocument();
    expect(screen.getByTestId("we-miss-you-settings")).toBeInTheDocument();
    expect(screen.getByText("Powiadomienia Push")).toBeInTheDocument();
    expect(fetchedUrls().some((u) => u.includes("/birthday-settings"))).toBe(true);
    expect(fetchedUrls().some((u) => u.includes("/we-miss-you-settings"))).toBe(true);
  });
});
