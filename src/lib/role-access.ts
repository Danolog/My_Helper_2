import type { SalonRole } from "@/lib/salon-context";

/**
 * Mapa dostępu tras dashboardu wg roli salonu (Faza 3 — role
 * pracownik/recepcja). Jedno źródło prawdy dla nawigacji (sidebar,
 * bottom nav, command palette) i bramek stron (RoleGate).
 *
 * Ścieżka bez wpisu = tylko właściciel (bezpieczny default — nowe sekcje
 * nie wyciekają do pracowników). Właściciel widzi wszystko, więc mapa
 * wymienia wyłącznie role nie-właścicielskie.
 */
export const ROUTE_ROLE_MAP: ReadonlyArray<{
  prefix: string;
  roles: ReadonlyArray<Exclude<SalonRole, "owner">>;
}> = [
  { prefix: "/dashboard/calendar", roles: ["receptionist", "employee"] },
  { prefix: "/dashboard/booking", roles: ["receptionist"] },
  { prefix: "/dashboard/clients", roles: ["receptionist"] },
  { prefix: "/dashboard/gallery", roles: ["employee"] },
];

/**
 * Czy trasa `pathname` jest dostępna dla roli `role`?
 * - owner => zawsze true (zachowanie identyczne jak przed Fazą 3),
 * - "/dashboard" (pulpit, dokładne dopasowanie) => wszyscy,
 * - inaczej wg ROUTE_ROLE_MAP (prefiks); brak wpisu => tylko owner.
 */
export function isRouteAllowedForRole(
  pathname: string,
  role: SalonRole
): boolean {
  if (role === "owner") return true;
  if (pathname === "/dashboard") return true;

  const entry = ROUTE_ROLE_MAP.find(
    (e) => pathname === e.prefix || pathname.startsWith(`${e.prefix}/`)
  );
  return entry ? entry.roles.includes(role) : false;
}
