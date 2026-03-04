import { describe, it, expect } from "vitest";
import {
  isValidUuid,
  isValidDateString,
  validatePhone,
  validateEmail,
} from "@/lib/validations";

describe("isValidUuid", () => {
  it("should return true for a valid UUID v4", () => {
    expect(isValidUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("should return true for uppercase UUID", () => {
    expect(isValidUuid("550E8400-E29B-41D4-A716-446655440000")).toBe(true);
  });

  it("should return true for mixed case UUID", () => {
    expect(isValidUuid("550e8400-E29B-41d4-a716-446655440000")).toBe(true);
  });

  it("should return false for empty string", () => {
    expect(isValidUuid("")).toBe(false);
  });

  it("should return false for random string", () => {
    expect(isValidUuid("not-a-uuid")).toBe(false);
  });

  it("should return false for UUID without dashes", () => {
    expect(isValidUuid("550e8400e29b41d4a716446655440000")).toBe(false);
  });

  it("should return false for UUID with wrong segment length", () => {
    expect(isValidUuid("550e840-e29b-41d4-a716-446655440000")).toBe(false);
  });

  it("should return false for UUID with invalid characters", () => {
    expect(isValidUuid("550e8400-e29b-41d4-a716-44665544000g")).toBe(false);
  });

  it("should return false for UUID with extra characters", () => {
    expect(isValidUuid("550e8400-e29b-41d4-a716-4466554400001")).toBe(false);
  });
});

describe("isValidDateString", () => {
  it("should return true for ISO date string", () => {
    expect(isValidDateString("2024-01-15")).toBe(true);
  });

  it("should return true for ISO datetime string", () => {
    expect(isValidDateString("2024-01-15T10:30:00.000Z")).toBe(true);
  });

  it("should return true for date with time", () => {
    expect(isValidDateString("2024-01-15T10:30:00")).toBe(true);
  });

  it("should return true for human-readable date format", () => {
    expect(isValidDateString("January 15, 2024")).toBe(true);
  });

  it("should return false for invalid date string", () => {
    expect(isValidDateString("not-a-date")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isValidDateString("")).toBe(false);
  });

  it("should return false for gibberish", () => {
    expect(isValidDateString("xyz123abc")).toBe(false);
  });
});

describe("validatePhone", () => {
  it("should return null for empty string (phone is optional)", () => {
    expect(validatePhone("")).toBeNull();
  });

  it("should return null for whitespace-only string", () => {
    expect(validatePhone("   ")).toBeNull();
  });

  it("should return null for valid Polish mobile number", () => {
    expect(validatePhone("+48 123 456 789")).toBeNull();
  });

  it("should return null for valid number without country code", () => {
    expect(validatePhone("123456789")).toBeNull();
  });

  it("should return null for number with dashes", () => {
    expect(validatePhone("+48-123-456-789")).toBeNull();
  });

  it("should return null for number with parentheses", () => {
    expect(validatePhone("+1 (555) 123-4567")).toBeNull();
  });

  it("should return null for compact international number", () => {
    expect(validatePhone("+48123456789")).toBeNull();
  });

  it("should return error for number with letters", () => {
    const result = validatePhone("123abc456");
    expect(result).not.toBeNull();
    expect(result).toContain("cyfry");
  });

  it("should return error for number with special characters", () => {
    const result = validatePhone("123@456#789");
    expect(result).not.toBeNull();
  });

  it("should return error for too few digits (less than 7)", () => {
    const result = validatePhone("12345");
    expect(result).not.toBeNull();
    expect(result).toContain("7 cyfr");
  });

  it("should return null for exactly 7 digits", () => {
    expect(validatePhone("1234567")).toBeNull();
  });

  it("should return null for exactly 15 digits (E.164 max)", () => {
    expect(validatePhone("123456789012345")).toBeNull();
  });

  it("should return error for more than 15 digits", () => {
    const result = validatePhone("1234567890123456");
    expect(result).not.toBeNull();
    expect(result).toContain("15");
  });
});

describe("validateEmail", () => {
  it("should return null for empty string (email is optional)", () => {
    expect(validateEmail("")).toBeNull();
  });

  it("should return null for whitespace-only string", () => {
    expect(validateEmail("   ")).toBeNull();
  });

  it("should return null for valid email", () => {
    expect(validateEmail("test@example.com")).toBeNull();
  });

  it("should return null for email with subdomain", () => {
    expect(validateEmail("user@mail.example.com")).toBeNull();
  });

  it("should return null for email with plus addressing", () => {
    expect(validateEmail("user+tag@example.com")).toBeNull();
  });

  it("should return error for email without @", () => {
    const result = validateEmail("testexample.com");
    expect(result).not.toBeNull();
    expect(result).toContain("email");
  });

  it("should return error for email without domain", () => {
    const result = validateEmail("test@");
    expect(result).not.toBeNull();
  });

  it("should return error for email without TLD", () => {
    const result = validateEmail("test@example");
    expect(result).not.toBeNull();
  });

  it("should return error for email with spaces", () => {
    const result = validateEmail("test @example.com");
    expect(result).not.toBeNull();
  });

  it("should handle email with leading/trailing spaces (trims before check)", () => {
    // The function trims the email, so leading/trailing spaces should be okay
    expect(validateEmail(" test@example.com ")).toBeNull();
  });
});
