import { DashboardSidebar, DashboardMobileHeader } from "@/components/dashboard/dashboard-sidebar";

/**
 * Dashboard layout wraps all /dashboard/* pages with a persistent sidebar.
 * The sidebar is visible on desktop (>= 1024px) and collapses to a
 * hamburger-triggered Sheet drawer on mobile (< 1024px).
 *
 * This layout sits inside the root layout, which provides the SiteHeader
 * and SiteFooter. The flex row here ensures the sidebar and main content
 * share the available horizontal space.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
