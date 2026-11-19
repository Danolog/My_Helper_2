import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { useRegistration } from "@/components/auth/_hooks/use-registration";
import { mutationFetch } from "@/lib/api-client";
import { PLANS_ON_SALE } from "@/lib/plan-catalog";

// Hak formularza rejestracji: krok i plan na starcie, plan po przywróceniu
// formularza, planSlug wysyłany do /api/register-subscription, plan Pro
// zwracany do kroku wyboru planu i argument setDirty z atrapy
// use-form-recovery. Grupa główna biegnie na prawdziwej liście
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

vi.mock("@/lib/auth-client", () => ({
  signUp: { email: vi.fn(async () => ({ data: {}, error: null })) },
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
});
