/**
 * Linki nawigacji stron publicznych i portalu klienta (nagłówek strony,
 * menu mobilne, nagłówek portalu). Jedno miejsce, w którym linki do modułów
 * zamrożonych znikają: katalog salonów (`salonCatalog`) i ulubione
 * (`favoriteSalons`) są pokazywane tylko, gdy moduł nie ma `hardOff`
 * w `src/lib/features.ts`. Pilnuje `__tests__/lib/site-nav-links.test.ts`.
 */
import { isModuleFrozen, type ModuleKey } from "@/lib/features";

export interface SiteNavLink {
  href: string;
  label: string;
}

interface ModuleNavLink extends SiteNavLink {
  /** Moduł, bez którego link prowadziłby donikąd (null = zawsze widoczny). */
  module: ModuleKey | null;
}

function visible(links: readonly ModuleNavLink[]): SiteNavLink[] {
  return links
    .filter((link) => link.module === null || !isModuleFrozen(link.module))
    .map(({ href, label }) => ({ href, label }));
}

/** Gość: oferta dla salonów na stronie głównej i (przy katalogu) wejście dla klientów. */
export function guestNavLinks(): SiteNavLink[] {
  return visible([
    { href: "/#features", label: "Funkcje", module: null },
    { href: "/#pricing", label: "Cennik", module: null },
    { href: "/dla-klientow", label: "Dla klientów", module: "salonCatalog" },
  ]);
}

/** Zalogowany klient (konto bez salonu): wizyty i — przy odmrożeniu — katalog i ulubione. */
export function clientNavLinks(): SiteNavLink[] {
  return visible([
    { href: "/salons", label: "Salony", module: "salonCatalog" },
    { href: "/appointments", label: "Moje wizyty", module: null },
    { href: "/favorites", label: "Ulubione", module: "favoriteSalons" },
  ]);
}

/**
 * Nagłówek portalu klienta (`ClientHeader`): katalog przy odmrożeniu,
 * „Moje wizyty” tylko z sesją.
 */
export function clientPortalNavLinks(hasSession: boolean): SiteNavLink[] {
  return visible([
    { href: "/salons", label: "Salony", module: "salonCatalog" },
    ...(hasSession ? [{ href: "/appointments", label: "Moje wizyty", module: null }] : []),
  ]);
}

/** Dokąd prowadzi logo portalu klienta: strona dla klientów albo strona główna. */
export function clientPortalHomeHref(): string {
  return isModuleFrozen("salonCatalog") ? "/" : "/dla-klientow";
}
