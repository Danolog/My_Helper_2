"use client";

import { createContext, useContext } from "react";
import { DEFAULT_MODULES, type ModuleKey, type ModulesState } from "@/lib/features";

/**
 * Kontekst feature flags salonu (Faza 2). Stan jest rozwiązywany serwerowo
 * w layoutcie dashboardu (getSalonModules) i przekazywany tutaj — komponenty
 * klienckie (sidebar, bottom nav, command palette, bramki stron) czytają go
 * przez useModules()/useModuleEnabled() bez dodatkowych fetchy.
 */
const ModulesContext = createContext<ModulesState>(DEFAULT_MODULES);

export function ModulesProvider({
  modules,
  children,
}: {
  modules: ModulesState;
  children: React.ReactNode;
}) {
  return <ModulesContext.Provider value={modules}>{children}</ModulesContext.Provider>;
}

export function useModules(): ModulesState {
  return useContext(ModulesContext);
}

export function useModuleEnabled(key: ModuleKey): boolean {
  return useContext(ModulesContext)[key];
}
