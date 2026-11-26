import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { useRegistration } from "@/components/auth/_hooks/use-registration";
import { mutationFetch } from "@/lib/api-client";
import { signUp } from "@/lib/auth-client";
import { BETA_INVITE_ONLY_CODE, BETA_INVITE_ONLY_MESSAGE } from "@/lib/beta-access";
import { LEGAL_DOCUMENTS, legalAcceptanceForm } from "@/lib/legal/documents";
import { PLANS_ON_SALE } from "@/lib/plan-catalog";

// Hak formularza rejestracji: krok i plan na starcie, plan po przywróceniu
// formularza, planSlug wysyłany do /api/register-subscription, plan Pro
// zwracany do kroku wyboru planu, argument setDirty z atrapy
// use-form-recovery i wasRecovered zwracane przez hak przy zapisanym stanie
// z danymi, bez danych i bez zapisanego stanu. Grupa główna biegnie na prawdziwej liście
// PLANS_ON_SALE; ostatnia grupa na czas swoich przypadków dopisuje "pro" do
// tablicy PLANS_ON_SALE prawdziwego modułu (lista ["basic", "pro"]) i potem ją przywraca.

type Recovered = {
  step: number;
  selectedPlan: string | null;
  name: string;
  email: string;
};

const recovery = vi.hoisted(() => ({
  state: null as Recovered | null,
  saveFormState: () => {},
  setDirty: vi.fn(),
  clearSavedForm: () => {},
}));

// Pola akceptacji regulaminu i DPA domyślnie wyłączone jawnie (flaga false do
// prawdziwej funkcji), niezależnie od wartości flagi w module. Przypadki
// z opublikowanymi dokumentami podają formularz akceptacji w argumencie haka.
vi.mock("@/lib/legal/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/legal/documents")>();
  return {
    ...actual,
    legalAcceptanceForm: (
      published = false,
      documents: import("@/lib/legal/documents").LegalDocuments = actual.LEGAL_DOCUMENTS,
    ) => actual.legalAcceptanceForm(published, documents),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/hooks/use-form-recovery", () => ({
  useFormRecovery: () => ({
    wasRecovered: recovery.state !== null,
    getRecoveredState: () => recovery.state,
    saveFormState: recovery.saveFormState,
    clearSavedForm: recovery.clearSavedForm,
    setDirty: recovery.setDirty,
  }),
}));

// Domyślnie potwierdzanie e-maila wyłączone: better-auth zwraca token sesji.
vi.mock("@/lib/auth-client", () => ({
  signUp: { email: vi.fn(async () => ({ data: { token: "session-token" }, error: null })) },
}));

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(async () => new Response("{}", { status: 200 })),
}));

const PLAN_BASIC = {
  id: "plan-basic",
  name: "Basic",
  slug: "basic",
  priceMonthly: "49.00",
  features: ["Kalendarz"],
  isActive: true,
};

const PLAN_PRO = {
  id: "plan-pro",
  name: "Pro",
  slug: "pro",
  priceMonthly: "149.00",
  features: ["Kalendarz", "Asystent AI"],
  isActive: true,
};

const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === "/api/subscription-plans") {
    return new Response(JSON.stringify({ success: true, data: [PLAN_BASIC, PLAN_PRO] }), {
      status: 200,
    });
  }
  return new Response(JSON.stringify({ success: false }), { status: 404 });
});

async function renderLoaded(preselectedPlan: string | null) {
  const hook = renderHook(() => useRegistration(preselectedPlan));
  await waitFor(() => expect(hook.result.current.plansLoading).toBe(false));
  return hook;
}

async function fillAndSubmit(result: { current: ReturnType<typeof useRegistration> }) {
  act(() => {
    result.current.setName("Anna Nowak");
    result.current.setEmail("anna@example.com");
    result.current.setPassword("Haslo12345");
    result.current.setConfirmPassword("Haslo12345");
  });
  await act(async () => {
    await result.current.handleSubmit({ preventDefault: () => {} } as unknown as React.FormEvent);
  });
}

function sentPlanSlug(): unknown {
  const calls = vi.mocked(mutationFetch).mock.calls;
  expect(calls).toHaveLength(1);
  const [url, init] = calls[0] ?? [];
  expect(url).toBe("/api/register-subscription");
  return JSON.parse(String(init?.body)).planSlug;
}

beforeEach(() => {
  vi.clearAllMocks();
  recovery.state = null;
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRegistration — lista PLANS_ON_SALE z modułu", () => {
  it('useRegistration("pro"): step 2 i selectedPlan "basic"', async () => {
    const { result } = await renderLoaded("pro");
    expect(result.current.step).toBe(2);
    expect(result.current.selectedPlan).toBe("basic");
  });

  it('useRegistration("pro") i handleSubmit z poprawnymi danymi: jedno wywołanie mutationFetch z /api/register-subscription i planSlug "basic"', async () => {
    const { result } = await renderLoaded("pro");
    await fillAndSubmit(result);
    expect(sentPlanSlug()).toBe("basic");
  });

  it('useRegistration(null): step 2 i selectedPlan "basic"', async () => {
    const { result } = await renderLoaded(null);
    expect(result.current.step).toBe(2);
    expect(result.current.selectedPlan).toBe("basic");
  });

  it('useRegistration("basic"): step 2 i selectedPlan "basic"', async () => {
    const { result } = await renderLoaded("basic");
    expect(result.current.step).toBe(2);
    expect(result.current.selectedPlan).toBe("basic");
  });

  it('handleRestoreForm z zapisanym selectedPlan "pro": selectedPlan "basic"', async () => {
    recovery.state = { step: 2, selectedPlan: "pro", name: "Anna Nowak", email: "anna@example.com" };
    const { result } = await renderLoaded(null);
    act(() => {
      result.current.handleRestoreForm();
    });
    expect(result.current.selectedPlan).toBe("basic");
  });

  it('handleRestoreForm z zapisanym selectedPlan "pro", potem handleSubmit: planSlug "basic"', async () => {
    recovery.state = { step: 2, selectedPlan: "pro", name: "Anna Nowak", email: "anna@example.com" };
    const { result } = await renderLoaded(null);
    act(() => {
      result.current.handleRestoreForm();
    });
    await fillAndSubmit(result);
    expect(sentPlanSlug()).toBe("basic");
  });

  it("odpowiedź /api/subscription-plans z planami basic i pro: basicPlan zdefiniowany, proPlan undefined", async () => {
    const { result } = await renderLoaded(null);
    expect(result.current.basicPlan).toEqual(PLAN_BASIC);
    expect(result.current.proPlan).toBeUndefined();
  });

  it('useRegistration(null), handleSelectPlan("pro") i handleSubmit z poprawnymi danymi: jedno wywołanie mutationFetch z /api/register-subscription i planSlug "basic"', async () => {
    const { result } = await renderLoaded(null);
    act(() => {
      result.current.handleSelectPlan("pro");
    });
    await fillAndSubmit(result);
    expect(sentPlanSlug()).toBe("basic");
  });

  it('useRegistration(null) bez wpisu: ostatnie wywołanie setDirty z false; po setName("Anna"): z true', async () => {
    const { result } = await renderLoaded(null);
    expect(vi.mocked(recovery.setDirty).mock.calls.at(-1)).toEqual([false]);
    act(() => {
      result.current.setName("Anna");
    });
    expect(vi.mocked(recovery.setDirty).mock.calls.at(-1)).toEqual([true]);
  });

  it('zapisany stan { step: 2, selectedPlan: "basic", name: "", email: "" }: wasRecovered false', async () => {
    recovery.state = { step: 2, selectedPlan: "basic", name: "", email: "" };
    const { result } = await renderLoaded(null);
    expect(result.current.wasRecovered).toBe(false);
  });

  it('zapisany stan { step: 2, selectedPlan: "basic", name: "Anna Nowak", email: "" }: wasRecovered true', async () => {
    recovery.state = { step: 2, selectedPlan: "basic", name: "Anna Nowak", email: "" };
    const { result } = await renderLoaded(null);
    expect(result.current.wasRecovered).toBe(true);
  });

  it("brak zapisanego stanu: wasRecovered false", async () => {
    const { result } = await renderLoaded(null);
    expect(result.current.wasRecovered).toBe(false);
  });
});

describe('useRegistration — PLANS_ON_SALE podmieniona na ["basic", "pro"]', () => {
  const list = PLANS_ON_SALE as unknown as string[];

  beforeAll(() => {
    list.push("pro");
  });

  afterAll(() => {
    list.splice(1);
  });

  it("useRegistration(null): step 1 i selectedPlan null", async () => {
    expect(list).toEqual(["basic", "pro"]);
    const { result } = await renderLoaded(null);
    expect(result.current.step).toBe(1);
    expect(result.current.selectedPlan).toBeNull();
  });

  it('useRegistration("pro"): step 2 i selectedPlan "pro"', async () => {
    const { result } = await renderLoaded("pro");
    expect(result.current.step).toBe(2);
    expect(result.current.selectedPlan).toBe("pro");
  });

  it("odpowiedź /api/subscription-plans z planami basic i pro: proPlan zdefiniowany", async () => {
    const { result } = await renderLoaded(null);
    expect(result.current.proPlan).toEqual(PLAN_PRO);
  });

  it('useRegistration("pro") bez wpisu: ostatnie wywołanie setDirty z true', async () => {
    await renderLoaded("pro");
    expect(vi.mocked(recovery.setDirty).mock.calls.at(-1)).toEqual([true]);
  });

  it('zapisany stan { step: 1, selectedPlan: "pro", name: "", email: "" }: wasRecovered true', async () => {
    recovery.state = { step: 1, selectedPlan: "pro", name: "", email: "" };
    const { result } = await renderLoaded(null);
    expect(result.current.wasRecovered).toBe(true);
  });
});

// Przy włączonym potwierdzaniu e-maila better-auth zwraca token: null (także przy
// zajętym adresie), więc po rejestracji nie ma sesji: trasa zakładająca salon
// odpowiedziałaby 401. Hak wtedy jej nie woła i pokazuje ekran „sprawdź pocztę”.
describe("useRegistration — sesja po rejestracji", () => {
  const PUBLISHED_FORM = legalAcceptanceForm(true, {
    ...LEGAL_DOCUMENTS,
    privacy: { ...LEGAL_DOCUMENTS.privacy, version: "2026-12-03" },
    terms: { ...LEGAL_DOCUMENTS.terms, version: "2026-12-01" },
    dpa: { ...LEGAL_DOCUMENTS.dpa, version: "2026-12-02" },
  });

  function signUpReturnsNoSession() {
    vi.mocked(signUp.email).mockResolvedValueOnce({
      data: { token: null, user: { email: "anna@example.com" } },
      error: null,
    } as never);
  }

  it("token null: bez wywołania /api/register-subscription, ekran potwierdzenia bez błędów", async () => {
    signUpReturnsNoSession();
    const { result } = await renderLoaded(null);
    await fillAndSubmit(result);
    expect(signUp.email).toHaveBeenCalledTimes(1);
    expect(mutationFetch).not.toHaveBeenCalled();
    expect(result.current.showVerificationMessage).toBe(true);
    expect(result.current.salonSetupError).toBe("");
    expect(result.current.error).toBe("");
    expect(result.current.isPending).toBe(false);
  });

  it("token null przy opublikowanych dokumentach i zaznaczonej akceptacji: bez żądania z akceptacją regulaminu i DPA", async () => {
    expect(PUBLISHED_FORM).not.toBeNull();
    signUpReturnsNoSession();
    const hook = renderHook(() => useRegistration(null, PUBLISHED_FORM));
    await waitFor(() => expect(hook.result.current.plansLoading).toBe(false));
    act(() => {
      hook.result.current.setLegalChecks({ terms: true, dpa: true });
    });
    await fillAndSubmit(hook.result);
    expect(mutationFetch).not.toHaveBeenCalled();
    expect(hook.result.current.showVerificationMessage).toBe(true);
  });

  it("token null dwa razy (nowy i zajęty adres dają tę samą odpowiedź): ten sam stan haka", async () => {
    signUpReturnsNoSession();
    const first = await renderLoaded(null);
    await fillAndSubmit(first.result);
    signUpReturnsNoSession();
    const second = await renderLoaded(null);
    await fillAndSubmit(second.result);
    const pick = (r: ReturnType<typeof useRegistration>) => ({
      showVerificationMessage: r.showVerificationMessage,
      salonSetupError: r.salonSetupError,
      error: r.error,
    });
    expect(pick(second.result.current)).toEqual(pick(first.result.current));
    expect(mutationFetch).not.toHaveBeenCalled();
  });

  it("token obecny: jedno wywołanie /api/register-subscription i ekran potwierdzenia", async () => {
    const { result } = await renderLoaded(null);
    await fillAndSubmit(result);
    expect(sentPlanSlug()).toBe("basic");
    expect(result.current.showVerificationMessage).toBe(true);
    expect(result.current.salonSetupError).toBe("");
  });

  it("token obecny przy opublikowanych dokumentach: żądanie z akceptacją", async () => {
    const hook = renderHook(() => useRegistration(null, PUBLISHED_FORM));
    await waitFor(() => expect(hook.result.current.plansLoading).toBe(false));
    act(() => {
      hook.result.current.setLegalChecks({ terms: true, dpa: true });
    });
    await fillAndSubmit(hook.result);
    expect(mutationFetch).toHaveBeenCalledTimes(1);
    const body: unknown = JSON.parse(String(vi.mocked(mutationFetch).mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      planSlug: "basic",
      email: "anna@example.com",
      termsVersion: "2026-12-01",
      dpaVersion: "2026-12-02",
      acceptanceSource: "registration",
    });
  });

  it("token obecny, błąd sieci przy POST: ekran potwierdzenia z komunikatem o salonie", async () => {
    vi.mocked(mutationFetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = await renderLoaded(null);
    await fillAndSubmit(result);
    expect(mutationFetch).toHaveBeenCalledTimes(1);
    expect(result.current.showVerificationMessage).toBe(true);
    expect(result.current.salonSetupError).toBe(
      "Nie udało się założyć salonu. Po zalogowaniu załóż go w panelu."
    );
    expect(result.current.error).toBe("");
  });

  it("token obecny, 403 BETA_INVITE_ONLY: ekran potwierdzenia z komunikatem o becie na zaproszenie", async () => {
    vi.mocked(mutationFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, code: BETA_INVITE_ONLY_CODE, error: "x" }), {
        status: 403,
      })
    );
    const { result } = await renderLoaded(null);
    await fillAndSubmit(result);
    expect(mutationFetch).toHaveBeenCalledTimes(1);
    expect(result.current.showVerificationMessage).toBe(true);
    expect(result.current.salonSetupError).toBe(BETA_INVITE_ONLY_MESSAGE);
    expect(result.current.error).toBe("");
  });

  it("błąd signUp: komunikat błędu, bez wywołania /api/register-subscription i bez ekranu potwierdzenia", async () => {
    vi.mocked(signUp.email).mockResolvedValueOnce({
      data: null,
      error: { message: "Invalid email", status: 400, statusText: "Bad Request" },
    } as never);
    const { result } = await renderLoaded(null);
    await fillAndSubmit(result);
    expect(mutationFetch).not.toHaveBeenCalled();
    expect(result.current.showVerificationMessage).toBe(false);
    expect(result.current.error).not.toBe("");
    expect(result.current.isPending).toBe(false);
  });

  it("signUp rzuca wyjątek: komunikat nieoczekiwanego błędu, bez wywołania /api/register-subscription", async () => {
    vi.mocked(signUp.email).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = await renderLoaded(null);
    await fillAndSubmit(result);
    expect(mutationFetch).not.toHaveBeenCalled();
    expect(result.current.showVerificationMessage).toBe(false);
    expect(result.current.error).toBe("Wystapil nieoczekiwany blad");
  });

  it("odpowiedź bez pola token (data: {}): traktowana jak brak sesji", async () => {
    vi.mocked(signUp.email).mockResolvedValueOnce({ data: {}, error: null } as never);
    const { result } = await renderLoaded(null);
    await fillAndSubmit(result);
    expect(mutationFetch).not.toHaveBeenCalled();
    expect(result.current.showVerificationMessage).toBe(true);
  });
});
