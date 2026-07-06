import { describe, it, expect } from "vitest";
import { parseUIStreamLine } from "@/lib/ai/ui-stream";

describe("parseUIStreamLine", () => {
  describe("AI SDK 5 UI Message Stream protocol (text-delta)", () => {
    it("extracts delta text from text-delta chunk", () => {
      const line = 'data: {"type":"text-delta","id":"msg_1","delta":"Witaj"}';
      expect(parseUIStreamLine(line)).toEqual({ textDelta: "Witaj" });
    });

    it("accumulates full text across multiple text-delta chunks", () => {
      const lines = [
        'data: {"type":"text-start","id":"msg_1"}',
        'data: {"type":"text-delta","id":"msg_1","delta":"Twój salon "}',
        'data: {"type":"text-delta","id":"msg_1","delta":"ma 1 wizytę."}',
        'data: {"type":"text-end","id":"msg_1"}',
        "data: [DONE]",
      ];
      const text = lines
        .map((l) => parseUIStreamLine(l).textDelta ?? "")
        .join("");
      expect(text).toBe("Twój salon ma 1 wizytę.");
    });

    it("ignores non-text chunks (start, finish, tool calls)", () => {
      expect(parseUIStreamLine('data: {"type":"start"}')).toEqual({});
      expect(parseUIStreamLine('data: {"type":"finish"}')).toEqual({});
      expect(
        parseUIStreamLine('data: {"type":"tool-input-start","toolCallId":"t1"}'),
      ).toEqual({});
    });

    it("surfaces stream errors via errorText", () => {
      const line = 'data: {"type":"error","errorText":"Limit AI wyczerpany"}';
      expect(parseUIStreamLine(line)).toEqual({ error: "Limit AI wyczerpany" });
    });
  });

  describe("backward compatibility", () => {
    it('supports legacy {"type":"text","text":...} chunks', () => {
      const line = 'data: {"type":"text","text":"Czesc"}';
      expect(parseUIStreamLine(line)).toEqual({ textDelta: "Czesc" });
    });

    it('supports legacy Data Stream Protocol 0:"..." lines', () => {
      expect(parseUIStreamLine('0:"Hello "')).toEqual({ textDelta: "Hello " });
    });
  });

  describe("robustness", () => {
    it("returns empty result for [DONE], blank and malformed lines", () => {
      expect(parseUIStreamLine("data: [DONE]")).toEqual({});
      expect(parseUIStreamLine("")).toEqual({});
      expect(parseUIStreamLine("data: {not json")).toEqual({});
      expect(parseUIStreamLine("0:{bad")).toEqual({});
    });

    it("ignores text-delta with non-string delta", () => {
      expect(
        parseUIStreamLine('data: {"type":"text-delta","delta":42}'),
      ).toEqual({});
    });
  });
});
