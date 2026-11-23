/**
 * Formularz rejestracji właściciela (RegistrationFlow) a akceptacja regulaminu i DPA
 * oraz widoczność błędów trasy zakładającej salon.
 *
 * Stan publikacji trafia do prawdziwej funkcji `legalAcceptanceForm` jako parametr
 * (bez atrapy modułu dokumentów). Atrapy: router, zapis szkicu formularza,
 * `signUp`, `mutationFetch` i `fetch` listy planów.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RegistrationFlow } from "@/components/auth/registration-flow";
import { mutationFetch } from "@/lib/api-client";
import { signUp } from "@/lib/auth-client";
import {
  LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
  LEGAL_DOCUMENTS,
  legalAcceptanceForm,
  type LegalAcceptanceForm,
  type LegalDocuments,
} from "@/lib/legal/documents";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/hooks/use-form-recovery", () => ({
  useFormRecovery: () => ({
    wasRecovered: false,
    getRecoveredState: () => null,
    saveFormState: () => {},
    clearSavedForm: () => {},
    setDirty: () => {},
  }),
}));

vi.mock("@/lib/auth-client", () => ({
  signUp: { email: vi.fn(async () => ({ data: {}, error: null })) },
  sendVerificationEmail: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(async () => new Response("{}", { status: 200 })),
}));

const TERMS_V = "2026-12-01";
const DPA_V = "2026-12-02";
const PUBLISHED: LegalDocuments = {
  ...LEGAL_DOCUMENTS,
  privacy: { ...LEGAL_DOCUMENTS.privacy, version: "2026-12-03" },
  terms: { ...LEGAL_DOCUMENTS.terms, version: TERMS_V },
  dpa: { ...LEGAL_DOCUMENTS.dpa, version: DPA_V },
};

const SUBMIT = /Utwórz konto/;
const TERMS_BOX = /Akceptuję regulamin/;
const DPA_BOX = /Akceptuję umowę powierzenia/;
const CONFIRMATION = "Konto zostalo utworzone pomyslnie!";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }))
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function renderFlow(legalForm?: LegalAcceptanceForm | null) {
  const extra = legalForm === undefined ? {} : { legalForm };
  render(<RegistrationFlow preselectedPlan={null} {...extra} />);
}

async function fillAccount(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Imie i nazwisko"), "Anna Nowak");
  await user.type(screen.getByLabelText("Email"), "anna@example.com");
  await user.type(screen.getByLabelText("Haslo"), "Haslo12345");
  await user.type(screen.getByLabelText("Powtorz haslo"), "Haslo12345");
}

function sentBody(): Record<string, unknown> {
  const calls = vi.mocked(mutationFetch).mock.calls;
  expect(calls).toHaveLength(1);
  expect(calls[0]?.[0]).toBe("/api/register-subscription");
  return JSON.parse(String(calls[0]?.[1]?.body)) as Record<string, unknown>;
}

describe("flaga wyłączona (wartość z modułu)", () => {
  it("bez pól wyboru; rejestracja przechodzi bez zaznaczeń, żądanie bez pól akceptacji", async () => {
    const user = userEvent.setup();
    renderFlow();

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("link", { name: "regulamin" })).toBeNull();
    await fillAccount(user);
    const submit = screen.getByRole("button", { name: SUBMIT });
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument();
    const body = sentBody();
    expect(body).toEqual({ planSlug: "basic", email: "anna@example.com" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("401 (konto czeka na potwierdzenie e-maila): potwierdzenie bez komunikatu o błędzie", async () => {
    vi.mocked(mutationFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    );
    const user = userEvent.setup();
    renderFlow();

    await fillAccount(user);
    await user.click(screen.getByRole("button", { name: SUBMIT }));

    expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("500 z trasy: konto utworzone, błąd salonu widoczny na potwierdzeniu", async () => {
    vi.mocked(mutationFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: "Failed to create subscription" }), { status: 500 })
    );
    const user = userEvent.setup();
    renderFlow();

    await fillAccount(user);
    await user.click(screen.getByRole("button", { name: SUBMIT }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się założyć salonu");
  });

  it("błąd sieci przy zakładaniu salonu: widoczny, a nie połknięty", async () => {
    vi.mocked(mutationFetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    renderFlow();

    await fillAccount(user);
    await user.click(screen.getByRole("button", { name: SUBMIT }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się założyć salonu");
  });
});

describe("flaga włączona", () => {
  const form = legalAcceptanceForm(true, PUBLISHED);

  it("dwa osobne pola z odnośnikami do /terms i /dpa", () => {
    renderFlow(form);

    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "regulamin" })).toHaveAttribute("href", "/terms");
    expect(
      screen.getByRole("link", { name: "umowę powierzenia przetwarzania danych (DPA)" })
    ).toHaveAttribute("href", "/dpa");
  });

  it("przycisk zablokowany do zaznaczenia obu pól; bez nich konto nie powstaje", async () => {
    const user = userEvent.setup();
    renderFlow(form);
    await fillAccount(user);
    const submit = screen.getByRole("button", { name: SUBMIT });

    expect(submit).toBeDisabled();
    await user.click(screen.getByLabelText(DPA_BOX));
    expect(submit).toBeDisabled();
    await user.click(screen.getByLabelText(TERMS_BOX));
    expect(submit).toBeEnabled();
    await user.click(screen.getByLabelText(DPA_BOX));
    expect(submit).toBeDisabled();
    expect(signUp.email).not.toHaveBeenCalled();
  });

  it("po zaznaczeniu obu: wersje z rejestru i acceptanceSource registration", async () => {
    const user = userEvent.setup();
    renderFlow(form);
    await fillAccount(user);

    await user.click(screen.getByLabelText(TERMS_BOX));
    await user.click(screen.getByLabelText(DPA_BOX));
    await user.click(screen.getByRole("button", { name: SUBMIT }));

    expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument();
    expect(sentBody()).toEqual({
      planSlug: "basic",
      email: "anna@example.com",
      termsVersion: TERMS_V,
      dpaVersion: DPA_V,
      acceptanceSource: "registration",
    });
  });

  it("400 LEGAL_ACCEPTANCE_REQUIRED: komunikat o akceptacji widoczny na potwierdzeniu", async () => {
    vi.mocked(mutationFetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, code: "LEGAL_ACCEPTANCE_REQUIRED", error: "x", details: {} }),
        { status: 400 }
      )
    );
    const user = userEvent.setup();
    renderFlow(form);
    await fillAccount(user);

    await user.click(screen.getByLabelText(TERMS_BOX));
    await user.click(screen.getByLabelText(DPA_BOX));
    await user.click(screen.getByRole("button", { name: SUBMIT }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(LEGAL_ACCEPTANCE_REQUIRED_MESSAGE)
    );
  });
});
