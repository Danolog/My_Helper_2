"use client";

import { createContext, useContext } from "react";
import type { SalonRole } from "@/lib/salon-context";

/**
 * Kontekst roli salonu (Faza 3 — role pracownik/recepcja). Rola jest
 * rozwiązywana serwerowo w layoutcie dashboardu (requireDashboardAccess)
 * i przekazywana tutaj — komponenty klienckie (sidebar, bottom nav,
 * command palette, bramki stron) czytają ją przez useSalonRole() bez
 * dodatkowych fetchy.
 *
 * Default "owner" — bezpieczny dla renderów bez providera (istniejące
 * testy/strony poza dashboardem zachowują dzisiejszy widok właściciela).
 */
const RoleContext = createContext<SalonRole>("owner");

export function RoleProvider({
  role,
  children,
}: {
  role: SalonRole;
  children: React.ReactNode;
}) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useSalonRole(): SalonRole {
  return useContext(RoleContext);
}
