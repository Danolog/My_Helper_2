"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Edit, Trash2, Tag, Scissors, Package, UserPlus, Clock } from "lucide-react";
import type { Promotion, Service } from "../_types";
import {
  TYPE_LABELS,
  TYPE_ICONS,
  DAY_NAMES_PL,
  formatDate,
  formatValue,
  isExpired,
  isUpcoming,
} from "../_types";

interface PromotionCardProps {
  promo: Promotion;
  servicesList: Service[];
  onEdit: (promo: Promotion) => void;
  onDelete: (promo: Promotion) => void;
  onToggleActive: (promo: Promotion) => void;
}

export function PromotionCard({
  promo,
  servicesList,
  onEdit,
  onDelete,
  onToggleActive,
}: PromotionCardProps) {
  const expired = isExpired(promo.endDate);
  const upcoming = isUpcoming(promo.startDate);
  const applicableServices = getServiceNames(promo, servicesList);

  return (
    <Card className={expired ? "opacity-60" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              {TYPE_ICONS[promo.type] || <Tag className="w-4 h-4" />}
            </div>
            <div>
              <CardTitle className="text-lg">{promo.name}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline">{TYPE_LABELS[promo.type] || promo.type}</Badge>
                <Badge variant={promo.isActive && !expired ? "default" : "secondary"}>
                  {expired
                    ? "Wygasla"
                    : upcoming
                      ? "Nadchodzaca"
                      : promo.isActive
                        ? "Aktywna"
                        : "Nieaktywna"}
                </Badge>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={promo.isActive}
              onCheckedChange={() => onToggleActive(promo)}
              aria-label={`Przelacz status promocji ${promo.name}`}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => onEdit(promo)}
            >
              <Edit className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => onDelete(promo)}
            >
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">
              {promo.type === "buy2get1" ? "Znizka na 3. wizyte" : promo.type === "first_visit" ? "Znizka na 1. wizyte" : promo.type === "package" ? "Cena pakietu" : "Wartosc rabatu"}
            </p>
            <p className="font-semibold text-lg">{formatValue(promo.type, promo.value)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Data rozpoczecia</p>
            <p className="font-medium">{formatDate(promo.startDate)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Data zakonczenia</p>
            <p className="font-medium">{formatDate(promo.endDate)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Utworzono</p>
            <p className="font-medium">{formatDate(promo.createdAt)}</p>
          </div>
        </div>

        {/* Buy2get1 details */}
        {promo.type === "buy2get1" && applicableServices.length > 0 && (
          <Buy2Get1Details services={applicableServices} value={promo.value} />
        )}

        {/* Package details */}
        {promo.type === "package" && (
          <PackageDetails promo={promo} servicesList={servicesList} />
        )}

        {/* First visit details */}
        {promo.type === "first_visit" && (
          <FirstVisitDetails value={promo.value} />
        )}

        {/* Happy hours details */}
        {promo.type === "happy_hours" && (
          <HappyHoursDetails promo={promo} />
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Helper: resolve service IDs to names                                */
/* ------------------------------------------------------------------ */

function getServiceNames(promo: Promotion, servicesList: Service[]): string[] {
  const conditions = promo.conditionsJson || {};
  const serviceIds = (conditions.applicableServiceIds as string[]) || [];
  return serviceIds.map((id) => {
    const svc = servicesList.find((s) => s.id === id);
    return svc ? svc.name : id.slice(0, 8) + "...";
  });
}

/* ------------------------------------------------------------------ */
/* Type-specific detail sections (private to this file)                */
/* ------------------------------------------------------------------ */

function Buy2Get1Details({ services, value }: { services: string[]; value: string }) {
  return (
    <div className="mt-3 pt-3 border-t">
      <div className="flex items-center gap-2 mb-2">
        <Scissors className="w-4 h-4 text-muted-foreground" />
        <p className="text-sm text-muted-foreground font-medium">
          Dotyczy uslug:
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        {services.map((name, i) => (
          <Badge key={i} variant="outline" className="text-xs">
            {name}
          </Badge>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Kup 2 wizyty, 3. wizyta z rabatem {formatValue("percentage", value)}
      </p>
    </div>
  );
}

function PackageDetails({ promo, servicesList }: { promo: Promotion; servicesList: Service[] }) {
  const conditions = promo.conditionsJson || {};
  const packageServiceIds = (conditions.packageServiceIds as string[]) || [];
  const packageServices = packageServiceIds
    .map((id) => servicesList.find((s) => s.id === id) || null)
    .filter((s): s is Service => s !== null);
  const totalIndividualPrice = packageServices.reduce(
    (sum, s) => sum + parseFloat(s.basePrice), 0
  );
  const totalDuration = packageServices.reduce(
    (sum, s) => sum + s.baseDuration, 0
  );
  const packagePrice = parseFloat(promo.value);
  const savings = totalIndividualPrice - packagePrice;

  return (
    <div className="mt-3 pt-3 border-t">
      <div className="flex items-center gap-2 mb-2">
        <Package className="w-4 h-4 text-blue-500" />
        <p className="text-sm text-muted-foreground font-medium">
          Uslugi w pakiecie ({packageServices.length}):
        </p>
      </div>
      <div className="space-y-1 mb-2">
        {packageServices.map((svc, i) => (
          <div key={i} className="flex items-center justify-between text-sm">
            <span>{svc.name}</span>
            <span className="text-muted-foreground line-through">
              {parseFloat(svc.basePrice).toFixed(2)} PLN
            </span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-sm pt-2 border-t">
        <span className="text-muted-foreground">Suma indywidualna:</span>
        <span className="line-through text-muted-foreground">
          {totalIndividualPrice.toFixed(2)} PLN
        </span>
      </div>
      <div className="flex items-center justify-between text-sm font-semibold">
        <span>Cena pakietu:</span>
        <span className="text-green-600">{packagePrice.toFixed(2)} PLN</span>
      </div>
      {savings > 0 && (
        <p className="text-xs text-green-600 mt-1">
          Oszczednosc: {savings.toFixed(2)} PLN ({Math.round((savings / totalIndividualPrice) * 100)}%)
          {totalDuration > 0 && ` | Laczny czas: ${totalDuration} min`}
        </p>
      )}
    </div>
  );
}

function FirstVisitDetails({ value }: { value: string }) {
  return (
    <div className="mt-3 pt-3 border-t">
      <div className="flex items-center gap-2 mb-2">
        <UserPlus className="w-4 h-4 text-blue-500" />
        <p className="text-sm text-muted-foreground font-medium">
          Znizka na pierwsza wizyte
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Nowi klienci otrzymuja {parseFloat(value)}% znizki na swoja pierwsza wizyte w salonie.
        Rabat jest automatycznie naliczany podczas rezerwacji online.
      </p>
    </div>
  );
}

function HappyHoursDetails({ promo }: { promo: Promotion }) {
  const cond = promo.conditionsJson || {};
  const days = (cond.daysOfWeek as number[]) || [];

  return (
    <div className="mt-3 pt-3 border-t">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-amber-500" />
        <p className="text-sm text-muted-foreground font-medium">
          Happy Hours
        </p>
      </div>
      <div className="space-y-1">
        <p className="text-sm">
          <span className="text-muted-foreground">Godziny: </span>
          <span className="font-medium">
            {(cond.startTime as string) || "?"} - {(cond.endTime as string) || "?"}
          </span>
        </p>
        <div className="flex items-center gap-1">
          <span className="text-sm text-muted-foreground">Dni: </span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <Badge
                key={d}
                variant={days.includes(d) ? "default" : "outline"}
                className={`text-xs px-1.5 ${!days.includes(d) ? "opacity-30" : ""}`}
              >
                {DAY_NAMES_PL[d]}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
