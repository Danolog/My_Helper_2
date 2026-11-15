import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
import { maskPhoneNumber, normalizePolishPhoneNumber } from "@/lib/phone";
import { normalizePolishPhoneNumber as fromSms } from "@/lib/sms";

describe("normalizePolishPhoneNumber (E.164)", () => {
  it.each([
    ["123456789", "+48123456789"],
    ["+48123456789", "+48123456789"],
    ["+48 123 456 789", "+48123456789"],
    ["123-456-789", "+48123456789"],
  ])("%s → %s", (input, out) => {
    expect(normalizePolishPhoneNumber(input)).toBe(out);
  });

  it.each(["12345", "1234567890", "+49123456789", "48123456789", ""])("%j → null", (input) => {
    expect(normalizePolishPhoneNumber(input)).toBeNull();
  });

  it("re-eksport z @/lib/sms to ta sama funkcja", () => {
    expect(fromSms).toBe(normalizePolishPhoneNumber);
  });
});

describe("maskPhoneNumber", () => {
  it.each([
    ["+48 123 456 789", "***789"],
    ["123456789", "***789"],
    ["12", "***"],
    [null, "***"],
    [undefined, "***"],
  ])("%j → %s", (input, out) => {
    expect(maskPhoneNumber(input)).toBe(out);
  });
});
