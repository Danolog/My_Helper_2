import { describe, it, expect } from "vitest";
import {
  cancelSuccessDescription,
  formatDate,
} from "@/app/dashboard/subscription/_types";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const NOT_RENEWED_TEXT = "Subskrypcja nie zostanie odnowiona.";

function activeText(periodEnd: string): string {
  return `Dostep do planu jest aktywny do ${formatDate(periodEnd)}. Subskrypcja nie zostanie odnowiona.`;
}

describe("cancelSuccessDescription", () => {
  it("period end in the future returns the text with the formatted end date", () => {
    const periodEnd = "2026-12-19T12:00:00.000Z";
    expect(cancelSuccessDescription(periodEnd, NOW)).toBe(
      activeText(periodEnd),
    );
  });

  it("period end one millisecond after now returns the text with the formatted end date", () => {
    const periodEnd = new Date(NOW.getTime() + 1).toISOString();
    expect(cancelSuccessDescription(periodEnd, NOW)).toBe(
      activeText(periodEnd),
    );
  });

  it("period end equal to now returns the text without an access date", () => {
    expect(cancelSuccessDescription(NOW.toISOString(), NOW)).toBe(NOT_RENEWED_TEXT);
  });

  it("period end in the past returns the text without an access date", () => {
    expect(
      cancelSuccessDescription("2026-10-19T12:00:00.000Z", NOW),
    ).toBe(NOT_RENEWED_TEXT);
  });

  it("null period end returns the text without an access date", () => {
    expect(cancelSuccessDescription(null, NOW)).toBe(NOT_RENEWED_TEXT);
  });

  it("undefined period end returns the text without an access date", () => {
    expect(cancelSuccessDescription(undefined, NOW)).toBe(NOT_RENEWED_TEXT);
  });

  it("empty string period end returns the text without an access date", () => {
    expect(cancelSuccessDescription("", NOW)).toBe(NOT_RENEWED_TEXT);
  });

  it("invalid date period end returns the text without an access date", () => {
    expect(cancelSuccessDescription("not-a-date", NOW)).toBe(NOT_RENEWED_TEXT);
  });
});
