"use client";

import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  DollarSign,
  Package,
  TrendingUp,
  Users,
  Scissors,
  Percent,
  XCircle,
  CalendarRange,
  CalendarDays,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const REPORT_GROUPS = [
  {
    title: "Finansowe",
    items: [
      {
        label: "Przychody",
        description: "Analiza przychodow salonu w wybranym okresie",
        href: "/dashboard/reports/revenue",
        icon: DollarSign,
      },
      {
        label: "Materialy",
        description: "Zuzycie materialow i kosztow produktow",
        href: "/dashboard/reports/materials",
        icon: Package,
      },
      {
        label: "Rentownosc uslug",
        description: "Analiza zyskownosci poszczegolnych uslug",
        href: "/dashboard/reports/service-profitability",
        icon: TrendingUp,
      },
      {
        label: "Zysk/Strata materialow",
        description: "Porownanie kosztow materialow z przychodami",
        href: "/dashboard/reports/materials-profitloss",
        icon: BarChart3,
      },
    ],
  },
  {
    title: "Pracownicy",
    items: [
      {
        label: "Obciazenie pracownikow",
        description: "Analiza oblozenosci i wydajnosci zespolu",
        href: "/dashboard/reports/employee-occupancy",
        icon: Users,
      },
      {
        label: "Popularnosc pracownikow",
        description: "Ranking pracownikow wg liczby wizyt",
        href: "/dashboard/reports/employee-popularity",
        icon: Users,
      },
      {
        label: "Wynagrodzenia",
        description: "Raport wynagrodzen i prowizji pracownikow",
        href: "/dashboard/reports/employee-payroll",
        icon: Wallet,
      },
    ],
  },
  {
    title: "Marketing",
    items: [
      {
        label: "Popularnosc uslug",
        description: "Ranking najczesciej rezerwowanych uslug",
        href: "/dashboard/reports/services-popularity",
        icon: Scissors,
      },
      {
        label: "Efektywnosc promocji",
        description: "Analiza skutecznosci kampanii promocyjnych",
        href: "/dashboard/reports/promotions",
        icon: Percent,
      },
      {
        label: "Anulacje",
        description: "Statystyki odwolan i anulowanych wizyt",
        href: "/dashboard/reports/cancellations",
        icon: XCircle,
      },
    ],
  },
  {
    title: "Porownania",
    items: [
      {
        label: "Porownanie miesieczne",
        description: "Zestawienie wynikow miesiac do miesiaca",
        href: "/dashboard/reports/monthly-comparison",
        icon: CalendarRange,
      },
      {
        label: "Porownanie roczne",
        description: "Zestawienie wynikow rok do roku",
        href: "/dashboard/reports/yearly-comparison",
        icon: CalendarDays,
      },
    ],
  },
];

export default function ReportsHubPage() {
  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Raporty
          </h1>
          <p className="text-muted-foreground">
            Analizuj wyniki salonu i podejmuj lepsze decyzje
          </p>
        </div>
      </div>

      <div className="space-y-8">
        {REPORT_GROUPS.map((group) => (
          <div key={group.title}>
            <h2 className="text-lg font-semibold mb-4">{group.title}</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="p-5 border rounded-lg space-y-2 hover:bg-accent/50 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5 text-primary shrink-0" />
                      <h3 className="font-medium group-hover:text-primary transition-colors">
                        {item.label}
                      </h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
