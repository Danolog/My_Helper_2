import { inspect } from "node:util";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlikDepositSection } from "@/app/dashboard/settings/payments/_components/blik-deposit-section";
import PaymentSettingsPage from "@/app/dashboard/settings/payments/page";
import { RoleProvider } from "@/components/dashboard/role-provider";

const { toastMock, consentOverride } = vi.hoisted(() => ({
  toastMock: { success: vi.fn(), error: vi.fn() },
  // undefined = prawdziwa wartość stałej z modułu; napis/null = podmiana w teście.
  consentOverride: { href: undefined as string | null | undefined },
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/lib/blik-consent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blik-consent")>();
  return {
    ...actual,
    get BLIK_PRIVACY_POLICY_HREF() {
      return consentOverride.href === undefined
        ? actual.BLIK_PRIVACY_POLICY_HREF
        : consentOverride.href;
    },
  };
});

const PHONE = "+48600700800";
const POLICY_HREF = "/polityka-prywatnosci";

type Settings = {
  blikPhone: string | null;
  blikConsentAt: string | null;
  blikConsentVersion: string | null;
  consentCurrent: boolean;
};

const EMPTY: Settings = {
  blikPhone: null,
  blikConsentAt: null,
  blikConsentVersion: null,
  consentCurrent: false,
};

let actualConsent: typeof import("@/lib/blik-consent");

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function currentSettings(): Settings {
  return {
    blikPhone: PHONE,
    blikConsentAt: "2026-11-21T10:00:00.000Z",
    blikConsentVersion: actualConsent.BLIK_CONSENT_VERSION,
    consentCurrent: true,
  };
}

const fetchMock = vi.fn();

/** Pamięć przeglądarki podmieniona na mapę — test sprawdza, że numer do niej nie trafia. */
const storageItems = new Map<string, string>();
const fakeStorage = {
  get length() {
    return storageItems.size;
  },
  key: (i: number) => [...storageItems.keys()][i] ?? null,
  getItem: (k: string) => storageItems.get(k) ?? null,
  setItem: (k: string, v: string) => void storageItems.set(k, String(v)),
  removeItem: (k: string) => void storageItems.delete(k),
  clear: () => storageItems.clear(),
};
type ConsoleSpy = { mock: { calls: unknown[][] }; mockRestore: () => void };
let consoleSpies: ConsoleSpy[] = [];

/** Kolejne odpowiedzi fetch, w kolejności wywołań. */
function queueResponses(...responses: Array<Response | Error>) {
  for (const r of responses) {
    if (r instanceof Error) fetchMock.mockRejectedValueOnce(r);
    else fetchMock.mockResolvedValueOnce(r);
  }
}

function getOk(data: Settings) {
  return jsonResponse(200, { success: true, data });
}

type FetchCall = [string, RequestInit | undefined];

function putCalls(): FetchCall[] {
  return (fetchMock.mock.calls as FetchCall[]).filter(([, init]) => init?.method === "PUT");
}

function putBody(index = 0) {
  const call = putCalls()[index];
  if (!call) throw new Error(`brak żądania PUT nr ${index}`);
  return JSON.parse(String(call[1]?.body));
}

async function fillAndSave(user: ReturnType<typeof userEvent.setup>, phone = PHONE) {
  const input = await screen.findByLabelText("Numer telefonu BLIK");
  await user.clear(input);
  await user.type(input, phone);
  await user.click(screen.getByLabelText(actualConsent.BLIK_CONSENT_LABEL));
  await user.click(screen.getByRole("button", { name: "Zapisz numer" }));
}

function allConsoleArgs(): string {
  return consoleSpies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((a) => (typeof a === "string" ? a : inspect(a, { depth: null }))).join(" "))
    .join("\n");
}

beforeEach(async () => {
  actualConsent = await vi.importActual<typeof import("@/lib/blik-consent")>(
    "@/lib/blik-consent"
  );
  consentOverride.href = POLICY_HREF;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  storageItems.clear();
  vi.stubGlobal("localStorage", fakeStorage);
  vi.stubGlobal("sessionStorage", fakeStorage);
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m) as unknown as ConsoleSpy
  );
});

afterEach(() => {
  // Numer nie trafia do konsoli, toastów, pamięci przeglądarki ani adresu strony.
  expect(allConsoleArgs()).not.toContain(PHONE);
  expect(allConsoleArgs()).not.toContain("600700800");
  const toastArgs = JSON.stringify([
    ...toastMock.success.mock.calls,
    ...toastMock.error.mock.calls,
  ]);
  expect(toastArgs).not.toContain("600700800");
  expect(JSON.stringify([...storageItems])).not.toContain("600700800");
  expect(window.location.href).not.toContain("600700800");
  for (const spy of consoleSpies) spy.mockRestore();
  vi.unstubAllGlobals();
});

describe("BlikDepositSection — formularz zapisu (zapis otwarty)", () => {
  it("renderuje 8 zdań i etykietę dokładnie ze stałych, każde zdanie w osobnym akapicie", async () => {
    queueResponses(getOk(EMPTY));
    render(<BlikDepositSection />);

    const box = await screen.findByTestId("blik-consent-sentences");
    const paragraphs = Array.from(box.querySelectorAll("p")).map((p) => p.textContent);
    expect(actualConsent.BLIK_CONSENT_SENTENCES).toHaveLength(8);
    expect(paragraphs.slice(0, 8)).toEqual([...actualConsent.BLIK_CONSENT_SENTENCES]);
    expect(screen.getByText(actualConsent.BLIK_CONSENT_LABEL).tagName).toBe("LABEL");
  });

  it("tekst karty: zdanie o numerze służbowym, link do polityki zaraz pod zdaniem o administratorze, bez „Zgadzam się” i bez słowa „zgoda”", async () => {
    queueResponses(getOk(EMPTY));
    render(<BlikDepositSection />);

    const card = await screen.findByTestId("blik-deposit-section");
    await screen.findByLabelText(actualConsent.BLIK_CONSENT_LABEL);
    const text = card.textContent ?? "";
    expect(text).toContain("Najlepiej podaj numer służbowy, nie prywatny.");
    expect(text).not.toMatch(/zgadzam się/i);
    expect(text).not.toMatch(/zgod/i);

    const paragraphs = Array.from(
      screen.getByTestId("blik-consent-sentences").querySelectorAll("p")
    );
    const adminIndex = paragraphs.findIndex((p) =>
      p.textContent?.includes("administratorem danych jest MyHelper")
    );
    expect(adminIndex).toBeGreaterThanOrEqual(0);
    expect(
      paragraphs[adminIndex + 1]?.querySelector("a")?.getAttribute("href")
    ).toBe(POLICY_HREF);
  });

  it("checkbox zgody jest odznaczony na starcie, a zapis nieaktywny bez numeru i bez zgody", async () => {
    const user = userEvent.setup();
    queueResponses(getOk(EMPTY));
    render(<BlikDepositSection />);

    const checkbox = await screen.findByLabelText(actualConsent.BLIK_CONSENT_LABEL);
    const save = screen.getByRole("button", { name: "Zapisz numer" });
    expect(checkbox).not.toBeChecked();
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("Numer telefonu BLIK"), PHONE);
    expect(save).toBeDisabled();

    await user.click(checkbox);
    expect(save).toBeEnabled();

    await user.clear(screen.getByLabelText("Numer telefonu BLIK"));
    expect(save).toBeDisabled();
  });

  it("pole numeru ma typ tel, autouzupełnianie tel i nie ma atrybutu name", async () => {
    queueResponses(getOk(EMPTY));
    render(<BlikDepositSection />);

    const input = await screen.findByLabelText("Numer telefonu BLIK");
    expect(input).toHaveAttribute("type", "tel");
    expect(input).toHaveAttribute("autocomplete", "tel");
    expect(input).not.toHaveAttribute("name");
    expect(screen.getByLabelText(actualConsent.BLIK_CONSENT_LABEL)).not.toHaveAttribute("name");
  });

  it("zapis wysyła numer, zgodę i wersję równą stałej; po 200 checkbox wraca do odznaczonego", async () => {
    const user = userEvent.setup();
    queueResponses(getOk(EMPTY), getOk(currentSettings()));
    render(<BlikDepositSection />);

    await fillAndSave(user);

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(putCalls()[0]?.[0]).toBe("/api/salon/blik-deposit");
    expect(putBody()).toEqual({
      blikPhone: PHONE,
      consent: true,
      consentVersion: actualConsent.BLIK_CONSENT_VERSION,
    });

    expect(await screen.findByTestId("blik-saved-phone")).toHaveTextContent(PHONE);
    expect(toastMock.success).toHaveBeenCalledWith("Numer BLIK zapisany.");

    await user.click(screen.getByRole("button", { name: "Zmień numer" }));
    expect(screen.getByLabelText(actualConsent.BLIK_CONSENT_LABEL)).not.toBeChecked();
    expect(screen.getByLabelText("Numer telefonu BLIK")).toHaveValue(PHONE);
    expect(screen.getByRole("button", { name: "Zapisz numer" })).toBeDisabled();
  });

  it("400 pokazuje komunikaty serwera przy polach i nie pokazuje toastu", async () => {
    const user = userEvent.setup();
    queueResponses(
      getOk(EMPTY),
      jsonResponse(400, {
        success: false,
        error: "Validation failed",
        details: {
          blikPhone: "Numer BLIK musi byc numerem komorkowym",
          consentVersion: "Brak wersji treści potwierdzenia. Odśwież stronę",
        },
      })
    );
    render(<BlikDepositSection />);

    await fillAndSave(user, "221234567");

    expect(await screen.findByText("Numer BLIK musi byc numerem komorkowym")).toBeInTheDocument();
    expect(screen.getByText("Brak wersji treści potwierdzenia. Odśwież stronę")).toBeInTheDocument();
    expect(screen.getByLabelText("Numer telefonu BLIK")).toHaveAttribute("aria-invalid", "true");
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it("409 z kodem nieaktualnej wersji pokazuje prośbę o odświeżenie strony", async () => {
    const user = userEvent.setup();
    queueResponses(
      getOk(EMPTY),
      jsonResponse(409, { success: false, code: actualConsent.BLIK_CONSENT_VERSION_STALE })
    );
    render(<BlikDepositSection />);

    await fillAndSave(user);

    expect(
      await screen.findByText("Treść potwierdzenia została zaktualizowana. Odśwież stronę.")
    ).toBeInTheDocument();
    expect(screen.getByRole("alert").textContent ?? "").not.toMatch(/zgod/i);
    expect(screen.getByTestId("blik-deposit-section").textContent ?? "").not.toMatch(/zgod/i);
    expect(screen.getByRole("button", { name: "Odśwież stronę" })).toBeInTheDocument();
    expect(screen.getByLabelText(actualConsent.BLIK_CONSENT_LABEL)).not.toBeChecked();
  });

  it("409 z kodem zamkniętego zapisu przechodzi w stan zamkniętego zapisu", async () => {
    const user = userEvent.setup();
    queueResponses(
      getOk(EMPTY),
      jsonResponse(409, { success: false, code: actualConsent.BLIK_SETTINGS_NOT_AVAILABLE })
    );
    render(<BlikDepositSection />);

    await fillAndSave(user);

    expect(await screen.findByTestId("blik-save-closed")).toBeInTheDocument();
    expect(screen.queryByLabelText("Numer telefonu BLIK")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zapisz numer" })).not.toBeInTheDocument();
    expect(screen.getByTestId("blik-consent-sentences")).toBeInTheDocument();
  });

  it("409 bez znanego kodu i 500 dają ogólny toast", async () => {
    const user = userEvent.setup();
    queueResponses(
      getOk(EMPTY),
      jsonResponse(409, { success: false, code: "INNY" }),
      jsonResponse(500, { success: false, error: "x" })
    );
    render(<BlikDepositSection />);

    await fillAndSave(user);
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Nie udało się zapisać numeru BLIK. Spróbuj ponownie."
      )
    );

    // Po błędzie bez odpowiedzi 200 zgoda zostaje zaznaczona — ponowienie bez ponownego klikania.
    expect(screen.getByLabelText(actualConsent.BLIK_CONSENT_LABEL)).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Zapisz numer" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(2));
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("błąd sieci przy zapisie daje ogólny toast", async () => {
    const user = userEvent.setup();
    queueResponses(getOk(EMPTY), new Error("network"));
    render(<BlikDepositSection />);

    await fillAndSave(user);
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Nie udało się zapisać numeru BLIK. Spróbuj ponownie."
      )
    );
  });

  it("401 i 403 przy zapisie dają osobne komunikaty", async () => {
    const user = userEvent.setup();
    queueResponses(
      getOk(EMPTY),
      jsonResponse(401, { success: false }),
      jsonResponse(403, { success: false })
    );
    render(<BlikDepositSection />);

    await fillAndSave(user);
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Sesja wygasła. Zaloguj się ponownie.")
    );

    await user.click(screen.getByRole("button", { name: "Zapisz numer" }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Brak uprawnień do zmiany numeru BLIK.")
    );
  });

  it("numer bez aktualnej zgody (brak wersji): ostrzeżenie, wpisany numer, odznaczona zgoda, usunięcie dostępne", async () => {
    queueResponses(
      getOk({
        blikPhone: PHONE,
        blikConsentAt: "2026-11-20T10:00:00.000Z",
        blikConsentVersion: null,
        consentCurrent: false,
      })
    );
    render(<BlikDepositSection />);

    expect(
      await screen.findByText("Treść potwierdzenia się zmieniła. Przeczytaj ją i zaznacz pole ponownie.")
    ).toBeInTheDocument();
    expect(screen.getByRole("status").textContent ?? "").not.toMatch(/zgod/i);
    expect(screen.getByTestId("blik-deposit-section").textContent ?? "").not.toMatch(/zgod/i);
    expect(screen.getByLabelText("Numer telefonu BLIK")).toHaveValue(PHONE);
    expect(screen.getByLabelText(actualConsent.BLIK_CONSENT_LABEL)).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Usuń numer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zmień numer" })).not.toBeInTheDocument();
  });

  it("usunięcie wysyła { blikPhone: null } dopiero po potwierdzeniu w oknie", async () => {
    const user = userEvent.setup();
    queueResponses(getOk(currentSettings()), getOk(EMPTY));
    render(<BlikDepositSection />);

    await user.click(await screen.findByRole("button", { name: "Usuń numer" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(putCalls()).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Usuń numer" }));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(putBody()).toEqual({ blikPhone: null });
    expect(toastMock.success).toHaveBeenCalledWith("Numer BLIK usunięty.");
    expect(await screen.findByLabelText("Numer telefonu BLIK")).toHaveValue("");
    expect(screen.queryByTestId("blik-saved-phone")).not.toBeInTheDocument();
  });

  it("anulowanie okna usunięcia nie wysyła żądania", async () => {
    const user = userEvent.setup();
    queueResponses(getOk(currentSettings()));
    render(<BlikDepositSection />);

    await user.click(await screen.findByRole("button", { name: "Usuń numer" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Anuluj" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(putCalls()).toHaveLength(0);
    expect(screen.getByTestId("blik-saved-phone")).toHaveTextContent(PHONE);
  });

  it("link do polityki prywatności renderuje się przy ustawionym adresie", async () => {
    queueResponses(getOk(EMPTY));
    render(<BlikDepositSection />);

    const link = await screen.findByRole("link", { name: "Polityka prywatności" });
    expect(link).toHaveAttribute("href", POLICY_HREF);
  });
});

describe("BlikDepositSection — odczyt ustawień", () => {
  it("pokazuje stan ładowania podczas odczytu", async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    render(<BlikDepositSection />);
    expect(screen.getByText("Ładowanie ustawień…")).toBeInTheDocument();
  });

  it("500 przy odczycie pokazuje błąd i ponowienie, które ponawia odczyt", async () => {
    const user = userEvent.setup();
    queueResponses(jsonResponse(500, { success: false }), getOk(EMPTY));
    render(<BlikDepositSection />);

    await user.click(await screen.findByRole("button", { name: "Spróbuj ponownie" }));

    expect(await screen.findByLabelText("Numer telefonu BLIK")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("błąd sieci przy odczycie pokazuje ponowienie", async () => {
    queueResponses(new Error("network"));
    render(<BlikDepositSection />);
    expect(await screen.findByRole("button", { name: "Spróbuj ponownie" })).toBeInTheDocument();
  });

  it("404 przy odczycie pokazuje brak salonu", async () => {
    queueResponses(jsonResponse(404, { success: false, error: "Salon not found" }));
    render(<BlikDepositSection />);
    expect(await screen.findByText("Nie znaleziono salonu.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spróbuj ponownie" })).not.toBeInTheDocument();
  });
});

describe("BlikDepositSection — zapis zamknięty przy prawdziwej stałej", () => {
  beforeEach(() => {
    consentOverride.href = undefined;
  });

  it("prawdziwa stała adresu polityki jest null", () => {
    expect(actualConsent.BLIK_PRIVACY_POLICY_HREF).toBeNull();
  });

  it("bez numeru: zdania widoczne, brak pola i aktywnego zapisu, brak linku do polityki", async () => {
    queueResponses(getOk(EMPTY));
    render(<BlikDepositSection />);

    expect(await screen.findByTestId("blik-save-closed")).toBeInTheDocument();
    const box = screen.getByTestId("blik-consent-sentences");
    const paragraphs = Array.from(box.querySelectorAll("p")).map((p) => p.textContent);
    expect(paragraphs).toEqual([...actualConsent.BLIK_CONSENT_SENTENCES]);
    const cardText = screen.getByTestId("blik-deposit-section").textContent ?? "";
    expect(cardText).toContain("Najlepiej podaj numer służbowy, nie prywatny.");
    expect(cardText).not.toMatch(/zgadzam się/i);
    expect(cardText).not.toMatch(/zgod/i);
    expect(screen.queryByLabelText("Numer telefonu BLIK")).not.toBeInTheDocument();
    const save = screen.queryByRole("button", { name: "Zapisz numer" });
    if (save) expect(save).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Polityka prywatności" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usuń numer" })).not.toBeInTheDocument();
  });

  it("z zapisanym numerem: numer widoczny, „Usuń numer” dostępne, bez „Zmień numer”", async () => {
    const user = userEvent.setup();
    queueResponses(getOk(currentSettings()), getOk(EMPTY));
    render(<BlikDepositSection />);

    expect(await screen.findByTestId("blik-saved-phone")).toHaveTextContent(PHONE);
    expect(screen.getByText(/^Potwierdzono: /)).toBeInTheDocument();
    expect(screen.getByTestId("blik-deposit-section").textContent ?? "").not.toMatch(/zgod/i);
    expect(screen.getByTestId("blik-save-closed")).toBeInTheDocument();
    expect(screen.getByTestId("blik-consent-sentences")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zmień numer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zapisz numer" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Usuń numer" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Usuń numer" }));

    await waitFor(() => expect(putCalls()).toHaveLength(1));
    expect(putBody()).toEqual({ blikPhone: null });
    await waitFor(() =>
      expect(screen.queryByTestId("blik-saved-phone")).not.toBeInTheDocument()
    );
  });

  it("numer bez aktualnej zgody (brak wersji): bez formularza zgody, ale z „Usuń numer”", async () => {
    queueResponses(
      getOk({
        blikPhone: PHONE,
        blikConsentAt: null,
        blikConsentVersion: null,
        consentCurrent: false,
      })
    );
    render(<BlikDepositSection />);

    expect(await screen.findByRole("button", { name: "Usuń numer" })).toBeInTheDocument();
    expect(screen.queryByLabelText(actualConsent.BLIK_CONSENT_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zapisz numer" })).not.toBeInTheDocument();
  });
});

describe("Strona ustawień płatności", () => {
  it("właściciel widzi nagłówek i sekcję zadatków BLIK, bez diagnostyki Stripe", async () => {
    queueResponses(getOk(EMPTY));
    render(
      <RoleProvider role="owner">
        <PaymentSettingsPage />
      </RoleProvider>
    );

    expect(screen.getByRole("heading", { name: "Płatności i zadatki" })).toBeInTheDocument();
    expect(await screen.findByTestId("blik-deposit-section")).toBeInTheDocument();
    expect(screen.queryByText(/Stripe/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/salon/blik-deposit");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/stripe"))).toBe(false);
  });

  it.each(["receptionist", "employee"] as const)(
    "rola %s widzi brak uprawnień i nie odczytuje ustawień",
    (role) => {
      render(
        <RoleProvider role={role}>
          <PaymentSettingsPage />
        </RoleProvider>
      );

      expect(screen.getByText("Brak uprawnien do tej sekcji")).toBeInTheDocument();
      expect(screen.queryByTestId("blik-deposit-section")).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );
});
