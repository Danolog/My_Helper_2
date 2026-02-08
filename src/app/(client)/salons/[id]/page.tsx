"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Heart,
  MapPin,
  Phone,
  Mail,
  Clock,
  Scissors,
  Users,
  Star,
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
import { useSession } from "@/lib/auth-client";

interface SalonDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  industryType: string | null;
  services: {
    id: string;
    name: string;
    basePrice: string;
    baseDuration: number;
    description: string | null;
  }[];
  employees: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
  }[];
  averageRating: number | null;
}

export default function SalonProfilePage() {
  const params = useParams();
  const salonId = params.id as string;
  const { data: session } = useSession();
  const [salon, setSalon] = useState<SalonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);

  const fetchSalon = useCallback(async () => {
    try {
      const res = await fetch(`/api/salons/${salonId}`);
      const json = await res.json();
      if (json.success) {
        setSalon(json.data);
      }
    } catch (error) {
      console.error("Failed to fetch salon:", error);
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  const checkFavoriteStatus = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch(`/api/favorites/salons/check?salonId=${salonId}`);
      const json = await res.json();
      if (json.success) {
        setIsFavorite(json.isFavorite);
      }
    } catch (error) {
      console.error("Failed to check favorite status:", error);
    }
  }, [session, salonId]);

  useEffect(() => {
    fetchSalon();
  }, [fetchSalon]);

  useEffect(() => {
    checkFavoriteStatus();
  }, [checkFavoriteStatus]);

  async function toggleFavorite() {
    if (!session) {
      alert("Zaloguj sie, aby dodac salon do ulubionych");
      return;
    }

    setFavoriteLoading(true);
    try {
      if (isFavorite) {
        const res = await fetch(`/api/favorites/salons?salonId=${salonId}`, {
          method: "DELETE",
        });
        const json = await res.json();
        if (json.success) {
          setIsFavorite(false);
        }
      } else {
        const res = await fetch("/api/favorites/salons", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ salonId }),
        });
        const json = await res.json();
        if (json.success) {
          setIsFavorite(true);
        }
      }
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
    } finally {
      setFavoriteLoading(false);
    }
  }

  function getIndustryLabel(type: string | null) {
    if (!type) return null;
    const labels: Record<string, string> = {
      hair_salon: "Salon fryzjerski",
      beauty: "Salon kosmetyczny",
      medical: "Gabinet lekarski",
      spa: "SPA",
      barbershop: "Barber",
      nails: "Paznokcie",
    };
    return labels[type] || type;
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12 text-muted-foreground">
          Ladowanie profilu salonu...
        </div>
      </div>
    );
  }

  if (!salon) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold mb-2">Salon nie znaleziony</h2>
          <Button asChild>
            <Link href="/salons">Powrot do listy salonow</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <Button variant="ghost" asChild>
          <Link href="/salons">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Powrot do listy
          </Link>
        </Button>
      </div>

      {/* Salon Header */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-2xl mb-2">{salon.name}</CardTitle>
              <div className="flex flex-wrap gap-2">
                {salon.industryType && (
                  <Badge variant="secondary">
                    {getIndustryLabel(salon.industryType)}
                  </Badge>
                )}
                {salon.averageRating && (
                  <Badge variant="outline" className="gap-1">
                    <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                    {salon.averageRating.toFixed(1)}
                  </Badge>
                )}
              </div>
            </div>
            <Button
              variant={isFavorite ? "default" : "outline"}
              size="sm"
              onClick={toggleFavorite}
              disabled={favoriteLoading}
              className="gap-2"
            >
              <Heart
                className={`w-4 h-4 ${
                  isFavorite ? "fill-white" : ""
                }`}
              />
              {isFavorite ? "W ulubionych" : "Dodaj do ulubionych"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {salon.address && (
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span>{salon.address}</span>
            </div>
          )}
          {salon.phone && (
            <div className="flex items-center gap-2 text-sm">
              <Phone className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span>{salon.phone}</span>
            </div>
          )}
          {salon.email && (
            <div className="flex items-center gap-2 text-sm">
              <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span>{salon.email}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Services */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Scissors className="w-5 h-5" />
              Uslugi ({salon.services.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {salon.services.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Brak dostepnych uslug
              </p>
            ) : (
              <div className="space-y-3">
                {salon.services.map((service) => (
                  <div
                    key={service.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div>
                      <p className="font-medium text-sm">{service.name}</p>
                      {service.description && (
                        <p className="text-xs text-muted-foreground">
                          {service.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {service.baseDuration} min
                        </span>
                      </div>
                    </div>
                    <Badge variant="outline">
                      {parseFloat(service.basePrice).toFixed(0)} PLN
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Employees */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="w-5 h-5" />
              Zespol ({salon.employees.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {salon.employees.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Brak informacji o zespole
              </p>
            ) : (
              <div className="space-y-3">
                {salon.employees.map((emp) => (
                  <div key={emp.id} className="flex items-center gap-3 py-2 border-b last:border-0">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm">
                      {emp.firstName.charAt(0)}
                      {emp.lastName.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-sm">
                        {emp.firstName} {emp.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {emp.role === "owner" ? "Wlasciciel" : emp.role === "employee" ? "Pracownik" : emp.role}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Separator className="my-6" />

      <div className="text-center">
        <p className="text-muted-foreground mb-4">
          Chcesz zarezerwowac wizyte w tym salonie?
        </p>
        <Button asChild size="lg">
          <Link href="/dashboard/booking">Zarezerwuj wizyte</Link>
        </Button>
      </div>
    </div>
  );
}
