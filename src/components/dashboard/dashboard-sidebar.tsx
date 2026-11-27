"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  CalendarPlus,
  UserRound,
  Store,
  TrendingUp,
  Package,
  Bell,
  Image,
  Percent,
  Bot,
  FileText,
  CreditCard,
  Hourglass,
  Settings,
  Star,
  Menu,
  ChevronDown,
  Ellipsis,
} from "lucide-react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { useModules } from "@/components/dashboard/modules-provider";
import { useSalonRole } from "@/components/dashboard/role-provider";
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
import { isRouteEnabledForModules } from "@/lib/features";
import { isRouteAllowedForRole } from "@/lib/role-access";
import { cn } from "@/lib/utils";
import type { ModulesState } from "@/lib/features";
import type { SalonRole } from "@/lib/salon-context";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
  isActive: (pathname: string) => boolean;
}

function startsWithAny(pathname: string, prefixes: ReadonlyArray<string>): boolean {
  return prefixes.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Pięć głównych pozycji menu (plan wejścia na rynek, 4.3). „Oferta” i „Wyniki”
 * prowadzą na strony zbiorcze z kafelkami do istniejących podstron, więc są
 * aktywne także na tych podstronach.
 */
export const PRIMARY_NAV: ReadonlyArray<NavItem> = [
  {
    label: "Dziś",
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
    label: "Oferta",
    href: "/dashboard/offer",
    icon: Store,
    isActive: (pathname) =>
      startsWithAny(pathname, ["/dashboard/offer", "/dashboard/services", "/dashboard/employees"]),
  },
  {
    label: "Wyniki",
    href: "/dashboard/results",
    icon: TrendingUp,
    isActive: (pathname) =>
      startsWithAny(pathname, [
        "/dashboard/results",
        "/dashboard/reports",
        "/dashboard/payments",
        "/dashboard/finance",
      ]),
  },
];

/** Dodatki i ustawienia pod rozwijaną grupą „Więcej”. */
export const MORE_NAV: ReadonlyArray<NavItem> = [
  {
    label: "Ręczna rezerwacja",
    href: "/dashboard/booking",
    icon: CalendarPlus,
    isActive: (pathname) => pathname.startsWith("/dashboard/booking"),
  },
  {
    label: "Magazyn",
    href: "/dashboard/products",
    icon: Package,
    isActive: (pathname) => pathname.startsWith("/dashboard/products"),
  },
  {
    label: "Lista oczekujących",
    href: "/dashboard/waiting-list",
    icon: Hourglass,
    isActive: (pathname) => pathname.startsWith("/dashboard/waiting-list"),
  },
  {
    label: "Promocje",
    href: "/dashboard/promotions",
    icon: Percent,
    isActive: (pathname) =>
      startsWithAny(pathname, ["/dashboard/promotions", "/dashboard/promo-codes"]),
  },
  {
    label: "Galeria",
    href: "/dashboard/gallery",
    icon: Image,
    isActive: (pathname) => pathname.startsWith("/dashboard/gallery"),
  },
  {
    label: "Powiadomienia",
    href: "/dashboard/notifications",
    icon: Bell,
    isActive: (pathname) => pathname.startsWith("/dashboard/notifications"),
  },
  {
    label: "Asystent AI",
    href: "/dashboard/ai-assistant",
    icon: Bot,
    badge: "PRO",
    isActive: (pathname) =>
      startsWithAny(pathname, [
        "/dashboard/ai-assistant",
        "/dashboard/ai-recommendations",
        "/dashboard/content-generator",
        "/dashboard/ai-usage",
      ]),
  },
  {
    label: "Faktury",
    href: "/dashboard/invoices",
    icon: FileText,
    isActive: (pathname) => pathname.startsWith("/dashboard/invoices"),
  },
  {
    label: "Opinie",
    href: "/dashboard/reviews",
    icon: Star,
    isActive: (pathname) => pathname.startsWith("/dashboard/reviews"),
  },
  {
    label: "Subskrypcja",
    href: "/dashboard/subscription",
    icon: CreditCard,
    isActive: (pathname) => pathname.startsWith("/dashboard/subscription"),
  },
  {
    label: "Ustawienia",
    href: "/dashboard/settings",
    icon: Settings,
    isActive: (pathname) => pathname.startsWith("/dashboard/settings"),
  },
];

/**
 * Pozycje widoczne dla roli i stanu modułów salonu. Jedna ścieżka filtra dla
 * menu bocznego i dolnego paska: rola (`isRouteAllowedForRole`, te same
 * reguły co `RoleGate`) i moduły (`isRouteEnabledForModules`, bez pozycji
 * modułów wyłączonych i zamrożonych).
 */
export function filterNavItems(
  items: ReadonlyArray<NavItem>,
  role: SalonRole,
  modules: ModulesState
): NavItem[] {
  return items.filter(
    (item) => isRouteAllowedForRole(item.href, role) && isRouteEnabledForModules(item.href, modules)
  );
}

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
  moreDefaultOpen = false,
}: {
  pathname: string;
  onClick?: () => void;
  /** Rozwinięta grupa „Więcej” na starcie (np. po „Więcej” z dolnego paska). */
  moreDefaultOpen?: boolean;
}) {
  const modules = useModules();
  const role = useSalonRole();
  const primaryItems = filterNavItems(PRIMARY_NAV, role, modules);
  const moreItems = filterNavItems(MORE_NAV, role, modules);
  // Na podstronie z „Więcej” grupa startuje rozwinięta, żeby aktywna
  // pozycja była widoczna.
  const moreHasActive = moreItems.some((item) => item.isActive(pathname));
  const [moreOpen, setMoreOpen] = useState(moreDefaultOpen || moreHasActive);
  const moreListId = useId();

  return (
    <nav
      className="flex flex-col gap-1 h-full"
      role="navigation"
      aria-label="Panel nawigacyjny"
    >
      <div className="flex-1">
        <div className="flex flex-col gap-0.5">
          {primaryItems.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} onClick={onClick} />
          ))}
        </div>

        {moreItems.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
              aria-expanded={moreOpen}
              aria-controls={moreListId}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-3 min-h-[44px] text-sm font-medium transition-colors border-l-[3px]",
                // Zwinięta grupa z aktywną podstroną (np. wejście z palety
                // poleceń) jest podświetlona, żeby było widać, gdzie jesteśmy.
                moreHasActive && !moreOpen
                  ? "bg-sidebar-accent text-sidebar-accent-foreground border-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground border-transparent"
              )}
            >
              <Ellipsis className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">Więcej</span>
              <ChevronDown
                className={cn("h-4 w-4 shrink-0 transition-transform", moreOpen && "rotate-180")}
                aria-hidden="true"
              />
            </button>
            {moreOpen && (
              <div id={moreListId} className="mt-0.5 flex flex-col gap-0.5">
                {moreItems.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} onClick={onClick} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Wylogowanie (każda rola) na dole */}
      <div className="mt-4 pt-4 border-t border-sidebar-border flex flex-col gap-0.5">
        <SignOutButton
          variant="ghost"
          className="w-full px-3 text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
        />
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
          <div className="p-4 overflow-y-auto flex-1 min-h-0">
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
