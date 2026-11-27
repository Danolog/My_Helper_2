import { Scissors, Store, UserCog } from "lucide-react";
import { NavHubPage, type NavHubTile } from "@/components/dashboard/nav-hub";

const TILES: NavHubTile[] = [
  {
    label: "Usługi",
    description: "Cennik, czas trwania i kategorie usług salonu",
    href: "/dashboard/services",
    icon: Scissors,
  },
  {
    label: "Zespół",
    description: "Pracownicy, ich usługi i harmonogram pracy",
    href: "/dashboard/employees",
    icon: UserCog,
  },
];

export default function OfferHubPage() {
  return (
    <NavHubPage
      title="Oferta"
      description="Co salon oferuje i kto to wykonuje"
      icon={Store}
      tiles={TILES}
    />
  );
}
