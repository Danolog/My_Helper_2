/**
 * Linki nawigacji stron publicznych i portalu klienta (`src/lib/site-nav-links.ts`).
 *
 * Katalog salonów (`salonCatalog`) i ulubione (`favoriteSalons`) są zamrożone:
 * linki do nich znikają z nagłówka, menu mobilnego i nagłówka portalu, a logo
 * portalu prowadzi na stronę główną. Atrapa rejestru pozwala sprawdzić też
 * stan po odmrożeniu — linki wracają bez zmiany komponentów.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  clientNavLinks,
  clientPortalHomeHref,
  clientPortalNavLinks,
  guestNavLinks,
} from "@/lib/site-nav-links";
import type { ModuleKey } from "@/lib/features";

const state = vi.hoisted(() => ({ override: null as null | Partial<Record<string, boolean>> }));

vi.mock("@/lib/features", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/features")>();
  return {
    ...actual,
    isModuleFrozen: (key: ModuleKey) => state.override?.[key] ?? actual.isModuleFrozen(key),
  };
});

const hrefs = (links: { href: string }[]) => links.map((l) => l.href);

describe("rejestr bez atrapy: katalog i ulubione zamrożone", () => {
  beforeEach(() => {
    state.override = null;
  });

  it("gość: funkcje i cennik na stronie głównej, bez „Dla klientów”", () => {
    expect(guestNavLinks()).toEqual([
      { href: "/#features", label: "Funkcje" },
      { href: "/#pricing", label: "Cennik" },
    ]);
  });

  it("klient: tylko „Moje wizyty” (bez katalogu i ulubionych)", () => {
    expect(clientNavLinks()).toEqual([{ href: "/appointments", label: "Moje wizyty" }]);
  });

  it("nagłówek portalu: z sesją „Moje wizyty”, bez sesji nic", () => {
    expect(hrefs(clientPortalNavLinks(true))).toEqual(["/appointments"]);
    expect(clientPortalNavLinks(false)).toEqual([]);
  });

  it("logo portalu prowadzi na stronę główną", () => {
    expect(clientPortalHomeHref()).toBe("/");
  });

  it("żaden link nie prowadzi na stronę przekierowaną przez proxy", () => {
    const all = [
      ...guestNavLinks(),
      ...clientNavLinks(),
      ...clientPortalNavLinks(true),
      { href: clientPortalHomeHref() },
    ];
    for (const href of hrefs(all)) {
      expect(href).not.toMatch(/^\/(salons|favorites|dla-klientow|dla-salonow|client\/)/);
    }
  });
});

describe("po odmrożeniu linki wracają", () => {
  beforeEach(() => {
    state.override = { salonCatalog: false, favoriteSalons: false };
  });

  it("gość widzi „Dla klientów”", () => {
    expect(hrefs(guestNavLinks())).toEqual(["/#features", "/#pricing", "/dla-klientow"]);
  });

  it("klient widzi katalog, wizyty i ulubione", () => {
    expect(hrefs(clientNavLinks())).toEqual(["/salons", "/appointments", "/favorites"]);
  });

  it("portal: katalog zawsze, wizyty z sesją; logo na stronę dla klientów", () => {
    expect(hrefs(clientPortalNavLinks(true))).toEqual(["/salons", "/appointments"]);
    expect(hrefs(clientPortalNavLinks(false))).toEqual(["/salons"]);
    expect(clientPortalHomeHref()).toBe("/dla-klientow");
  });

  it("ulubione można odmrozić niezależnie od katalogu", () => {
    state.override = { salonCatalog: true, favoriteSalons: false };
    expect(hrefs(clientNavLinks())).toEqual(["/appointments", "/favorites"]);
  });
});
