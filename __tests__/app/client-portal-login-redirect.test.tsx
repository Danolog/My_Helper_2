/**
 * Strony portalu klienta bez sesji kierują na logowanie klienta
 * (`/portal/login?returnTo=…`), nie na `/login`. `/login` to logowanie panelu
 * salonu: prowadzi na `/dashboard`, a konto klienta bez salonu zobaczyłoby
 * tam zakładanie salonu. Dotyczy to klienta po rejestracji z wymaganym
 * potwierdzeniem e-maila — trafia na „Moje wizyty” bez sesji.
 *
 * Atrapy: `next/navigation`, `useSession`, `fetch`, sesja serwerowa.
 */
import { cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientLoginPath } from "@/lib/features";

const h = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  session: { data: null as { user: { id: string } } | null, isPending: false },
  hasActiveSession: vi.fn(async () => false),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => h.router,
  useParams: () => ({ id: "appt-1" }),
  useSearchParams: () => new URLSearchParams(),
  redirect: h.redirect,
}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => h.session }));
vi.mock("@/lib/api-client", () => ({ mutationFetch: vi.fn() }));
vi.mock("@/lib/session", () => ({ hasActiveSession: h.hasActiveSession }));
vi.mock("@/components/auth/sign-in-button", () => ({ SignInButton: () => null }));

/** Adres przekierowania rozłożony na ścieżkę i `returnTo`. */
function parsePush(call: unknown): { pathname: string; returnTo: string | null } {
  const url = new URL(String(call), "http://localhost");
  return { pathname: url.pathname, returnTo: url.searchParams.get("returnTo") };
}

beforeEach(() => {
  h.session.data = null;
  h.session.isPending = false;
  h.hasActiveSession.mockResolvedValue(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("clientLoginPath", () => {
  it("logowanie klienta z zakodowanym adresem powrotu", () => {
    expect(clientLoginPath("/appointments")).toBe("/portal/login?returnTo=%2Fappointments");
    expect(parsePush(clientLoginPath("/appointments/a?b&c"))).toEqual({
      pathname: "/portal/login",
      returnTo: "/appointments/a?b&c",
    });
  });
});

describe("„Moje wizyty” bez sesji", () => {
  it("przekierowuje na logowanie klienta z powrotem na /appointments, nie na /login", async () => {
    const { default: ClientAppointmentsPage } = await import("@/app/(client)/appointments/page");
    render(<ClientAppointmentsPage />);

    await waitFor(() => expect(h.router.push).toHaveBeenCalledTimes(1));
    expect(parsePush(h.router.push.mock.calls[0]![0])).toEqual({
      pathname: "/portal/login",
      returnTo: "/appointments",
    });
    expect(h.router.push).not.toHaveBeenCalledWith("/login");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("w trakcie sprawdzania sesji nie przekierowuje", async () => {
    h.session.isPending = true;
    const { default: ClientAppointmentsPage } = await import("@/app/(client)/appointments/page");
    render(<ClientAppointmentsPage />);

    expect(h.router.push).not.toHaveBeenCalled();
  });

  it("z sesją pobiera wizyty i nie przekierowuje", async () => {
    h.session.data = { user: { id: "client-user" } };
    const { default: ClientAppointmentsPage } = await import("@/app/(client)/appointments/page");
    render(<ClientAppointmentsPage />);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/client/appointments"));
    expect(h.router.push).not.toHaveBeenCalled();
  });
});

describe("szczegóły wizyty bez sesji", () => {
  it("przekierowuje na logowanie klienta z powrotem na tę wizytę", async () => {
    const { useAppointmentDetail } = await import(
      "@/app/(client)/appointments/[id]/_hooks/use-appointment-detail"
    );
    renderHook(() => useAppointmentDetail());

    await waitFor(() => expect(h.router.push).toHaveBeenCalledTimes(1));
    expect(parsePush(h.router.push.mock.calls[0]![0])).toEqual({
      pathname: "/portal/login",
      returnTo: "/appointments/appt-1",
    });
  });
});

describe("lista oczekujących bez sesji", () => {
  it("przekierowuje na logowanie klienta, nie przez /portal", async () => {
    const { default: WaitingListPage } = await import("@/app/(client)/waiting-list/page");
    render(<WaitingListPage />);

    await waitFor(() => expect(h.router.push).toHaveBeenCalledTimes(1));
    expect(parsePush(h.router.push.mock.calls[0]![0])).toEqual({
      pathname: "/portal/login",
      returnTo: "/waiting-list",
    });
    expect(h.router.push).not.toHaveBeenCalledWith("/portal");
  });

  it("401 z API: logowanie klienta", async () => {
    h.session.data = { user: { id: "client-user" } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const { default: WaitingListPage } = await import("@/app/(client)/waiting-list/page");
    render(<WaitingListPage />);

    await waitFor(() => expect(h.router.push).toHaveBeenCalledTimes(1));
    expect(parsePush(h.router.push.mock.calls[0]![0]).pathname).toBe("/portal/login");
  });
});

describe("/portal przy zamrożonym katalogu", () => {
  it("prowadzi na logowanie klienta, nie na /dla-klientow", async () => {
    const { default: ClientPortalPage } = await import("@/app/(client)/portal/page");
    await expect(ClientPortalPage()).rejects.toThrow("NEXT_REDIRECT:/portal/login");
    expect(h.redirect).toHaveBeenCalledWith("/portal/login");
  });
});

describe("/portal/login: returnTo z przekierowania przechodzi walidację", () => {
  it("zalogowany klient wraca na /appointments", async () => {
    h.hasActiveSession.mockResolvedValue(true);
    const { default: ClientLoginPage } = await import("@/app/(client)/portal/login/page");
    const { returnTo } = parsePush(clientLoginPath("/appointments"));

    await expect(
      ClientLoginPage({ searchParams: Promise.resolve({ returnTo: returnTo ?? undefined }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/appointments");
  });

  it("adres spoza domeny (//) wraca na stronę domową klienta", async () => {
    h.hasActiveSession.mockResolvedValue(true);
    const { default: ClientLoginPage } = await import("@/app/(client)/portal/login/page");

    await expect(
      ClientLoginPage({ searchParams: Promise.resolve({ returnTo: "//evil.example" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/appointments");
  });
});
