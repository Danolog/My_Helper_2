/**
 * Zakładanie salonu z panelu (CreateSalonPrompt) a akceptacja regulaminu i DPA.
 *
 * Tu powstaje salon po potwierdzeniu e-maila i po logowaniu Google, więc to główne
 * miejsce akceptacji. Stan publikacji trafia do prawdziwej funkcji
 * `legalAcceptanceForm` jako parametr (bez atrapy modułu dokumentów); atrapą jest
 * tylko `mutationFetch`.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateSalonPrompt } from "@/components/dashboard/create-salon-prompt";
import { mutationFetch } from "@/lib/api-client";
import {
  LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
  LEGAL_DOCUMENTS,
  legalAcceptanceForm,
  type LegalAcceptanceForm,
  type LegalDocuments,
} from "@/lib/legal/documents";

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(async () => ({ json: async () => ({ success: true }) })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const TERMS_V = "2026-12-01";
const DPA_V = "2026-12-02";
const PUBLISHED: LegalDocuments = {
  ...LEGAL_DOCUMENTS,
  privacy: { ...LEGAL_DOCUMENTS.privacy, version: "2026-12-03" },
  terms: { ...LEGAL_DOCUMENTS.terms, version: TERMS_V },
  dpa: { ...LEGAL_DOCUMENTS.dpa, version: DPA_V },
};

const CREATE_BUTTON = /Utworz salon z/;
const TERMS_BOX = /Akceptuję regulamin/;
const DPA_BOX = /Akceptuję umowę powierzenia/;

function renderPrompt(legalForm?: LegalAcceptanceForm | null) {
  const onCreated = vi.fn();
  const extra = legalForm === undefined ? {} : { legalForm };
  render(
    <CreateSalonPrompt
      session={{ user: { name: "Anna", email: "anna@example.com" } }}
      onCreated={onCreated}
      {...extra}
    />
  );
  return { onCreated };
}

function sentBody(): Record<string, unknown> {
  const options = vi.mocked(mutationFetch).mock.calls[0]?.[1];
  return JSON.parse(String(options?.body)) as Record<string, unknown>;
}

describe("flaga wyłączona (wartość z modułu)", () => {
  it("bez pól wyboru i bez odnośników; przycisk aktywny; żądanie bez pól akceptacji", async () => {
    const user = userEvent.setup();
    const { onCreated } = renderPrompt();

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    const create = screen.getByRole("button", { name: CREATE_BUTTON });
    expect(create).toBeEnabled();

    await user.click(create);

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const body = sentBody();
    expect(body).not.toHaveProperty("termsVersion");
    expect(body).not.toHaveProperty("dpaVersion");
    expect(body).not.toHaveProperty("acceptanceSource");
  });
});

describe("flaga włączona", () => {
  const form = legalAcceptanceForm(true, PUBLISHED);

  it("dwa osobne pola z odnośnikami do /terms i /dpa", () => {
    renderPrompt(form);

    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "regulamin" })).toHaveAttribute("href", "/terms");
    expect(
      screen.getByRole("link", { name: "umowę powierzenia przetwarzania danych (DPA)" })
    ).toHaveAttribute("href", "/dpa");
  });

  it("przycisk zablokowany do zaznaczenia obu pól; jedno pole nie wystarcza", async () => {
    const user = userEvent.setup();
    renderPrompt(form);
    const create = screen.getByRole("button", { name: CREATE_BUTTON });

    expect(create).toBeDisabled();
    await user.click(screen.getByLabelText(TERMS_BOX));
    expect(create).toBeDisabled();
    await user.click(screen.getByLabelText(DPA_BOX));
    expect(create).toBeEnabled();
    await user.click(screen.getByLabelText(TERMS_BOX));
    expect(create).toBeDisabled();
    expect(mutationFetch).not.toHaveBeenCalled();
  });

  it("po zaznaczeniu obu: wersje z rejestru i acceptanceSource create_salon", async () => {
    const user = userEvent.setup();
    const { onCreated } = renderPrompt(form);

    await user.click(screen.getByLabelText(TERMS_BOX));
    await user.click(screen.getByLabelText(DPA_BOX));
    await user.click(screen.getByRole("button", { name: CREATE_BUTTON }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(sentBody()).toMatchObject({
      termsVersion: TERMS_V,
      dpaVersion: DPA_V,
      acceptanceSource: "create_salon",
    });
  });

  it("400 LEGAL_ACCEPTANCE_REQUIRED: komunikat widoczny, salon nie zgłoszony jako założony", async () => {
    vi.mocked(mutationFetch).mockResolvedValueOnce({
      json: async () => ({ success: false, code: "LEGAL_ACCEPTANCE_REQUIRED", error: "x" }),
    } as unknown as Response);
    const user = userEvent.setup();
    const { onCreated } = renderPrompt(form);

    await user.click(screen.getByLabelText(TERMS_BOX));
    await user.click(screen.getByLabelText(DPA_BOX));
    await user.click(screen.getByRole("button", { name: CREATE_BUTTON }));

    expect(await screen.findByText(LEGAL_ACCEPTANCE_REQUIRED_MESSAGE)).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
