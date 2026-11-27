/**
 * Strony portalu klienta bez sesji kierują na logowanie klienta
 * (`/portal/login?returnTo=…`), nie na `/login`. `/login` to logowanie panelu
 * salonu: prowadzi na `/dashboard`, a konto klienta bez salonu zobaczyłoby
 * tam zakładanie salonu. Dotyczy to klienta po rejestracji z wymaganym
 * potwierdzeniem e-maila — trafia na „Moje wizyty” bez sesji.
 *
 * Przekierowanie tylko przy pewnym braku sesji (bez błędu albo 401). Przy
 * innym błędzie pobrania sesji ciasteczko zostaje, `/portal/login` odesłałby
 * z powrotem i powstałaby pętla, więc strona pokazuje komunikat z ponowieniem.
 *
 * Atrapy: `next/navigation`, `useSession`, `fetch`, sesja serwerowa.
 */
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientLoginPath } from "@/lib/features";

const h = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  session: {
    data: null as { user: { id: string } } | null,
    isPending: false,
    error: null as { status?: number } | null,
    refetch: vi.fn<(params?: { query?: Record<string, unknown> }) => Promise<void>>(async () => {}),
  },
  // Sesja serwerowa sprawdzona w bazie; `null` = brak ważnej sesji.
  getOptionalSession: vi.fn(async (): Promise<{ user: { id: string } } | null> => null),
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
vi.mock("@/lib/session", () => ({ getOptionalSession: h.getOptionalSession }));
vi.mock("@/components/auth/sign-in-button", () => ({
  SignInButton: () => <div data-testid="sign-in-form" />,
}));

/** Adres przekierowania rozłożony na ścieżkę i `returnTo`. */
function parsePush(call: unknown): { pathname: string; returnTo: string | null } {
  const url = new URL(String(call), "http://localhost");
  return { pathname: url.pathname, returnTo: url.searchParams.get("returnTo") };
}

beforeEach(() => {
  h.session.data = null;
  h.session.isPending = false;
  h.session.error = null;
  h.session.refetch.mockImplementation(async () => {});
  h.getOptionalSession.mockResolvedValue(null);
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

  it("401 z API i brak sesji po odświeżeniu: jedno przekierowanie na logowanie klienta", async () => {
    h.session.data = { user: { id: "client-user" } };
    // Serwer potwierdza brak sesji: odświeżenie czyści ją w atomie.
    h.session.refetch.mockImplementation(async () => {
      h.session.data = null;
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const { default: WaitingListPage } = await import("@/app/(client)/waiting-list/page");
    render(<WaitingListPage />);

    await waitFor(() => expect(h.router.push).toHaveBeenCalledTimes(1));
    expect(h.session.refetch).toHaveBeenCalledWith({ query: { disableCookieCache: true } });
    expect(parsePush(h.router.push.mock.calls[0]![0])).toEqual({
      pathname: "/portal/login",
      returnTo: "/waiting-list",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("401 z API, a sesja po odświeżeniu nadal jest: komunikat bez przekierowania i bez pętli", async () => {
    h.session.data = { user: { id: "client-user" } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const { default: WaitingListPage } = await import("@/app/(client)/waiting-list/page");
    render(<WaitingListPage />);

    await waitFor(() => screen.getByText("Nie udało się potwierdzić logowania. Spróbuj ponownie za chwilę."));
    expect(h.session.refetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(h.router.push).not.toHaveBeenCalled();

    // Ponowienie pobiera wpisy jeszcze raz, nadal bez przekierowania.
    fireEvent.click(screen.getByRole("button", { name: /Spróbuj ponownie/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(h.router.push).not.toHaveBeenCalled();
  });

  it("błąd sprawdzenia sesji inny niż 401: komunikat z ponowieniem, bez przekierowania", async () => {
    h.session.error = { status: 503 };
    const { default: WaitingListPage } = await import("@/app/(client)/waiting-list/page");
    render(<WaitingListPage />);

    screen.getByText("Nie udało się sprawdzić logowania. Spróbuj ponownie.");
    expect(h.router.push).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("błąd pobrania sesji inny niż 401 (ciasteczko zostaje, logowanie odesłałoby z powrotem)", () => {
  it("„Moje wizyty” przy 429: bez przekierowania, komunikat i przycisk ponowienia", async () => {
    h.session.error = { status: 429 };
    const { default: ClientAppointmentsPage } = await import("@/app/(client)/appointments/page");
    render(<ClientAppointmentsPage />);

    screen.getByText("Nie udało się sprawdzić logowania. Spróbuj ponownie.");
    fireEvent.click(screen.getByRole("button", { name: /Spróbuj ponownie/ }));
    expect(h.session.refetch).toHaveBeenCalledTimes(1);
    expect(h.router.push).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("„Moje wizyty” przy błędzie sieci (bez kodu): bez przekierowania", async () => {
    // Zerwane połączenie daje błąd bez statusu HTTP.
    h.session.error = {};
    const { default: ClientAppointmentsPage } = await import("@/app/(client)/appointments/page");
    render(<ClientAppointmentsPage />);

    screen.getByTestId("session-check-error");
    expect(h.router.push).not.toHaveBeenCalled();
  });

  it("„Moje wizyty” przy 401: przekierowanie na logowanie klienta", async () => {
    h.session.error = { status: 401 };
    const { default: ClientAppointmentsPage } = await import("@/app/(client)/appointments/page");
    render(<ClientAppointmentsPage />);

    await waitFor(() => expect(h.router.push).toHaveBeenCalledTimes(1));
    expect(parsePush(h.router.push.mock.calls[0]![0])).toEqual({
      pathname: "/portal/login",
      returnTo: "/appointments",
    });
    expect(screen.queryByTestId("session-check-error")).toBeNull();
  });

  it("szczegóły wizyty przy 500: bez przekierowania, stan błędu sesji z ponowieniem", async () => {
    h.session.error = { status: 500 };
    const { useAppointmentDetail } = await import(
      "@/app/(client)/appointments/[id]/_hooks/use-appointment-detail"
    );
    const { result } = renderHook(() => useAppointmentDetail());

    expect(result.current.sessionCheckFailed).toBe(true);
    result.current.retrySessionCheck();
    expect(h.session.refetch).toHaveBeenCalledTimes(1);
    expect(h.router.push).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("strona szczegółów wizyty przy 429 pokazuje komunikat", async () => {
    h.session.error = { status: 429 };
    const { default: AppointmentDetailPage } = await import("@/app/(client)/appointments/[id]/page");
    render(<AppointmentDetailPage />);

    screen.getByText("Nie udało się sprawdzić logowania. Spróbuj ponownie.");
    screen.getByRole("button", { name: /Spróbuj ponownie/ });
    expect(h.router.push).not.toHaveBeenCalled();
  });

  it("szczegóły wizyty przy 401: przekierowanie na logowanie klienta", async () => {
    h.session.error = { status: 401 };
    const { useAppointmentDetail } = await import(
      "@/app/(client)/appointments/[id]/_hooks/use-appointment-detail"
    );
    const { result } = renderHook(() => useAppointmentDetail());

    await waitFor(() => expect(h.router.push).toHaveBeenCalledTimes(1));
    expect(result.current.sessionCheckFailed).toBe(false);
    expect(parsePush(h.router.push.mock.calls[0]![0]).returnTo).toBe("/appointments/appt-1");
  });

  it("ulubione przy 429: bez przekierowania, komunikat", async () => {
    h.session.error = { status: 429 };
    const { default: FavoritesPage } = await import("@/app/(client)/favorites/page");
    render(<FavoritesPage />);

    screen.getByText("Nie udało się sprawdzić logowania. Spróbuj ponownie.");
    expect(h.router.push).not.toHaveBeenCalled();
  });

  it("ulubione bez sesji i bez błędu: przekierowanie na logowanie klienta", async () => {
    const { default: FavoritesPage } = await import("@/app/(client)/favorites/page");
    render(<FavoritesPage />);

    await waitFor(() => expect(h.router.push).toHaveBeenCalledTimes(1));
    expect(parsePush(h.router.push.mock.calls[0]![0]).returnTo).toBe("/favorites");
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
    h.getOptionalSession.mockResolvedValue({ user: { id: "client-user" } });
    const { default: ClientLoginPage } = await import("@/app/(client)/portal/login/page");
    const { returnTo } = parsePush(clientLoginPath("/appointments"));

    // Przy exactOptionalPropertyTypes pole nie może dostać jawnego `undefined`.
    const searchParams = returnTo === null ? {} : { returnTo };

    await expect(ClientLoginPage({ searchParams: Promise.resolve(searchParams) })).rejects.toThrow(
      "NEXT_REDIRECT:/appointments",
    );
  });

  it("adres spoza domeny (//) wraca na stronę domową klienta", async () => {
    h.getOptionalSession.mockResolvedValue({ user: { id: "client-user" } });
    const { default: ClientLoginPage } = await import("@/app/(client)/portal/login/page");

    await expect(
      ClientLoginPage({ searchParams: Promise.resolve({ returnTo: "//evil.example" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/appointments");
  });
});

describe("/portal/login: ciasteczko jest, ważnej sesji nie ma (np. nieważny podpis)", () => {
  // Serwer przy złym podpisie zwraca brak sesji i nie kasuje ciasteczka. Strona
  // portalu kieruje tu z `returnTo`; odesłanie z powrotem tworzyłoby pętlę.
  it("bez przekierowania, widać formularz logowania", async () => {
    h.getOptionalSession.mockResolvedValue(null);
    const { default: ClientLoginPage } = await import("@/app/(client)/portal/login/page");

    const page = await ClientLoginPage({
      searchParams: Promise.resolve({ returnTo: "/appointments" }),
    });
    render(page);

    expect(h.getOptionalSession).toHaveBeenCalledTimes(1);
    expect(h.redirect).not.toHaveBeenCalled();
    screen.getByText("Konto klienta");
    screen.getByTestId("sign-in-form");
  });

  it("bez returnTo też bez przekierowania na stronę domową klienta", async () => {
    const { default: ClientLoginPage } = await import("@/app/(client)/portal/login/page");

    render(await ClientLoginPage({ searchParams: Promise.resolve({}) }));

    expect(h.redirect).not.toHaveBeenCalled();
    screen.getByTestId("sign-in-form");
  });

  it("ważna sesja nadal przekierowuje na returnTo", async () => {
    h.getOptionalSession.mockResolvedValue({ user: { id: "client-user" } });
    const { default: ClientLoginPage } = await import("@/app/(client)/portal/login/page");

    await expect(
      ClientLoginPage({ searchParams: Promise.resolve({ returnTo: "/favorites" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/favorites");
    expect(h.redirect).toHaveBeenCalledTimes(1);
  });
});
