"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

const LABELS: Record<string, string> = {
  dashboard: "Pulpit",
  calendar: "Kalendarz",
  clients: "Klienci",
  services: "Uslugi",
  employees: "Pracownicy",
  gallery: "Galeria",
  products: "Magazyn",
  promotions: "Promocje",
  reports: "Raporty",
  revenue: "Przychody",
  cancellations: "Anulacje",
  "employee-occupancy": "Oblozenosc",
  "employee-payroll": "Wynagrodzenia",
  "employee-popularity": "Popularnosc pracownikow",
  materials: "Materialy",
  "materials-profitloss": "Rentownosc materialow",
  "monthly-comparison": "Porownanie miesiecy",
  "yearly-comparison": "Porownanie lat",
  "service-profitability": "Rentownosc uslug",
  "services-popularity": "Popularnosc uslug",
  "ai-assistant": "Asystent AI",
  "ai-recommendations": "Rekomendacje AI",
  "content-generator": "Generator tresci",
  subscription: "Subskrypcja",
  settings: "Ustawienia",
  booking: "Rezerwacja",
  appointments: "Wizyty",
  invoices: "Faktury",
  payments: "Platnosci",
  notifications: "Powiadomienia",
  schedule: "Grafik",
  templates: "Szablony",
  newsletters: "Newslettery",
  business: "Biznes",
  trends: "Trendy",
  loyalty: "Lojalnosc",
  salon: "Salon",
};

function isUuid(segment: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment);
}

export function DashboardBreadcrumbs() {
  const pathname = usePathname();

  const segments = pathname.split("/").filter(Boolean);
  // Skip if we're on exact /dashboard
  if (segments.length <= 1) return null;

  const crumbs = segments.map((segment, index) => {
    const href = "/" + segments.slice(0, index + 1).join("/");
    const label = isUuid(segment)
      ? "Szczegoly"
      : LABELS[segment] || segment;
    const isLast = index === segments.length - 1;

    return { href, label, isLast };
  });

  return (
    <nav
      aria-label="Sciezka nawigacji"
      className="flex items-center gap-1 px-4 md:px-6 py-2 text-sm text-muted-foreground border-b bg-background/50"
    >
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          {crumb.isLast ? (
            <span className="font-medium text-foreground truncate max-w-[200px]">
              {crumb.label}
            </span>
          ) : (
            <Link
              href={crumb.href}
              className="hover:text-foreground transition-colors truncate max-w-[200px]"
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
