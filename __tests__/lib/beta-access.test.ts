import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BETA_INVITE_ONLY_MESSAGE,
  betaAllowedOwnerEmails,
  isBetaOwnerAllowed,
} from "@/lib/beta-access";
import { SUPPORT_CONTACT } from "@/lib/support-contact";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isBetaOwnerAllowed — lista z argumentu", () => {
  const LIST = "owner-a@example.com, Owner-B@Example.com ,owner-c@example.com";

  it("e-mail na liście → true", () => {
    expect(isBetaOwnerAllowed("owner-a@example.com", LIST)).toBe(true);
  });

  it("e-mail spoza listy → false", () => {
    expect(isBetaOwnerAllowed("intruz@example.com", LIST)).toBe(false);
  });

  it("wielkość liter i spacje po obu stronach nie mają znaczenia", () => {
    expect(isBetaOwnerAllowed("OWNER-B@example.COM", LIST)).toBe(true);
    expect(isBetaOwnerAllowed("  owner-c@example.com  ", LIST)).toBe(true);
  });

  it("dopasowanie całego adresu, nie fragmentu ani domeny", () => {
    expect(isBetaOwnerAllowed("a@example.com", LIST)).toBe(false);
    expect(isBetaOwnerAllowed("example.com", LIST)).toBe(false);
    expect(isBetaOwnerAllowed("owner-a@example.com.evil", LIST)).toBe(false);
  });

  it.each([
    ["pusta lista", ""],
    ["same przecinki i spacje", " , ,, "],
    ["brak zmiennej", undefined],
  ])("%s → nikt (domyślnie zamknięte)", (_n, raw) => {
    expect(isBetaOwnerAllowed("owner-a@example.com", raw)).toBe(false);
    expect(betaAllowedOwnerEmails(raw)).toEqual([]);
  });

  it.each([null, undefined, "", "   "])("pusty e-mail konta (%j) → false, także przy pustych wpisach listy", (email) => {
    expect(isBetaOwnerAllowed(email, "owner-a@example.com,,")).toBe(false);
  });
});

describe("isBetaOwnerAllowed — zmienna BETA_ALLOWED_OWNER_EMAILS", () => {
  it("czyta listę ze zmiennej środowiskowej przy każdym wywołaniu", () => {
    vi.stubEnv("BETA_ALLOWED_OWNER_EMAILS", "owner-a@example.com");
    expect(isBetaOwnerAllowed("owner-a@example.com")).toBe(true);

    vi.stubEnv("BETA_ALLOWED_OWNER_EMAILS", "");
    expect(isBetaOwnerAllowed("owner-a@example.com")).toBe(false);
  });

  it("bez zmiennej nikt nie może założyć salonu, także poza produkcją", () => {
    vi.stubEnv("BETA_ALLOWED_OWNER_EMAILS", undefined);
    vi.stubEnv("NODE_ENV", "development");
    expect(isBetaOwnerAllowed("owner-a@example.com")).toBe(false);
  });
});

describe("BETA_INVITE_ONLY_MESSAGE", () => {
  it("mówi o zaproszeniu i podaje kontakt wsparcia", () => {
    expect(BETA_INVITE_ONLY_MESSAGE).toMatch(/zaproszenie/);
    expect(BETA_INVITE_ONLY_MESSAGE).toContain(SUPPORT_CONTACT);
  });
});
