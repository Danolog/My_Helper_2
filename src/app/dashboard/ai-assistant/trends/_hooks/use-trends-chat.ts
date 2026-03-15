"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { mutationFetch } from "@/lib/api-client";
import { getUserFriendlyMessage } from "@/lib/error-messages";
import type { ChatMessage, TrendsData } from "../_types";

interface UseTrendsChatReturn {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  loading: boolean;
  sendMessage: () => Promise<void>;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Builds a context string from the current trends data so the AI
 * can reference concrete numbers when answering user questions.
 */
function buildTrendsContext(data: TrendsData): string {
  return (
    `\nAKTUALNE TRENDY BIZNESOWE:\n` +
    `Okres: ${data.period.currentMonth} vs ${data.period.previousMonth}\n` +
    `Przychod: ${data.revenue.currentMonth} PLN (${data.revenue.trend === "up" ? "wzrost" : data.revenue.trend === "down" ? "spadek" : "stabilny"} ${data.revenue.changePercent}%)\n` +
    `Wizyty: ${data.appointments.currentMonth} (${data.appointments.trend === "up" ? "wzrost" : data.appointments.trend === "down" ? "spadek" : "stabilny"} ${data.appointments.changePercent}%)\n` +
    `Nowi klienci: ${data.clients.newClientsThisMonth} (${data.clients.trend === "up" ? "wzrost" : data.clients.trend === "down" ? "spadek" : "stabilny"} ${data.clients.changePercent}%)\n` +
    `Klienci ogolem: ${data.clients.totalClients}, powracajacy: ${data.clients.returningClientsThisMonth}\n` +
    `Wskaznik anulacji: ${data.cancellations.currentRate}% (poprzednio: ${data.cancellations.previousRate}%)\n` +
    `Srednia ocena: ${data.ratings.currentAvg}/5 (poprzednio: ${data.ratings.previousAvg}/5)\n` +
    `\nPopularnosc uslug:\n${data.servicePopularity.map((s) => `  - ${s.serviceName}: ${s.currentCount} wizyt (${s.trend === "up" ? "\u2191" : s.trend === "down" ? "\u2193" : "\u2192"} ${s.changePercent}%)`).join("\n")}\n` +
    `\nWyniki pracownikow:\n${data.employeePerformance.map((e) => `  - ${e.employeeName}: ${e.currentRevenue} PLN (${e.trend === "up" ? "\u2191" : e.trend === "down" ? "\u2193" : "\u2192"} ${e.changePercent}%)`).join("\n")}\n` +
    `\nWnioski AI:\n${data.insights.map((i) => `  [${i.type}] ${i.message}`).join("\n")}`
  );
}

/**
 * Encapsulates all chat state and streaming logic for the
 * "Zapytaj AI" trends conversation tab.
 */
export function useTrendsChat(data: TrendsData | null): UseTrendsChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Scroll chat to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const trendsContext = data ? buildTrendsContext(data) : "";

      const systemMessage = {
        role: "system" as const,
        parts: [
          {
            type: "text",
            text:
              `Jestes ekspertem od analizy trendow biznesowych salonu kosmetycznego. Odpowiadaj TYLKO po polsku. ` +
              `Bazuj na dostarczonych danych trendow. Uzywaj konkretnych liczb i porownuj okresy. ` +
              `Identyfikuj trendy wzrostowe i spadkowe. Dawaj praktyczne rekomendacje.` +
              trendsContext,
          },
        ],
      };

      const userMessage = {
        role: "user" as const,
        parts: [{ type: "text", text }],
      };

      const res = await mutationFetch("/api/ai/business/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [systemMessage, userMessage],
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || "Blad komunikacji z AI");
      }

      // Read streaming response
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullText = "";
      const assistantId = crypto.randomUUID();

      // Add empty assistant message placeholder
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", text: "", timestamp: new Date() },
      ]);

      // Buffer for partial lines across chunks
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last potentially incomplete line in buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // UI Message Stream Protocol: data: {"type":"text","text":"..."}
          if (trimmed.startsWith("data: ")) {
            const payload = trimmed.slice(6);
            if (payload === "[DONE]") continue;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.type === "text" && typeof parsed.text === "string") {
                fullText += parsed.text;
              } else if (parsed.type === "error" && parsed.errorText) {
                throw new Error(parsed.errorText);
              }
            } catch (parseErr) {
              // Re-throw stream errors (not JSON parse errors)
              if (
                parseErr instanceof Error &&
                !parseErr.message.includes("Unexpected") &&
                !parseErr.message.includes("JSON")
              ) {
                throw parseErr;
              }
            }
          }
          // Also support legacy Data Stream Protocol: 0:"text content"
          else if (trimmed.startsWith("0:")) {
            try {
              const textContent = JSON.parse(trimmed.slice(2));
              if (typeof textContent === "string") {
                fullText += textContent;
              }
            } catch {
              // Not valid JSON, skip
            }
          }
        }

        setMessages((prev) =>
          prev.map((msg) => (msg.id === assistantId ? { ...msg, text: fullText } : msg))
        );
      }
    } catch (e) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: getUserFriendlyMessage(e, "Wystapil blad podczas komunikacji z asystentem AI. Sprobuj ponownie."),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, data]);

  return {
    messages,
    input,
    setInput,
    loading,
    sendMessage,
    chatEndRef,
  };
}
