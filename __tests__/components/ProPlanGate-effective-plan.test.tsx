/**
 * ProPlanGate z prawdziwym useSubscription: bramka w UI pokazuje plan
 * efektywny (`effectivePlanSlug` z /api/subscriptions/current), a nie
 * zapisany plan (`plan.slug`).
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProPlanGate } from "@/components/subscription/pro-plan-gate";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockFetch = vi.fn();

function currentResponse(effectivePlanSlug: unknown) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      plan: { slug: "pro", name: "Pro", priceMonthly: "149.00", features: [] },
      subscription: { status: "trialing", trialEndsAt: "2026-01-01T00:00:00Z" },
      effectivePlanSlug,
    }),
  };
}

function renderGate() {
  return render(
    <ProPlanGate featureName="Asystent AI" featureDescription="Opis">
      <div data-testid="pro-content">Pro content</div>
    </ProPlanGate>,
  );
}

describe("ProPlanGate — plan efektywny", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  it("zapisany Pro, efektywny Basic (trial po terminie): komunikat o niedostępności funkcji AI, bez treści Pro", async () => {
    mockFetch.mockResolvedValueOnce(currentResponse("basic"));
    renderGate();
    await waitFor(() => expect(screen.getByText("Funkcje AI nie są jeszcze dostępne w Twoim planie.")).toBeTruthy());
    expect(screen.queryByTestId("pro-content")).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith("/api/subscriptions/current", { cache: "no-store" });
  });

  it("efektywny Pro: treść Pro", async () => {
    mockFetch.mockResolvedValueOnce(currentResponse("pro"));
    renderGate();
    await waitFor(() => expect(screen.getByTestId("pro-content")).toBeTruthy());
    expect(screen.queryByText("Funkcje AI nie są jeszcze dostępne w Twoim planie.")).toBeNull();
  });
});
