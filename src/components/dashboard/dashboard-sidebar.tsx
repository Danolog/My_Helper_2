"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Calendar,
  CalendarPlus,
  UserRound,
  Scissors,
  UserCog,
  Package,
  Bell,
  Image,
  Percent,
  Bot,
  BarChart3,
  FileText,
  CreditCard,
  Settings,
  Menu,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  isActive: (pathname: string) => boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Glowne",
    items: [
      {
        label: "Pulpit",
        href: "/dashboard",
        icon: LayoutDashboard,
        isActive: (pathname: string) => pathname === "/dashboard",
      },
      {
        label: "Kalendarz",
        href: "/dashboard/calendar",
        icon: Calendar,
        isActive: (pathname: string) => pathname.startsWith("/dashboard/calendar"),
      },
      {
        label: "Rezerwacja",
        href: "/dashboard/booking",
        icon: CalendarPlus,
        isActive: (pathname: string) => pathname.startsWith("/dashboard/booking"),
      },
    ],
  },
  {
    title: "Zarzadzanie",
    items: [
      {
        label: "Klienci",
        href: "/dashboard/clients",
        icon: UserRound,
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
        icon: UserCog,
        isActive: (pathname: string) => pathname.startsWith("/dashboard/employees"),
      },
      {
        label: "Magazyn",
        href: "/dashboard/products",
        icon: Package,
        isActive: (pathname: string) => pathname.startsWith("/dashboard/products"),
      },
      {
        label: "Powiadomienia",
        href: "/dashboard/notifications",
        icon: Bell,
        isActive: (pathname: string) => pathname.startsWith("/dashboard/notifications"),
      },
    ],
  },
  {
    title: "Marketing",
    items: [
      {
        label: "Galeria",
        href: "/dashboard/gallery",
        icon: Image,
        isActive: (pathname: string) => pathname.startsWith("/dashboard/gallery"),
      },
      {
        label: "Promocje",
        href: "/dashboard/promotions",
        icon: Percent,
        isActive: (pathname: string) => pathname.startsWith("/dashboard/promotions"),
      },
      {
        label: "Asystent AI",
        href: "/dashboard/ai-assistant",
        icon: Bot,
        badge: "PRO",
        isActive: (pathname: string) =>
          pathname.startsWith("/dashboard/ai-assistant") ||
          pathname.startsWith("/dashboard/ai-recommendations") ||
          pathname.startsWith("/dashboard/content-generator"),
      },
    ],
  },
  {
    title: "Finanse",
    items: [
      {
        label: "Raporty",
        href: "/dashboard/reports",
        icon: BarChart3,
        isActive: (pathname: string) => pathname.startsWith("/dashboard/reports"),
      },
      {
        label: "Faktury",
        href: "/dashboard/invoices",
        icon: FileText,
        isActive: (pathname: string) => pathname.startsWith("/dashboard/invoices"),
      },
      {
        label: "Subskrypcja",
        href: "/dashboard/subscription",
        icon: CreditCard,
        isActive: (pathname: string) => pathname.startsWith("/dashboard/subscription"),
      },
    ],
  },
];

const SETTINGS_ITEM: NavItem = {
  label: "Ustawienia",
  href: "/dashboard/settings",
  icon: Settings,
  isActive: (pathname: string) => pathname.startsWith("/dashboard/settings"),
};

function NavLink({
  item,
  pathname,
  onClick,
}: {
  item: NavItem;
  pathname: string;
  onClick?: (() => void) | undefined;
}) {
  const active = item.isActive(pathname);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      {...(onClick ? { onClick } : {})}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-3 min-h-[44px] text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-[3px] border-primary"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground border-l-[3px] border-transparent"
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1">{item.label}</span>
      {item.badge && (
        <Badge variant="gold" className="text-[10px] px-1.5 py-0">
          {item.badge}
        </Badge>
      )}
    </Link>
  );
}

export function SidebarNav({
  pathname,
  onClick,
}: {
  pathname: string;
  onClick?: () => void;
}) {
  return (
    <nav
      className="flex flex-col gap-1 h-full"
      role="navigation"
      aria-label="Panel nawigacyjny"
    >
      <div className="flex-1">
        {NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.title} className={cn(groupIndex > 0 && "mt-4")}>
            <h3 className="px-3 mb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
              {group.title}
            </h3>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  onClick={onClick}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Settings pinned at the bottom */}
      <div className="mt-4 pt-4 border-t border-sidebar-border">
        <NavLink item={SETTINGS_ITEM} pathname={pathname} onClick={onClick} />
      </div>
    </nav>
  );
}

/**
 * Desktop sidebar - always visible on screens >= md (768px).
 */
function DesktopSidebar({ pathname }: { pathname: string }) {
  return (
    <aside
      className="hidden md:flex md:w-64 md:flex-col md:border-r border-sidebar-border bg-sidebar sticky top-0 h-screen"
      aria-label="Panel nawigacyjny"
    >
      <div className="flex h-full flex-col p-4 overflow-y-auto">
        <SidebarNav pathname={pathname} />
      </div>
    </aside>
  );
}

/**
 * Mobile header bar with hamburger that opens a Sheet (drawer).
 * Visible only on screens < md (768px).
 */
export function DashboardMobileHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="sticky top-0 z-40 flex items-center gap-3 border-b bg-sidebar px-4 py-3 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            aria-label="Otworz menu nawigacyjne"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetHeader className="border-b border-sidebar-border p-4">
            <SheetTitle className="text-sidebar-foreground">Menu</SheetTitle>
          </SheetHeader>
          <Separator className="bg-sidebar-border" />
          <div className="p-4 overflow-y-auto h-[calc(100%-65px)]">
            <SidebarNav pathname={pathname} onClick={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
      <span className="text-sm font-semibold">MyHelper</span>
    </div>
  );
}

/**
 * DashboardSidebar is the main exported component.
 */
export function DashboardSidebar() {
  const pathname = usePathname();

  return <DesktopSidebar pathname={pathname} />;
}
