"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  Users,
  Scissors,
  Image,
  BarChart3,
  CreditCard,
  Package,
  Percent,
  Menu,
  X,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Navigation items for the dashboard sidebar.
 * Each item has a Polish label, an href, an icon, and optionally
 * a matcher function for more complex active-route detection.
 */
const NAV_ITEMS = [
  {
    label: "Pulpit",
    href: "/dashboard",
    icon: LayoutDashboard,
    // Only match exact /dashboard, not sub-routes
    isActive: (pathname: string) => pathname === "/dashboard",
  },
  {
    label: "Kalendarz",
    href: "/dashboard/calendar",
    icon: Calendar,
    isActive: (pathname: string) => pathname.startsWith("/dashboard/calendar"),
  },
  {
    label: "Klienci",
    href: "/dashboard/clients",
    icon: Users,
    isActive: (pathname: string) => pathname.startsWith("/dashboard/clients"),
  },
  {
    label: "Uslugi",
    href: "/dashboard/services",
    icon: Scissors,
    isActive: (pathname: string) => pathname.startsWith("/dashboard/services"),
  },
  {
    label: "Pracownicy",
    href: "/dashboard/employees",
    icon: Users,
    isActive: (pathname: string) => pathname.startsWith("/dashboard/employees"),
  },
  {
    label: "Galeria",
    href: "/dashboard/gallery",
    icon: Image,
    isActive: (pathname: string) => pathname.startsWith("/dashboard/gallery"),
  },
  {
    label: "Magazyn",
    href: "/dashboard/products",
    icon: Package,
    isActive: (pathname: string) => pathname.startsWith("/dashboard/products"),
  },
  {
    label: "Promocje",
    href: "/dashboard/promotions",
    icon: Percent,
    isActive: (pathname: string) => pathname.startsWith("/dashboard/promotions"),
  },
  {
    label: "Raporty",
    href: "/dashboard/reports/revenue",
    icon: BarChart3,
    isActive: (pathname: string) => pathname.startsWith("/dashboard/reports"),
  },
  {
    label: "Asystent AI",
    href: "/dashboard/ai-assistant",
    icon: Bot,
    isActive: (pathname: string) =>
      pathname.startsWith("/dashboard/ai-assistant") ||
      pathname.startsWith("/dashboard/ai-recommendations") ||
      pathname.startsWith("/dashboard/content-generator"),
  },
  {
    label: "Subskrypcja",
    href: "/dashboard/subscription",
    icon: CreditCard,
    isActive: (pathname: string) =>
      pathname.startsWith("/dashboard/subscription") ||
      pathname.startsWith("/dashboard/settings"),
  },
] as const;

/**
 * Renders a single navigation link with active state styling.
 * Uses the sidebar CSS tokens for consistent theming in light/dark mode.
 */
function NavLink({
  item,
  pathname,
  onClick,
}: {
  item: (typeof NAV_ITEMS)[number];
  pathname: string;
  onClick?: () => void;
}) {
  const active = item.isActive(pathname);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      {...(onClick ? { onClick } : {})}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{item.label}</span>
    </Link>
  );
}

/**
 * Desktop sidebar - always visible on screens >= lg (1024px).
 * Renders a fixed-width column on the left side of the dashboard.
 */
function DesktopSidebar({ pathname }: { pathname: string }) {
  return (
    <aside
      className="hidden lg:flex lg:w-64 lg:flex-col lg:border-r border-sidebar-border bg-sidebar"
      role="navigation"
      aria-label="Panel nawigacyjny"
    >
      <div className="flex h-full flex-col gap-2 p-4">
        <div className="mb-2">
          <h2 className="px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            Menu
          </h2>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
      </div>
    </aside>
  );
}

/**
 * Mobile sidebar - renders a hamburger button that opens a Sheet (drawer).
 * Visible only on screens < lg (1024px).
 */
function MobileSidebar({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 lg:hidden"
            aria-label="Otworz menu nawigacyjne"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetHeader className="border-b border-sidebar-border p-4">
            <SheetTitle className="text-sidebar-foreground">Menu</SheetTitle>
          </SheetHeader>
          <Separator className="bg-sidebar-border" />
          <nav
            className="flex flex-col gap-1 p-4"
            role="navigation"
            aria-label="Panel nawigacyjny"
          >
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                pathname={pathname}
                onClick={() => setOpen(false)}
              />
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/**
 * DashboardSidebar is the main exported component.
 * It renders both the desktop sidebar (always visible on lg+)
 * and the mobile sidebar (hamburger + Sheet drawer on < lg).
 */
export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <>
      <DesktopSidebar pathname={pathname} />
      <MobileSidebar pathname={pathname} />
    </>
  );
}
