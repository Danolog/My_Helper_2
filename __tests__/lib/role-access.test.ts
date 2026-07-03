/**
 * Faza 3 — dostep do tras dashboardu wg roli salonu.
 *
 * Kontrakt isRouteAllowedForRole:
 *   - owner => zawsze true (kazda trasa),
 *   - "/dashboard" (dokladne dopasowanie) => wszyscy,
 *   - wpis w ROUTE_ROLE_MAP => wg listy rol (dopasowanie po prefiksie),
 *   - brak wpisu => tylko owner (bezpieczny default — nowe sekcje nie
 *     wyciekaja do pracownikow).
 */
import { describe, it, expect } from "vitest";
import { isRouteAllowedForRole, ROUTE_ROLE_MAP } from "@/lib/role-access";

describe("isRouteAllowedForRole", () => {
  it("owner ma dostep do wszystkiego, takze tras spoza mapy", () => {
    expect(isRouteAllowedForRole("/dashboard", "owner")).toBe(true);
    expect(isRouteAllowedForRole("/dashboard/settings", "owner")).toBe(true);
    expect(isRouteAllowedForRole("/dashboard/reports/revenue", "owner")).toBe(true);
    expect(isRouteAllowedForRole("/dashboard/cokolwiek-nowego", "owner")).toBe(true);
  });

  it("pulpit /dashboard (exact) jest dostepny dla kazdej roli", () => {
    expect(isRouteAllowedForRole("/dashboard", "receptionist")).toBe(true);
    expect(isRouteAllowedForRole("/dashboard", "employee")).toBe(true);
  });

  it("kalendarz jest dostepny dla recepcji i pracownika", () => {
    expect(isRouteAllowedForRole("/dashboard/calendar", "receptionist")).toBe(true);
    expect(isRouteAllowedForRole("/dashboard/calendar", "employee")).toBe(true);
  });

  it("booking i clients: recepcja tak, pracownik nie", () => {
    expect(isRouteAllowedForRole("/dashboard/booking", "receptionist")).toBe(true);
    expect(isRouteAllowedForRole("/dashboard/booking", "employee")).toBe(false);
    expect(isRouteAllowedForRole("/dashboard/clients", "receptionist")).toBe(true);
    expect(isRouteAllowedForRole("/dashboard/clients", "employee")).toBe(false);
  });

  it("galeria: pracownik tak, recepcja nie", () => {
    expect(isRouteAllowedForRole("/dashboard/gallery", "employee")).toBe(true);
    expect(isRouteAllowedForRole("/dashboard/gallery", "receptionist")).toBe(false);
  });

  it("dopasowanie po prefiksie obejmuje podstrony", () => {
    expect(isRouteAllowedForRole("/dashboard/clients/abc-123", "receptionist")).toBe(true);
    expect(isRouteAllowedForRole("/dashboard/gallery/upload", "employee")).toBe(true);
  });

  it("prefiks nie dopasowuje trasy o podobnej nazwie (np. /dashboard/clients-import)", () => {
    // startsWith(`${prefix}/`) — sam poczatek nazwy katalogu nie wystarcza
    expect(isRouteAllowedForRole("/dashboard/clients-import", "receptionist")).toBe(false);
  });

  it("settings sa tylko dla ownera", () => {
    expect(isRouteAllowedForRole("/dashboard/settings", "receptionist")).toBe(false);
    expect(isRouteAllowedForRole("/dashboard/settings", "employee")).toBe(false);
    expect(isRouteAllowedForRole("/dashboard/settings", "owner")).toBe(true);
  });

  it("trasa bez wpisu w mapie (np. /dashboard/reports) => tylko owner", () => {
    expect(
      ROUTE_ROLE_MAP.some((e) => "/dashboard/reports".startsWith(e.prefix))
    ).toBe(false);
    expect(isRouteAllowedForRole("/dashboard/reports", "receptionist")).toBe(false);
    expect(isRouteAllowedForRole("/dashboard/reports", "employee")).toBe(false);
    expect(isRouteAllowedForRole("/dashboard/reports", "owner")).toBe(true);
  });
});
