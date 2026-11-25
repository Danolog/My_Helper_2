/**
 * Okno tworzenia salonu (CreateSalonPrompt) a lista PLANS_ON_SALE.
 *
 * Test renderuje CreateSalonPrompt i sprawdza, karty których planów są
 * pokazane, który z dwóch tekstów o okresie próbnym jest w oknie, czy
 * przycisk tworzenia salonu jest aktywny przed kliknięciem karty oraz jaki
 * planSlug trafia w body wywołania mutationFetch na adres
 * /api/register-subscription. Atrapą jest tylko @/lib/api-client
 * (mutationFetch zwraca odpowiedź, której json() daje { success: true }).
 * Moduł @/lib/plan-catalog jest prawdziwy: pierwsza grupa biegnie na liście
 * PLANS_ON_SALE z modułu, druga na czas swoich przypadków dopisuje "pro" do
 * tablicy PLANS_ON_SALE modułu (lista ["basic", "pro"]) i po nich ją
 * przywraca. Test NIE sprawdza trasy /api/register-subscription, odpowiedzi
 * z błędem ani stron panelu, które pokazują ten komponent.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { CreateSalonPrompt } from "@/components/dashboard/create-salon-prompt";
import { mutationFetch } from "@/lib/api-client";
import { PLANS, TRIAL_DAYS } from "@/lib/constants";
import { PLANS_ON_SALE } from "@/lib/plan-catalog";
import { planHighlights } from "@/lib/plan-features";

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(async () => ({ json: async () => ({ success: true }) })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const BASIC_CARD = new RegExp(`^${PLANS.basic.name}`);
const PRO_CARD = new RegExp(`^${PLANS.pro.name}`);
const CREATE_BUTTON = /Utworz salon z/;
const SHORT_TEXT = `Rozpocznij ${TRIAL_DAYS}-dniowy okres probny`;
const LONG_TEXT = `Wybierz plan i rozpocznij ${TRIAL_DAYS}-dniowy okres probny`;

function renderPrompt() {
  const onCreated = vi.fn();
  render(
    <CreateSalonPrompt
      session={{ user: { name: "Anna", email: "anna@example.com" } }}
      onCreated={onCreated}
    />
  );
  return { onCreated };
}

function sentPlanSlug(): unknown {
  const options = vi.mocked(mutationFetch).mock.calls[0]?.[1];
  return JSON.parse(String(options?.body)).planSlug;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("CreateSalonPrompt — lista PLANS_ON_SALE z modułu", () => {
  it("karta Basic jest, karty Pro i odznaki AI nie ma; pozycje listy = planHighlights(\"basic\", 4)", () => {
    renderPrompt();

    expect(screen.getByRole("button", { name: BASIC_CARD })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: PRO_CARD })).not.toBeInTheDocument();
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((el) => el.textContent?.trim())).toEqual(
      planHighlights("basic", 4)
    );
  });

  it("przycisk tworzenia aktywny bez kliknięcia karty; po kliknięciu mutationFetch raz na /api/register-subscription z planSlug \"basic\" i onCreated raz", async () => {
    const user = userEvent.setup();
    const { onCreated } = renderPrompt();

    const create = screen.getByRole("button", { name: CREATE_BUTTON });
    expect(create).toBeEnabled();
    await user.click(create);

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mutationFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mutationFetch).mock.calls[0]?.[0]).toBe("/api/register-subscription");
    expect(sentPlanSlug()).toBe("basic");
  });

  it("kontener kart nie ma klasy sm:grid-cols-2", () => {
    renderPrompt();

    const grid = screen.getByRole("button", { name: BASIC_CARD }).parentElement;
    expect(grid).not.toHaveClass("sm:grid-cols-2");
  });

  it(`jest element o całym tekście „${SHORT_TEXT}”, elementu o całym tekście „${LONG_TEXT}” nie ma`, () => {
    renderPrompt();

    expect(screen.getByText(SHORT_TEXT, { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(LONG_TEXT, { exact: true })).not.toBeInTheDocument();
  });
});

describe('CreateSalonPrompt — PLANS_ON_SALE podmieniona na ["basic", "pro"]', () => {
  const list = PLANS_ON_SALE as unknown as string[];

  beforeAll(() => {
    list.push("pro");
  });

  afterAll(() => {
    list.splice(1);
  });

  it("karty Basic i Pro; przycisk tworzenia nieaktywny przed wyborem; po kliknięciu karty Pro i przycisku planSlug \"pro\"", async () => {
    const user = userEvent.setup();
    const { onCreated } = renderPrompt();

    expect(screen.getByRole("button", { name: BASIC_CARD })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PRO_CARD })).toBeInTheDocument();
    const create = screen.getByRole("button", { name: CREATE_BUTTON });
    expect(create).toBeDisabled();

    await user.click(screen.getByRole("button", { name: PRO_CARD }));
    await user.click(create);

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(sentPlanSlug()).toBe("pro");
  });

  it("po kliknięciu karty Basic i przycisku tworzenia planSlug \"basic\"", async () => {
    const user = userEvent.setup();
    const { onCreated } = renderPrompt();

    await user.click(screen.getByRole("button", { name: BASIC_CARD }));
    await user.click(screen.getByRole("button", { name: CREATE_BUTTON }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(sentPlanSlug()).toBe("basic");
  });

  it(`jest element o całym tekście „${LONG_TEXT}”, elementu o całym tekście „${SHORT_TEXT}” nie ma`, () => {
    renderPrompt();

    expect(screen.getByText(LONG_TEXT, { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(SHORT_TEXT, { exact: true })).not.toBeInTheDocument();
  });
});
