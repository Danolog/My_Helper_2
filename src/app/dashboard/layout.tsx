import { redirect } from "next/navigation";
import { CommandPalette } from "@/components/dashboard/command-palette";
import { DashboardBottomNav } from "@/components/dashboard/dashboard-bottom-nav";
import { DashboardBreadcrumbs } from "@/components/dashboard/dashboard-breadcrumbs";
import { DashboardSidebar, DashboardMobileHeader } from "@/components/dashboard/dashboard-sidebar";
import { VoiceCommandButton } from "@/components/dashboard/voice-command-button";
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
  return (
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
  );
}
