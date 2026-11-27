/**
 * Licznik „Nie przyszedł” na karcie klienta i linia o nieobecnościach
 * dopasowanych tylko po numerze telefonu (te nie liczą się do automatycznej
 * blokady). Linia widoczna tylko przy phoneOnlyCount > 0.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientNoShowCount } from "@/components/clients/client-no-show-count";

const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const PHONE_ONLY_LINE = "z rezerwacji dopasowanych tylko po numerze telefonu — te nie liczą się do automatycznej blokady.";

const fetchMock = vi.fn();

function respond(body: unknown, ok = true) {
  fetchMock.mockResolvedValue({ ok, json: async () => body });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ClientNoShowCount", () => {
  it("phoneOnlyCount > 0 → linia z liczbą pod licznikiem", async () => {
    respond({ success: true, data: { clientId: CLIENT_ID, noShowCount: 3, phoneOnlyCount: 2 } });
    render(<ClientNoShowCount clientId={CLIENT_ID} />);

    expect((await screen.findByTestId("client-no-show-count-value")).textContent).toBe("3");
    const line = screen.getByTestId("client-no-show-phone-only");
    expect(line.textContent).toBe(`W tym 2 ${PHONE_ONLY_LINE}`);
    expect(fetchMock).toHaveBeenCalledWith(`/api/clients/${CLIENT_ID}/no-shows`, expect.anything());
  });

  it("phoneOnlyCount 0 → bez linii, licznik widoczny", async () => {
    respond({ success: true, data: { clientId: CLIENT_ID, noShowCount: 2, phoneOnlyCount: 0 } });
    render(<ClientNoShowCount clientId={CLIENT_ID} />);

    expect((await screen.findByTestId("client-no-show-count-value")).textContent).toBe("2");
    expect(screen.queryByTestId("client-no-show-phone-only")).toBeNull();
  });

  it("brak pola phoneOnlyCount albo zła wartość → bez linii, licznik widoczny", async () => {
    respond({ success: true, data: { clientId: CLIENT_ID, noShowCount: 1, phoneOnlyCount: "2" } });
    render(<ClientNoShowCount clientId={CLIENT_ID} />);

    expect((await screen.findByTestId("client-no-show-count-value")).textContent).toBe("1");
    expect(screen.queryByTestId("client-no-show-phone-only")).toBeNull();
  });

  it("błąd trasy → ani licznik, ani linia", async () => {
    respond({ success: false, error: "Nie udało się pobrać liczby nieobecności" }, false);
    render(<ClientNoShowCount clientId={CLIENT_ID} />);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByTestId("client-no-show-count")).toBeNull();
    expect(screen.queryByTestId("client-no-show-phone-only")).toBeNull();
  });
});
