"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import { getUserFriendlyMessage } from "@/lib/error-messages";
import type { ChatMessage } from "../_types";

interface UseBusinessChatReturn {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  loading: boolean;
  sendMessage: (text?: string) => Promise<void>;
  clearChat: () => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * Encapsulates all chat state and streaming logic for the
 * business AI assistant conversation tab.
 */
export function useBusinessChat(): UseBusinessChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll chat to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /** Build the message history array expected by the API. */
  const buildAPIMessages = useCallback(
    (newUserText: string) => {
      const history = messages.map((msg) => ({
        id: msg.id,
        role: msg.role as "user" | "assistant",
        parts: [{ type: "text", text: msg.text }],
      }));
      history.push({
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: newUserText }],
      });
      return history;
    },
    [messages],
  );

  /** Send a message and stream the AI response. */
  const sendMessage = useCallback(
    async (text?: string) => {
      const messageText = (text || input).trim();
      if (!messageText || loading) return;

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: messageText,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setLoading(true);

      try {
        const apiMessages = buildAPIMessages(messageText);

        const res = await mutationFetch("/api/ai/business/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: apiMessages }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(
            errData?.error || "Blad komunikacji z asystentem AI",
          );
        }

        // Read streaming response
        const reader = res.body?.getReader();
        if (!reader) throw new Error("Brak odpowiedzi");

        const decoder = new TextDecoder();
        let fullText = "";
        const assistantId = crypto.randomUUID();

        // Add empty assistant message placeholder
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            text: "",
            timestamp: new Date(),
          },
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
            prev.map((msg) =>
              msg.id === assistantId ? { ...msg, text: fullText } : msg,
            ),
          );
        }
      } catch (e) {
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: getUserFriendlyMessage(
            e,
            "Wystapil blad podczas komunikacji z asystentem AI. Sprobuj ponownie.",
          ),
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [input, loading, buildAPIMessages],
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    toast.success("Rozmowa wyczyszczona");
  }, []);

  return {
    messages,
    input,
    setInput,
    loading,
    sendMessage,
    clearChat,
    chatEndRef,
    inputRef,
  };
}
