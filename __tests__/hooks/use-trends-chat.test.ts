import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useTrendsChat } from "@/app/dashboard/ai-assistant/trends/_hooks/use-trends-chat";
import type { TrendsData } from "@/app/dashboard/ai-assistant/trends/_types";

// Czat trendów: kontekst trendów idzie w wiadomości użytkownika, hook nie
// wysyła roli system (trasa /api/ai/business/chat przyjmuje tylko user/assistant).

const { mockMutationFetch } = vi.hoisted(() => ({ mockMutationFetch: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ mutationFetch: mockMutationFetch }));

const trend = { changePercent: 10, trend: "up" as const };
const DATA: TrendsData = {
  period: { currentMonth: "2026-11", previousMonth: "2026-10", currentWeek: "w46", previousWeek: "w45" },
  revenue: {
    currentMonth: 12345, previousMonth: 11000, ...trend,
    weeklyCurrentRevenue: 1, weeklyPreviousRevenue: 1, weeklyChangePercent: 0, weeklyTrend: "stable",
    monthlyBreakdown: [],
  },
  appointments: {
    currentMonth: 87, previousMonth: 80, ...trend,
    weeklyCurrentCount: 1, weeklyPreviousCount: 1, weeklyChangePercent: 0, weeklyTrend: "stable",
  },
  clients: {
    newClientsThisMonth: 5, newClientsPrevMonth: 4, ...trend,
    totalClients: 120, returningClientsThisMonth: 30, returningClientsPrevMonth: 28,
  },
  servicePopularity: [{ serviceName: "Manicure hybrydowy", currentCount: 40, previousCount: 35, ...trend }],
  employeePerformance: [{ employeeName: "Anna", currentRevenue: 5000, previousRevenue: 4500, ...trend }],
  cancellations: { currentRate: 4, previousRate: 6, trend: "down" },
  ratings: { currentAvg: 4.8, previousAvg: 4.7, currentCount: 10, previousCount: 9, trend: "up" },
  insights: [{ type: "positive", message: "Rosnie liczba wizyt" }],
};

function streamResponse(deltas: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const d of deltas) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "text-delta", id: "t", delta: d })}\n`));
      }
      controller.enqueue(enc.encode("data: [DONE]\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

type SentMessage = { role: string; parts: { type: string; text: string }[] };

async function send(data: TrendsData | null, question: string) {
  const hook = renderHook(() => useTrendsChat(data));
  act(() => hook.result.current.setInput(question));
  await act(async () => {
    await hook.result.current.sendMessage();
  });
  return hook;
}

function sentBody(): { messages: SentMessage[] } {
  const [url, init] = mockMutationFetch.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/ai/business/chat");
  return JSON.parse(String(init.body)) as { messages: SentMessage[] };
}

describe("useTrendsChat — kontekst w wiadomości użytkownika", () => {
  beforeEach(() => {
    mockMutationFetch.mockReset();
    mockMutationFetch.mockImplementation(async () => streamResponse(["Przychod ", "rosnie."]));
  });

  it("wysyła kontekst trendów i pytanie wyłącznie w roli user; dostaje odpowiedź", async () => {
    const hook = await send(DATA, "Jak idzie miesiac?");

    const { messages } = sentBody();
    expect(messages.map((msg) => msg.role)).toEqual(["user"]);
    const texts = messages[0]?.parts.map((p) => p.text) ?? [];
    const joined = texts.join("\n");
    expect(joined).toContain("12345 PLN");
    expect(joined).toContain("Manicure hybrydowy");
    expect(texts.at(-1)).toBe("Jak idzie miesiac?");
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(10_000);

    await waitFor(() => {
      expect(hook.result.current.messages.map((msg) => [msg.role, msg.text])).toEqual([
        ["user", "Jak idzie miesiac?"],
        ["assistant", "Przychod rosnie."],
      ]);
    });
    expect(hook.result.current.loading).toBe(false);
  });

  it("bez danych trendów: tylko pytanie, nadal bez roli system", async () => {
    await send(null, "Co dalej?");
    const { messages } = sentBody();
    expect(messages).toEqual([{ role: "user", parts: [{ type: "text", text: "Co dalej?" }] }]);
  });

  it("błąd trasy (400) pokazuje komunikat z odpowiedzi", async () => {
    mockMutationFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid request" }), { status: 400 }),
    );
    const hook = await send(DATA, "Pytanie");
    const last = hook.result.current.messages.at(-1);
    expect(last?.role).toBe("assistant");
    expect(last?.text.length).toBeGreaterThan(0);
    expect(hook.result.current.loading).toBe(false);
  });
});
