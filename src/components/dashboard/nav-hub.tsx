import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RoleGate } from "@/components/dashboard/role-gate";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

export interface NavHubTile {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

/**
 * Strona zbiorcza pozycji menu, która łączy kilka istniejących podstron
 * (np. „Oferta” = usługi + zespół). Same kafelki z linkami — logika
 * zostaje na podstronach. Dostęp tylko dla właściciela, tak jak do
 * podstron, na które prowadzą kafelki.
 */
export function NavHubPage({
  title,
  description,
  icon: Icon,
  tiles,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  tiles: ReadonlyArray<NavHubTile>;
}) {
  return (
    <RoleGate allow={["owner"]}>
      <div className="container mx-auto p-6">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard" aria-label="Wróć na pulpit">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
              {title}
            </h1>
            <p className="text-muted-foreground">{description}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tiles.map((tile) => {
            const TileIcon = tile.icon;
            return (
              <Link
                key={tile.href}
                href={tile.href}
                className="p-5 border rounded-lg space-y-2 hover:bg-accent/50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <TileIcon className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
                  <h2 className="font-medium group-hover:text-primary transition-colors">
                    {tile.label}
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground">{tile.description}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </RoleGate>
  );
}
