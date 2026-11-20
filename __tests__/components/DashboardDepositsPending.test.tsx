import { act, render, screen, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DashboardDepositsPending } from "@/components/dashboard/dashboard-deposits-pending";
import { RoleProvider } from "@/components/dashboard/role-provider";
import type { SalonRole } from "@/lib/salon-context";

const tabSync = vi.hoisted(() => ({
  resource: null as string | null,
  onRefetch: null as null | (() => void | Promise<void>),
}));

vi.mock("@/hooks/use-tab-sync", () => ({
  useTabSync: (resource: string, onRefetch: () => void | Promise<void>) => {
    tabSync.resource = resource;
    tabSync.onRefetch = onRefetch;
    return { notifyChange: vi.fn() };
  },
}));

const ERROR_TEXT = "Nie udalo sie pobrac wizyt czekajacych na zadatek";

interface ApptOverrides {
  id?: string;
  startTime?: string;
  status?: string;
  depositAmount?: string | null;
  depositPaid?: boolean;
  guestName?: string | null;
  client?: { firstName: string; lastName: string } | null;
  service?: { name: string } | null;
}

function makeAppt(overrides: ApptOverrides = {}) {
  return {
    id: "appt-1",
    salonId: "salon-1",
    startTime: "2026-11-25T10:00:00.000Z",
    endTime: "2026-11-25T11:00:00.000Z",
    status: "scheduled",
    depositAmount: "50.00",
    depositPaid: false,
    guestName: null,
    client: { id: "c-1", firstName: "Anna", lastName: "Nowak" },
    employee: { id: "e-1", firstName: "Ewa", lastName: "Kowal" },
    service: { id: "s-1", name: "Strzyzenie" },
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function okList(items: unknown[]): Response {
  return jsonResponse(200, { success: true, data: items, count: items.length });
}

function fetchMock(): ReturnType<typeof vi.fn> {
  return global.fetch as ReturnType<typeof vi.fn>;
}

function renderCard(role: SalonRole = "owner") {
  return render(
    <RoleProvider role={role}>
      <DashboardDepositsPending />
    </RoleProvider>
  );
}

function rowTexts(): string[] {
  return screen.getAllByTestId("deposits-pending-row").map((row) => row.textContent ?? "");
}

describe("DashboardDepositsPending", () => {
  beforeEach(() => {
    tabSync.resource = null;
    tabSync.onRefetch = null;
    vi.stubGlobal("fetch", vi.fn(async () => okList([])));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each(["scheduled", "confirmed"])(
    "pokazuje wizyte %s z niewplaconym zadatkiem 50.00",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => okList([makeAppt({ status })]))
      );
      renderCard();

      const card = await screen.findByTestId("deposits-pending");
      expect(card).toHaveTextContent("Czekaja na zadatek");
      expect(card).toHaveTextContent("Anna Nowak");
      expect(card).toHaveTextContent("Strzyzenie");
      expect(card).toHaveTextContent("50.00 PLN");
      expect(within(card).getByRole("link", { name: /Otworz kalendarz/ })).toHaveAttribute(
        "href",
        "/dashboard/calendar"
      );
    }
  );

  it("odfiltrowuje wplacone, zerowe, puste i nieaktywne wizyty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okList([
          makeAppt({ id: "keep", client: { firstName: "Zostaje", lastName: "Tu" } }),
          makeAppt({ id: "paid", depositPaid: true, client: { firstName: "Wplacony", lastName: "X" } }),
          makeAppt({ id: "zero", depositAmount: "0.00", client: { firstName: "Zero", lastName: "X" } }),
          makeAppt({ id: "null", depositAmount: null, client: { firstName: "Brak", lastName: "X" } }),
          makeAppt({ id: "c", status: "cancelled", client: { firstName: "Anulowana", lastName: "X" } }),
          makeAppt({ id: "d", status: "completed", client: { firstName: "Zakonczona", lastName: "X" } }),
          makeAppt({ id: "n", status: "no_show", client: { firstName: "Nieobecna", lastName: "X" } }),
        ])
      )
    );
    renderCard();

    await screen.findByTestId("deposits-pending");
    expect(rowTexts()).toHaveLength(1);
    expect(rowTexts()[0]).toContain("Zostaje Tu");
    expect(screen.getByTestId("deposits-pending-count")).toHaveTextContent("1");
  });

  it("sortuje po czasie rosnaco i pokazuje licznik", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okList([
          makeAppt({ id: "late", startTime: "2026-11-27T10:00:00.000Z", client: { firstName: "Trzecia", lastName: "X" } }),
          makeAppt({ id: "early", startTime: "2026-11-21T10:00:00.000Z", client: { firstName: "Pierwsza", lastName: "X" } }),
          makeAppt({ id: "mid", startTime: "2026-11-24T10:00:00.000Z", client: { firstName: "Druga", lastName: "X" } }),
        ])
      )
    );
    renderCard();

    await screen.findByTestId("deposits-pending");
    const rows = rowTexts();
    expect(rows[0]).toContain("Pierwsza");
    expect(rows[1]).toContain("Druga");
    expect(rows[2]).toContain("Trzecia");
    expect(screen.getByTestId("deposits-pending-count")).toHaveTextContent("3");
  });

  it("rezerwacja goscia bez klienta: imie z rezerwacji", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okList([makeAppt({ client: null, guestName: "Gosc Jan" })]))
    );
    renderCard();

    expect(await screen.findByTestId("deposits-pending")).toHaveTextContent("Gosc Jan");
  });

  it("pusta lista po filtrze: karta niewyrenderowana", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okList([makeAppt({ depositPaid: true })]))
    );
    renderCard();

    await waitFor(() => expect(fetchMock()).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByTestId("deposits-pending")).not.toBeInTheDocument();
  });

  it("blad 500: tekst bledu z pola error w karcie", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(500, { success: false, error: "Failed to fetch appointments" }))
    );
    renderCard();

    const card = await screen.findByTestId("deposits-pending");
    expect(card).toHaveTextContent("Failed to fetch appointments");
    expect(screen.queryByTestId("deposits-pending-count")).not.toBeInTheDocument();
  });

  it("blad 500 bez JSON: tekst ogolny", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 500,
            json: async () => {
              throw new SyntaxError("Unexpected token <");
            },
          }) as unknown as Response
      )
    );
    renderCard();

    expect(await screen.findByTestId("deposits-pending")).toHaveTextContent(ERROR_TEXT);
  });

  it("blad sieci: tekst ogolny", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    renderCard();

    expect(await screen.findByTestId("deposits-pending")).toHaveTextContent(ERROR_TEXT);
  });

  it("rola receptionist widzi karte", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okList([makeAppt()])));
    renderCard("receptionist");

    expect(await screen.findByTestId("deposits-pending")).toBeInTheDocument();
  });

  it("rola employee: brak karty i brak zapytania, takze po zdarzeniu kanalu", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okList([makeAppt()])));
    renderCard("employee");

    await act(async () => {
      await tabSync.onRefetch?.();
    });
    expect(fetchMock()).not.toHaveBeenCalled();
    expect(screen.queryByTestId("deposits-pending")).not.toBeInTheDocument();
  });

  it("zdarzenie kanalu appointments: ponowne pobranie, oznaczona wizyta znika", async () => {
    const first = [
      makeAppt({ id: "a", client: { firstName: "Oznaczana", lastName: "X" } }),
      makeAppt({ id: "b", startTime: "2026-11-26T10:00:00.000Z", client: { firstName: "Zostaje", lastName: "Y" } }),
    ];
    const second = [
      makeAppt({ id: "a", depositPaid: true, client: { firstName: "Oznaczana", lastName: "X" } }),
      first[1],
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(okList(first)).mockResolvedValueOnce(okList(second))
    );
    renderCard();

    await screen.findByTestId("deposits-pending");
    expect(rowTexts()).toHaveLength(2);
    expect(tabSync.resource).toBe("appointments");

    await act(async () => {
      await tabSync.onRefetch?.();
    });

    await waitFor(() => expect(rowTexts()).toHaveLength(1));
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    expect(rowTexts()[0]).toContain("Zostaje Y");
    expect(screen.queryByText("Oznaczana X")).not.toBeInTheDocument();
  });

  it("ostatnia wizyta oznaczona po zdarzeniu kanalu: karta znika", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(okList([makeAppt()]))
        .mockResolvedValueOnce(okList([makeAppt({ depositPaid: true })]))
    );
    renderCard();

    await screen.findByTestId("deposits-pending");
    await act(async () => {
      await tabSync.onRefetch?.();
    });

    await waitFor(() => expect(screen.queryByTestId("deposits-pending")).not.toBeInTheDocument());
  });

  it("zapytanie: GET /api/appointments z startDate = poczatek dzisiejszego dnia", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 20, 15, 42, 10));
    try {
      renderCard();
      await waitFor(() => expect(fetchMock()).toHaveBeenCalledTimes(1));

      const [url, init] = fetchMock().mock.calls[0] as [string, RequestInit];
      const parsed = new URL(url, "http://localhost");
      expect(parsed.pathname).toBe("/api/appointments");
      expect([...parsed.searchParams.keys()]).toEqual(["startDate"]);
      expect(parsed.searchParams.get("startDate")).toBe(
        new Date(2026, 10, 20, 0, 0, 0, 0).toISOString()
      );
      expect(init.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
    }
  });

  it("odmontowanie przerywa zapytanie", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      })
    );
    const { unmount } = renderCard();
    await waitFor(() => expect(fetchMock()).toHaveBeenCalledTimes(1));

    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
