import { BarChart3, HandCoins, TrendingUp, Wallet } from "lucide-react";
import { NavHubPage, type NavHubTile } from "@/components/dashboard/nav-hub";

const TILES: NavHubTile[] = [
  {
    label: "Raporty",
    description: "Przychody, obłożenie, popularność usług i porównania okresów",
    href: "/dashboard/reports",
    icon: BarChart3,
  },
  {
    label: "Płatności",
    description: "Historia płatności za wizyty",
    href: "/dashboard/payments",
    icon: Wallet,
  },
  {
    label: "Rozliczenia",
    description: "Prowizje i wynagrodzenia pracowników",
    href: "/dashboard/finance",
    icon: HandCoins,
  },
];

export default function ResultsHubPage() {
  return (
    <NavHubPage
      title="Wyniki"
      description="Jak idzie salonowi: raporty, płatności i rozliczenia"
      icon={TrendingUp}
      tiles={TILES}
    />
  );
}
