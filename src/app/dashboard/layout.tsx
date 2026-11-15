import { redirect } from "next/navigation";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { DashboardBottomNav } from "@/components/dashboard/dashboard-bottom-nav";
import { DashboardBreadcrumbs } from "@/components/dashboard/dashboard-breadcrumbs";
import { DashboardSidebar, DashboardMobileHeader } from "@/components/dashboard/dashboard-sidebar";
import { ModulesProvider } from "@/components/dashboard/modules-provider";
import { RoleProvider } from "@/components/dashboard/role-provider";
import { DEFAULT_MODULES } from "@/lib/features";
import { getSalonContext } from "@/lib/salon-context";
import { getSalonModules } from "@/lib/server/modules";
import { requireDashboardAccess } from "@/lib/session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Faza 3 — do dashboardu wchodzi wlasciciel ORAZ aktywny pracownik/recepcja
  // z podpietym kontem; pozostali jak dotychczas na /salons.
  const { allowed, role } = await requireDashboardAccess();

  if (!allowed) {
    redirect("/salons");
  }

  // Feature flags salonu (Faza 2) — rozwiązane raz na request, dostępne
  // w komponentach klienckich przez useModules(). salonId z getSalonContext
  // (nie getUserSalonId): pracownik/recepcja nie jest wlascicielem, a ma
  // widziec moduly SWOJEGO salonu. Brak salonu = domyślny chudy interfejs.
  const ctx = await getSalonContext();
  const modules = ctx ? await getSalonModules(ctx.salonId) : DEFAULT_MODULES;

  return (
    <RoleProvider role={role ?? "owner"}>
      <ModulesProvider modules={modules}>
        <div className="flex min-h-screen">
          <DashboardSidebar />
          <div className="flex-1 flex flex-col overflow-auto pb-20 md:pb-0">
            <DashboardMobileHeader />
            <DashboardBreadcrumbs />
            {children}
          </div>
          <DashboardBottomNav />
          <CommandPalette />
        </div>
      </ModulesProvider>
    </RoleProvider>
  );
}
