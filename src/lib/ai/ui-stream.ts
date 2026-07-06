/**
 * Parsing of AI SDK UI Message Stream lines (SSE) into text deltas.
 *
 * AI SDK 5 `toUIMessageStreamResponse()` emits chunks like:
 *   data: {"type":"text-start","id":"..."}
 *   data: {"type":"text-delta","id":"...","delta":"..."}
 *   data: {"type":"text-end","id":"..."}
 *   data: {"type":"error","errorText":"..."}
 *   data: [DONE]
 *
 * Older code emitted {"type":"text","text":"..."} and the legacy
 * Data Stream Protocol (`0:"..."` lines) — both remain supported.
 */

export interface UIStreamLineResult {
  /** Text fragment to append to the assistant message, if any. */
  textDelta?: string;
  /** Error reported inside the stream, if any. */
  error?: string;
}

export function parseUIStreamLine(line: string): UIStreamLineResult {
  const trimmed = line.trim();
  if (!trimmed) return {};

  if (trimmed.startsWith("data: ")) {
    const payload = trimmed.slice(6);
    if (payload === "[DONE]") return {};

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return {};
    }
    if (typeof parsed !== "object" || parsed === null) return {};

    const chunk = parsed as {
      type?: string;
      delta?: unknown;
      text?: unknown;
      errorText?: unknown;
    };

    if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
      return { textDelta: chunk.delta };
    }
    if (chunk.type === "text" && typeof chunk.text === "string") {
      return { textDelta: chunk.text };
    }
    if (chunk.type === "error" && typeof chunk.errorText === "string") {
      return { error: chunk.errorText };
    }
    return {};
  }

  // Legacy Data Stream Protocol: 0:"text content"
  if (trimmed.startsWith("0:")) {
    try {
      const textContent = JSON.parse(trimmed.slice(2));
      if (typeof textContent === "string") return { textDelta: textContent };
    } catch {
      // Not valid JSON, skip
    }
    return {};
  }

  return {};
}
