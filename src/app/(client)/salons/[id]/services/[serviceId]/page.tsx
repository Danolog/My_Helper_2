"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  Tag,
  Users,
  CalendarPlus,
  BadgeDollarSign,
  Layers,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface ServiceVariant {
  id: string;
  name: string;
  priceModifier: string | null;
  durationModifier: number | null;
}

interface ServiceEmployee {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  color: string | null;
  photoUrl: string | null;
  customPrice: string | null;
}

interface ServiceDetail {
  id: string;
  name: string;
  description: string | null;
  basePrice: string;
  baseDuration: number;
  isActive: boolean;
  salonId: string;
  categoryId: string | null;
  category: { id: string; name: string } | null;
  variants: ServiceVariant[];
  employees: ServiceEmployee[];
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) return `${hours}h`;
  return `${hours}h ${remaining}min`;
}

export default function ServiceDetailPage() {
  const params = useParams();
  const salonId = params.id as string;
  const serviceId = params.serviceId as string;
  const [service, setService] = useState<ServiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchService = useCallback(async () => {
    try {
      const res = await fetch(`/api/salons/${salonId}/services/${serviceId}`);
      const json = await res.json();
      if (json.success) {
        setService(json.data);
      } else {
        setError(json.error || "Nie udalo sie zaladowac uslugi");
      }
    } catch {
      setError("Blad polaczenia z serwerem");
    } finally {
      setLoading(false);
    }
  }, [salonId, serviceId]);

  useEffect(() => {
    fetchService();
  }, [fetchService]);

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12 text-muted-foreground">
          Ladowanie szczegulow uslugi...
        </div>
      </div>
    );
  }

  if (error || !service) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold mb-2">
            {error || "Usluga nie znaleziona"}
          </h2>
          <Button asChild>
            <Link href={`/salons/${salonId}`}>Powrot do salonu</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      {/* Back button */}
      <div className="mb-6">
        <Button variant="ghost" asChild>
          <Link href={`/salons/${salonId}`}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Powrot do salonu
          </Link>
        </Button>
      </div>

      {/* Service Header */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-2xl mb-2" data-testid="service-name">
                {service.name}
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                {service.category && (
                  <Badge variant="secondary" className="gap-1">
                    <Tag className="w-3 h-3" />
                    {service.category.name}
                  </Badge>
                )}
                {!service.isActive && (
                  <Badge variant="destructive">Nieaktywna</Badge>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-primary" data-testid="service-base-price">
                {parseFloat(service.basePrice).toFixed(0)} PLN
              </div>
              <div className="flex items-center gap-1 text-sm text-muted-foreground justify-end mt-1">
                <Clock className="w-4 h-4" />
                <span data-testid="service-duration">{formatDuration(service.baseDuration)}</span>
              </div>
            </div>
          </div>
        </CardHeader>

        {/* Description */}
        {service.description && (
          <CardContent className="pt-0">
            <div className="flex items-start gap-2 bg-muted/30 rounded-lg p-4">
              <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-sm text-muted-foreground" data-testid="service-description">
                {service.description}
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Variants Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Layers className="w-5 h-5" />
            Warianty uslugi
            {service.variants.length > 0 && (
              <Badge variant="secondary">{service.variants.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {service.variants.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="no-variants">
              Ta usluga nie posiada wariantow - dostepna jest w jednej wersji.
            </p>
          ) : (
            <div className="space-y-3" data-testid="variants-list">
              {service.variants.map((variant) => {
                const priceModifier = variant.priceModifier
                  ? parseFloat(variant.priceModifier)
                  : 0;
                const durationModifier = variant.durationModifier || 0;
                const totalPrice =
                  parseFloat(service.basePrice) + priceModifier;
                const totalDuration = service.baseDuration + durationModifier;

                return (
                  <div
                    key={variant.id}
                    className="flex items-center justify-between p-3 border rounded-lg bg-background hover:bg-muted/20 transition-colors"
                    data-testid={`variant-${variant.id}`}
                  >
                    <div>
                      <p className="font-medium">{variant.name}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDuration(totalDuration)}
                        </span>
                        {priceModifier !== 0 && (
                          <span
                            className={`text-sm ${priceModifier > 0 ? "text-red-500" : "text-green-600"}`}
                          >
                            ({priceModifier > 0 ? "+" : ""}
                            {priceModifier.toFixed(0)} PLN do bazowej)
                          </span>
                        )}
                        {durationModifier !== 0 && (
                          <span className="text-sm text-muted-foreground">
                            ({durationModifier > 0 ? "+" : ""}
                            {durationModifier} min)
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="font-semibold text-base px-3 py-1"
                      data-testid={`variant-price-${variant.id}`}
                    >
                      {totalPrice.toFixed(0)} PLN
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Available Employees Section */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="w-5 h-5" />
            Dostepni specjalisci
            {service.employees.length > 0 && (
              <Badge variant="secondary">{service.employees.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {service.employees.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="no-employees">
              Wszyscy pracownicy salonu wykonuja te usluge.
            </p>
          ) : (
            <div className="space-y-3" data-testid="employees-list">
              {service.employees.map((emp) => (
                <div
                  key={emp.id}
                  className="flex items-center justify-between p-3 border rounded-lg bg-background hover:bg-muted/20 transition-colors"
                  data-testid={`employee-${emp.id}`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium text-sm"
                      style={{
                        backgroundColor: emp.color || "#6b7280",
                      }}
                    >
                      {emp.firstName.charAt(0)}
                      {emp.lastName.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium">
                        {emp.firstName} {emp.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {emp.role === "owner"
                          ? "Wlasciciel"
                          : emp.role === "employee"
                            ? "Pracownik"
                            : emp.role}
                      </p>
                    </div>
                  </div>
                  {emp.customPrice && (
                    <div className="flex items-center gap-1">
                      <BadgeDollarSign className="w-4 h-4 text-muted-foreground" />
                      <Badge variant="outline" className="font-semibold">
                        {parseFloat(emp.customPrice).toFixed(0)} PLN
                      </Badge>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Separator className="my-6" />

      {/* Booking Button */}
      <div className="text-center" data-testid="booking-section">
        <p className="text-muted-foreground mb-4">
          Chcesz zarezerwowac te usluge?
        </p>
        <Button asChild size="lg" className="gap-2">
          <Link href={`/dashboard/booking?serviceId=${service.id}&salonId=${salonId}`}>
            <CalendarPlus className="w-5 h-5" />
            Zarezerwuj wizyte
          </Link>
        </Button>
      </div>
    </div>
  );
}
