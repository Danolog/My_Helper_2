"use client";

import { Loader2, Send, Sparkles, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ChatMessage } from "../_types";

interface AskTabProps {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  loading: boolean;
  sendMessage: () => Promise<void>;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * The "Zapytaj AI" tab — chat interface for asking the AI about
 * business trends with suggested prompts and streaming responses.
 */
export function AskTab({
  messages,
  input,
  setInput,
  loading,
  sendMessage,
  chatEndRef,
}: AskTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare className="h-5 w-5 text-primary" />
        <h2 className="font-semibold">Zapytaj o trendy</h2>
      </div>

      <Card>
        <CardContent className="pt-6">
          {/* Chat messages */}
          <div className="min-h-[300px] max-h-[400px] overflow-y-auto space-y-3 mb-4">
            {messages.length === 0 && (
              <div className="text-center text-muted-foreground py-8">
                <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Zadaj pytanie o trendy biznesowe Twojego salonu</p>
                <div className="mt-4 space-y-2">
                  <button
                    onClick={() => setInput("Jakie trendy widzisz w moich danych?")}
                    className="block mx-auto text-xs text-primary hover:underline"
                  >
                    &quot;Jakie trendy widzisz w moich danych?&quot;
                  </button>
                  <button
                    onClick={() => setInput("Ktore uslugi rosna, a ktore spadaja?")}
                    className="block mx-auto text-xs text-primary hover:underline"
                  >
                    &quot;Ktore uslugi rosna, a ktore spadaja?&quot;
                  </button>
                  <button
                    onClick={() => setInput("Jak poprawic wskaznik anulacji?")}
                    className="block mx-auto text-xs text-primary hover:underline"
                  >
                    &quot;Jak poprawic wskaznik anulacji?&quot;
                  </button>
                </div>
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`p-3 rounded-lg ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground ml-auto max-w-[80%]"
                    : "bg-muted max-w-[80%]"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium">{msg.role === "user" ? "Ty" : "AI"}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted max-w-[80%]">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">AI analizuje trendy...</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Zapytaj o trendy..."
              className="flex-1 p-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm"
              disabled={loading}
            />
            <Button type="submit" size="sm" disabled={!input.trim() || loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
