import { describe, it, expect } from "vitest";
import { verifiedClientMatchEmail } from "@/lib/client-match";

describe("verifiedClientMatchEmail — dopasowanie konta do klienta tylko po zweryfikowanym e-mailu", () => {
  it("zweryfikowany e-mail => e-mail (bez zmian, porownanie dokladne jak dotad)", () => {
    expect(verifiedClientMatchEmail({ email: "Anna@Example.com", emailVerified: true })).toBe(
      "Anna@Example.com"
    );
  });

  it("niezweryfikowany e-mail => null", () => {
    expect(verifiedClientMatchEmail({ email: "anna@example.com", emailVerified: false })).toBeNull();
  });

  it("brak flagi emailVerified albo null => null", () => {
    expect(verifiedClientMatchEmail({ email: "anna@example.com" })).toBeNull();
    expect(verifiedClientMatchEmail({ email: "anna@example.com", emailVerified: null })).toBeNull();
  });

  it("flaga inna niz dokladnie true (np. string z zewnatrz) => null", () => {
    expect(
      verifiedClientMatchEmail({
        email: "anna@example.com",
        emailVerified: "true" as unknown as boolean,
      })
    ).toBeNull();
  });

  it("brak sesji (null/undefined) => null", () => {
    expect(verifiedClientMatchEmail(null)).toBeNull();
    expect(verifiedClientMatchEmail(undefined)).toBeNull();
  });

  it("zweryfikowany, ale pusty lub brakujacy e-mail => null", () => {
    expect(verifiedClientMatchEmail({ email: "", emailVerified: true })).toBeNull();
    expect(verifiedClientMatchEmail({ email: "   ", emailVerified: true })).toBeNull();
    expect(verifiedClientMatchEmail({ email: null, emailVerified: true })).toBeNull();
    expect(verifiedClientMatchEmail({ emailVerified: true })).toBeNull();
  });
});
