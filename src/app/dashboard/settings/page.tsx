"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Settings,
  Building2,
  CreditCard,
  Bell,
  Gift,
  Printer,
  Crown,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const SETTINGS_ITEMS = [
  {
    label: "Dane salonu",
    description: "Nazwa, adres, telefon i typ dzialalnosci salonu",
    href: "/dashboard/settings/salon",
    icon: Building2,
  },
  {
    label: "Platnosci Stripe",
    description: "Konfiguracja integracji Stripe i ustawienia platnosci",
    href: "/dashboard/settings/payments",
    icon: CreditCard,
  },
  {
    label: "Powiadomienia",
    description: "Szablony SMS, email, push i ustawienia urodzinowe",
    href: "/dashboard/settings/notifications",
    icon: Bell,
  },
  {
    label: "Program lojalnosciowy",
    description: "Konfiguracja systemu punktow i nagrod dla klientow",
    href: "/dashboard/settings/loyalty",
    icon: Gift,
  },
  {
    label: "Drukarka fiskalna",
    description: "Konfiguracja integracji z drukarka fiskalna i kasa",
    href: "/dashboard/settings/fiscal",
    icon: Printer,
  },
  {
    label: "Subskrypcja",
    description: "Zarzadzaj planem subskrypcji i platnosciami",
    href: "/dashboard/subscription",
    icon: Crown,
  },
];

export default function SettingsHubPage() {
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
            <Settings className="h-6 w-6 text-primary" />
            Ustawienia
          </h1>
          <p className="text-muted-foreground">
            Konfiguracja salonu i integracji
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {SETTINGS_ITEMS.map((item) => {
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
  );
}
