"use client";

import { Brain, Loader2, Send, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "./copy-button";
import { markdownComponents } from "./markdown-components";
import { SUGGESTED_PROMPTS } from "../_types";
import type { ChatMessage } from "../_types";

interface ChatTabProps {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  loading: boolean;
  sendMessage: (text?: string) => Promise<void>;
  clearChat: () => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export function ChatTab({
  messages,
  input,
  setInput,
  loading,
  sendMessage,
  clearChat,
  chatEndRef,
  inputRef,
}: ChatTabProps) {
  return (
    <Card className="border-0 shadow-none">
      <CardContent className="p-0">
        {/* Chat messages area */}
        <div className="min-h-[400px] max-h-[500px] overflow-y-auto space-y-3 mb-4 p-1">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <Brain className="h-12 w-12 mx-auto mb-4 text-primary/30" />
              <h3 className="font-medium mb-2">
                Asystent biznesowy AI
              </h3>
              <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                Zapytaj o wyniki Twojego salonu. AI analizuje rzeczywiste
                dane z bazy danych - wizyty, przychody, klientow,
                pracownikow, opinie i magazyn.
              </p>

              {/* Suggested prompts */}
              <div className="grid gap-2 max-w-lg mx-auto grid-cols-1 sm:grid-cols-2">
                {SUGGESTED_PROMPTS.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => sendMessage(prompt)}
                    className="text-left text-xs p-3 border rounded-lg hover:bg-muted transition-colors"
                  >
                    <Sparkles className="h-3 w-3 text-primary inline mr-1.5" />
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`group p-3 rounded-lg ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground ml-auto max-w-[85%]"
                  : "bg-muted max-w-[85%]"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">
                    {msg.role === "user" ? "Ty" : "AI Asystent"}
                  </span>
                  <span className="text-xs opacity-60">
                    {msg.timestamp.toLocaleTimeString("pl-PL", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {msg.role === "assistant" && msg.text && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <CopyButton text={msg.text} />
                  </div>
                )}
              </div>
              <div className="prose prose-sm max-w-none">
                {msg.role === "assistant" ? (
                  <ReactMarkdown components={markdownComponents}>
                    {msg.text}
                  </ReactMarkdown>
                ) : (
                  <p className="text-sm whitespace-pre-wrap">
                    {msg.text}
                  </p>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted max-w-[85%]">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">
                AI analizuje dane salonu...
              </span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="border-t pt-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="flex gap-2"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Zapytaj o wyniki salonu..."
              className="flex-1 p-2.5 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-sm"
              disabled={loading}
            />
            <Button
              type="submit"
              disabled={!input.trim() || loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
          {messages.length > 0 && (
            <div className="flex justify-end mt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={clearChat}
                className="text-xs text-muted-foreground"
              >
                Wyczysc rozmowe
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
