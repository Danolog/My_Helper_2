"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import { parseUIStreamLine } from "@/lib/ai/ui-stream";
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
            const { textDelta, error } = parseUIStreamLine(line);
            if (error) throw new Error(error);
            if (textDelta) fullText += textDelta;
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
