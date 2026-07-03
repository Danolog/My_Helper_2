import { redirect } from "next/navigation";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { DashboardBottomNav } from "@/components/dashboard/dashboard-bottom-nav";
import { DashboardBreadcrumbs } from "@/components/dashboard/dashboard-breadcrumbs";
import { DashboardSidebar, DashboardMobileHeader } from "@/components/dashboard/dashboard-sidebar";
import { ModulesProvider } from "@/components/dashboard/modules-provider";
import { VoiceCommandButton } from "@/components/dashboard/voice-command-button";
import { DEFAULT_MODULES } from "@/lib/features";
import { getUserSalonId } from "@/lib/get-user-salon";
import { getSalonModules } from "@/lib/server/modules";
import { requireAdmin } from "@/lib/session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAdmin } = await requireAdmin();

  if (!isAdmin) {
    redirect("/salons");
  }

  // Feature flags salonu (Faza 2) — rozwiązane raz na request, dostępne
  // w komponentach klienckich przez useModules(). Brak salonu = domyślny
  // chudy interfejs.
  const salonId = await getUserSalonId();
  const modules = salonId ? await getSalonModules(salonId) : DEFAULT_MODULES;

  return (
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
        <VoiceCommandButton />
      </div>
    </ModulesProvider>
  );
}
