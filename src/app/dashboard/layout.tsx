import { redirect } from "next/navigation";
import { DashboardSidebar, DashboardMobileHeader } from "@/components/dashboard/dashboard-sidebar";
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
    <div className="flex min-h-[calc(100vh-4rem)]">
      <DashboardSidebar />
      <div className="flex-1 flex flex-col overflow-auto">
        <DashboardMobileHeader />
        {children}
      </div>
    </div>
  );
}
