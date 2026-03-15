"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  UserRound,
  Bot,
  Menu,
} from "lucide-react";
import { SidebarNav } from "@/components/dashboard/dashboard-sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface BottomNavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  isActive: (pathname: string) => boolean;
}

const BOTTOM_NAV_ITEMS: BottomNavItem[] = [
  {
    label: "Pulpit",
    href: "/dashboard",
    icon: LayoutDashboard,
    isActive: (pathname) => pathname === "/dashboard",
  },
  {
    label: "Kalendarz",
    href: "/dashboard/calendar",
    icon: Calendar,
    isActive: (pathname) => pathname.startsWith("/dashboard/calendar"),
  },
  {
    label: "Klienci",
    href: "/dashboard/clients",
    icon: UserRound,
    isActive: (pathname) => pathname.startsWith("/dashboard/clients"),
  },
  {
    label: "AI",
    href: "/dashboard/ai-assistant",
    icon: Bot,
    isActive: (pathname) =>
      pathname.startsWith("/dashboard/ai-assistant") ||
      pathname.startsWith("/dashboard/ai-recommendations") ||
      pathname.startsWith("/dashboard/content-generator"),
  },
];

/**
 * Mobile bottom navigation bar for the dashboard.
 * Fixed to the bottom of the viewport, visible only on screens < md (768px).
 * The "Wiecej" (More) button opens a Sheet drawer with the full sidebar navigation.
 */
export function DashboardBottomNav() {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <nav
        className={cn(
          "fixed bottom-0 inset-x-0 z-50 md:hidden",
          "flex items-stretch justify-around",
          "bg-sidebar/95 backdrop-blur-xl",
          "border-t border-sidebar-border",
          "pb-[env(safe-area-inset-bottom)]"
        )}
        role="navigation"
        aria-label="Szybka nawigacja"
      >
        {BOTTOM_NAV_ITEMS.map((item) => {
          const active = item.isActive(pathname);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 min-h-[56px] transition-colors",
                active ? "text-primary" : "text-muted-foreground"
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-medium mt-0.5">
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* "Wiecej" button - opens Sheet with full sidebar navigation */}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 min-h-[56px] text-muted-foreground transition-colors"
          aria-label="Otworz pelne menu nawigacyjne"
        >
          <Menu className="h-5 w-5" />
          <span className="text-[10px] font-medium mt-0.5">Wiecej</span>
        </button>
      </nav>

      {/* Sheet drawer with full sidebar navigation, triggered by "Wiecej" */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetHeader className="border-b border-sidebar-border p-4">
            <SheetTitle className="text-sidebar-foreground">Menu</SheetTitle>
          </SheetHeader>
          <Separator className="bg-sidebar-border" />
          <div className="p-4 overflow-y-auto">
            <SidebarNav
              pathname={pathname}
              onClick={() => setSheetOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
