"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Plus } from "lucide-react";
import { PRIMARY_NAV, SidebarNav, type NavItem } from "@/components/dashboard/dashboard-sidebar";
import { useModules } from "@/components/dashboard/modules-provider";
import { useSalonRole } from "@/components/dashboard/role-provider";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { isRouteEnabledForModules } from "@/lib/features";
import { isRouteAllowedForRole } from "@/lib/role-access";
import { cn } from "@/lib/utils";
import type { ModulesState } from "@/lib/features";
import type { SalonRole } from "@/lib/salon-context";

/** Pozycje paska z menu bocznego: Dziś, Kalendarz, Klienci (te same etykiety i aktywność). */
const BOTTOM_NAV_HREFS = ["/dashboard", "/dashboard/calendar", "/dashboard/clients"];
const BOTTOM_NAV_ITEMS: ReadonlyArray<NavItem> = PRIMARY_NAV.filter((item) =>
  BOTTOM_NAV_HREFS.includes(item.href)
);

/**
 * Środkowy przycisk „+ Wizyta” prowadzi do ręcznej rezerwacji, czyli
 * dodawania wizyty przez salon. Podlega tym samym regułom ról co strona.
 */
const ADD_APPOINTMENT_HREF = "/dashboard/booking";

function isVisible(href: string, role: SalonRole, modules: ModulesState): boolean {
  return isRouteAllowedForRole(href, role) && isRouteEnabledForModules(href, modules);
}

function BottomNavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.isActive(pathname);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-0.5 min-h-[56px] transition-colors",
        active ? "text-primary" : "text-muted-foreground"
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="h-5 w-5" />
      <span className="text-[10px] font-medium mt-0.5">{item.label}</span>
    </Link>
  );
}

/**
 * Mobile bottom navigation bar for the dashboard.
 * Fixed to the bottom of the viewport, visible only on screens < md (768px).
 * Układ: Dziś, Kalendarz, „+ Wizyta” (środek), Klienci, Więcej. „Więcej”
 * otwiera panel z pełnym menu i rozwiniętą grupą dodatków.
 */
export function DashboardBottomNav() {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);
  const modules = useModules();
  const role = useSalonRole();
  const visibleItems = BOTTOM_NAV_ITEMS.filter((item) => isVisible(item.href, role, modules));
  // Środkowy przycisk wchodzi między drugą a trzecią pozycję (po Kalendarzu).
  const leftItems = visibleItems.slice(0, 2);
  const rightItems = visibleItems.slice(2);
  const showAddAppointment = isVisible(ADD_APPOINTMENT_HREF, role, modules);
  const addActive = pathname.startsWith(ADD_APPOINTMENT_HREF);

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
        {leftItems.map((item) => (
          <BottomNavLink key={item.href} item={item} pathname={pathname} />
        ))}

        {showAddAppointment && (
          <Link
            href={ADD_APPOINTMENT_HREF}
            className="flex flex-1 flex-col items-center justify-center min-h-[56px]"
            aria-label="Dodaj wizytę"
            aria-current={addActive ? "page" : undefined}
          >
            <span
              className={cn(
                "flex h-11 w-11 items-center justify-center rounded-full shadow-md transition-colors",
                "bg-primary text-primary-foreground",
                addActive && "ring-2 ring-primary/40 ring-offset-2 ring-offset-sidebar"
              )}
            >
              <Plus className="h-5 w-5" />
            </span>
            <span className="text-[10px] font-medium mt-0.5 text-primary">Wizyta</span>
          </Link>
        )}

        {rightItems.map((item) => (
          <BottomNavLink key={item.href} item={item} pathname={pathname} />
        ))}

        {/* "Więcej" - opens Sheet with full sidebar navigation */}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 min-h-[56px] text-muted-foreground transition-colors"
          aria-label="Otwórz pełne menu nawigacyjne"
        >
          <Menu className="h-5 w-5" />
          <span className="text-[10px] font-medium mt-0.5">Więcej</span>
        </button>
      </nav>

      {/* Sheet drawer with full sidebar navigation, triggered by "Więcej" */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetHeader className="border-b border-sidebar-border p-4">
            <SheetTitle className="text-sidebar-foreground">Menu</SheetTitle>
          </SheetHeader>
          <Separator className="bg-sidebar-border" />
          {/* flex-1 + min-h-0: bez tego lista nie przewija się w panelu
              (flex-col) i dół menu z wylogowaniem wypada poza ekran. */}
          <div className="p-4 overflow-y-auto flex-1 min-h-0">
            <SidebarNav
              pathname={pathname}
              moreDefaultOpen
              onClick={() => setSheetOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
