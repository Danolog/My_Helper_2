"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  Building2,
  DollarSign,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
  CalendarRange,
  CalendarDays,
  Gift,
  Printer,
  Star,
  Clock,
  Ticket,
  Receipt,
  Brain,
  Loader2,
  MessageSquare,
  PenTool,
  Lightbulb,
  Search,
  Sparkles,
} from "lucide-react";
import { useModules } from "@/components/dashboard/modules-provider";
import { useSalonRole } from "@/components/dashboard/role-provider";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useAISearch } from "@/hooks/use-ai-search";
import { BASIC_REPORT_SLUGS, isRouteEnabledForModules } from "@/lib/features";
import { isRouteAllowedForRole } from "@/lib/role-access";

interface CommandPage {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string[];
}

const NAV_PAGES: CommandPage[] = [
  { label: "Pulpit", href: "/dashboard", icon: LayoutDashboard },
  { label: "Kalendarz", href: "/dashboard/calendar", icon: Calendar },
  { label: "Rezerwacja", href: "/dashboard/booking", icon: CalendarPlus, keywords: ["wizyta", "termin"] },
  { label: "Klienci", href: "/dashboard/clients", icon: UserRound },
  { label: "Uslugi", href: "/dashboard/services", icon: Scissors },
  { label: "Pracownicy", href: "/dashboard/employees", icon: UserCog, keywords: ["zespol", "grafik"] },
  { label: "Magazyn", href: "/dashboard/products", icon: Package, keywords: ["produkty", "stan"] },
  { label: "Powiadomienia", href: "/dashboard/notifications", icon: Bell, keywords: ["sms", "email", "push"] },
  { label: "Galeria", href: "/dashboard/gallery", icon: Image, keywords: ["zdjecia", "portfolio"] },
  { label: "Promocje", href: "/dashboard/promotions", icon: Percent, keywords: ["rabat", "znizka"] },
  { label: "Faktury", href: "/dashboard/invoices", icon: FileText },
  { label: "Subskrypcja", href: "/dashboard/subscription", icon: CreditCard, keywords: ["plan", "platnosc"] },
  { label: "Opinie", href: "/dashboard/reviews", icon: Star, keywords: ["recenzje", "moderacja"] },
  { label: "Lista oczekujacych", href: "/dashboard/waiting-list", icon: Clock },
  { label: "Kody promocyjne", href: "/dashboard/promo-codes", icon: Ticket, keywords: ["kupony", "rabat"] },
  { label: "Historia platnosci", href: "/dashboard/payments", icon: Receipt },
  { label: "Prowizje", href: "/dashboard/finance", icon: DollarSign, keywords: ["wynagrodzenia"] },
];

const REPORT_PAGES: CommandPage[] = [
  { label: "Raporty", href: "/dashboard/reports", icon: BarChart3 },
  { label: "Przychody", href: "/dashboard/reports/revenue", icon: DollarSign },
  { label: "Materialy", href: "/dashboard/reports/materials", icon: Package },
  { label: "Rentownosc uslug", href: "/dashboard/reports/service-profitability", icon: TrendingUp },
  { label: "Zysk/Strata materialow", href: "/dashboard/reports/materials-profitloss", icon: BarChart3 },
  { label: "Obciazenie pracownikow", href: "/dashboard/reports/employee-occupancy", icon: Users },
  { label: "Popularnosc pracownikow", href: "/dashboard/reports/employee-popularity", icon: Users },
  { label: "Wynagrodzenia", href: "/dashboard/reports/employee-payroll", icon: Wallet },
  { label: "Popularnosc uslug", href: "/dashboard/reports/services-popularity", icon: Scissors },
  { label: "Efektywnosc promocji", href: "/dashboard/reports/promotions", icon: Percent },
  { label: "Anulacje", href: "/dashboard/reports/cancellations", icon: XCircle },
  { label: "Porownanie miesieczne", href: "/dashboard/reports/monthly-comparison", icon: CalendarRange },
  { label: "Porownanie roczne", href: "/dashboard/reports/yearly-comparison", icon: CalendarDays },
];

const SETTINGS_PAGES: CommandPage[] = [
  { label: "Ustawienia", href: "/dashboard/settings", icon: Settings },
  { label: "Dane salonu", href: "/dashboard/settings/salon", icon: Building2 },
  { label: "Platnosci Stripe", href: "/dashboard/settings/payments", icon: CreditCard },
  { label: "Powiadomienia (ustawienia)", href: "/dashboard/settings/notifications", icon: Bell, keywords: ["sms", "przypomnienia"] },
  { label: "Program lojalnosciowy", href: "/dashboard/settings/loyalty", icon: Gift, keywords: ["punkty", "nagrody"] },
  { label: "Drukarka fiskalna", href: "/dashboard/settings/fiscal", icon: Printer, keywords: ["kasa", "paragon"] },
];

const AI_PAGES: CommandPage[] = [
  { label: "Asystent AI", href: "/dashboard/ai-assistant", icon: Bot },
  { label: "Asystent biznesowy", href: "/dashboard/ai-assistant/business", icon: Brain },
  { label: "Rekomendacje AI", href: "/dashboard/ai-recommendations", icon: Lightbulb },
  { label: "Generator tresci", href: "/dashboard/content-generator", icon: PenTool },
  { label: "Koszty AI", href: "/dashboard/ai-usage", icon: DollarSign, keywords: ["monitoring", "zuzycie", "koszt"] },
  { label: "Chat AI", href: "/chat", icon: MessageSquare },
];

const QUICK_ACTIONS: CommandPage[] = [
  { label: "Nowa wizyta", href: "/dashboard/booking", icon: CalendarPlus, keywords: ["rezerwacja", "umow"] },
  { label: "Dodaj klienta", href: "/dashboard/clients", icon: UserRound, keywords: ["nowy klient"] },
  { label: "Zarzadzaj uslugami", href: "/dashboard/services", icon: Scissors },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const router = useRouter();
  const modules = useModules();
  const role = useSalonRole();

  const isPageVisible = (page: CommandPage) => {
    if (!isRouteAllowedForRole(page.href, role)) return false;
    return isRouteEnabledForModules(page.href, modules);
  };
  const visibleNavPages = NAV_PAGES.filter(isPageVisible);
  const visibleReportPages = REPORT_PAGES.filter((page) => {
    if (!isPageVisible(page)) return false;
    const slug = page.href.slice("/dashboard/reports/".length);
    if (!page.href.startsWith("/dashboard/reports/") || !slug) return true;
    return BASIC_REPORT_SLUGS.includes(slug) || modules.reportsAdvanced;
  });
  const visibleSettingsPages = SETTINGS_PAGES.filter(isPageVisible);
  const visibleAiPages = AI_PAGES.filter(isPageVisible);

  // AI-powered natural language search (activates for queries > 3 words)
  const {
    results: aiResults,
    isSearching: aiSearching,
    description: aiDescription,
  } = useAISearch(search);

  // Reset search when dialog reopens
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        setSearch("");
      }
    },
    [],
  );

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const navigateTo = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <CommandInput
        placeholder="Szukaj stron, raportow, ustawien..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>Nie znaleziono wynikow.</CommandEmpty>

        {/* AI Search Results — shown when the query is natural language (> 3 words) */}
        {(aiResults.length > 0 || aiSearching) && (
          <>
            <CommandGroup
              heading={
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" />
                  {aiSearching
                    ? "Szukanie AI..."
                    : `AI: ${aiDescription}`}
                </span>
              }
            >
              {aiResults.flatMap((group) =>
                group.items.map((item) => (
                  <CommandItem
                    key={`ai-${item.id}`}
                    value={`ai ${item.title} ${item.subtitle}`}
                    onSelect={() => navigateTo(item.href)}
                  >
                    <Sparkles className="mr-2 h-4 w-4 shrink-0 text-primary" />
                    <div className="flex flex-col">
                      <span>{item.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.subtitle}
                      </span>
                    </div>
                  </CommandItem>
                )),
              )}
              {aiSearching && (
                <CommandItem value="ai-loading" disabled>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Przeszukiwanie bazy danych...
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Szybkie akcje">
          {QUICK_ACTIONS.filter(isPageVisible).map((page) => {
            const Icon = page.icon;
            return (
              <CommandItem
                key={`quick-${page.href}`}
                value={[page.label, ...(page.keywords || [])].join(" ")}
                onSelect={() => navigateTo(page.href)}
              >
                <Icon className="mr-2 h-4 w-4 shrink-0" />
                {page.label}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Nawigacja">
          {visibleNavPages.map((page) => {
            const Icon = page.icon;
            return (
              <CommandItem
                key={page.href}
                value={[page.label, ...(page.keywords || [])].join(" ")}
                onSelect={() => navigateTo(page.href)}
              >
                <Icon className="mr-2 h-4 w-4 shrink-0" />
                {page.label}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Raporty">
          {visibleReportPages.map((page) => {
            const Icon = page.icon;
            return (
              <CommandItem
                key={page.href}
                value={[page.label, ...(page.keywords || [])].join(" ")}
                onSelect={() => navigateTo(page.href)}
              >
                <Icon className="mr-2 h-4 w-4 shrink-0" />
                {page.label}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Ustawienia">
          {visibleSettingsPages.map((page) => {
            const Icon = page.icon;
            return (
              <CommandItem
                key={page.href}
                value={[page.label, ...(page.keywords || [])].join(" ")}
                onSelect={() => navigateTo(page.href)}
              >
                <Icon className="mr-2 h-4 w-4 shrink-0" />
                {page.label}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="AI">
          {visibleAiPages.map((page) => {
            const Icon = page.icon;
            return (
              <CommandItem
                key={page.href}
                value={[page.label, ...(page.keywords || [])].join(" ")}
                onSelect={() => navigateTo(page.href)}
              >
                <Icon className="mr-2 h-4 w-4 shrink-0" />
                {page.label}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>

      <div className="border-t px-3 py-2 text-xs text-muted-foreground flex items-center gap-1">
        <Search className="h-3 w-3" />
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          <span className="text-xs">⌘</span>K
        </kbd>
        <span>aby otworzyc</span>
      </div>
    </CommandDialog>
  );
}
