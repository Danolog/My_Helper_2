"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Search, MapPin, Phone, Star, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NetworkErrorHandler } from "@/components/network-error-handler";
import { getNetworkErrorMessage } from "@/lib/fetch-with-retry";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";

interface Salon {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  industryType: string | null;
}

export default function SalonsListPage() {
  const { data: session } = useSession();
  const [salons, setSalons] = useState<Salon[]>([]);
  const [filteredSalons, setFilteredSalons] = useState<Salon[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState<{ message: string; isNetwork: boolean } | null>(null);

  useEffect(() => {
    fetchSalons();
  }, []);

  useEffect(() => {
    if (session) {
      fetchFavorites();
    }
  }, [session]);

  useEffect(() => {
    if (!search.trim()) {
      setFilteredSalons(salons);
    } else {
      const q = search.toLowerCase();
      setFilteredSalons(
        salons.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.address && s.address.toLowerCase().includes(q)) ||
            (s.industryType && s.industryType.toLowerCase().includes(q))
        )
      );
    }
  }, [search, salons]);

  async function fetchSalons() {
    try {
      setFetchError(null);
      const res = await fetch("/api/salons");
      const json = await res.json();
      if (json.success) {
        setSalons(json.data);
      }
    } catch (error) {
      console.error("Failed to fetch salons:", error);
      const errInfo = getNetworkErrorMessage(error);
      setFetchError(errInfo);
    } finally {
      setLoading(false);
    }
  }

  async function fetchFavorites() {
    try {
      const res = await fetch("/api/favorites/salons");
      const json = await res.json();
      if (json.success) {
        const ids = new Set<string>(json.data.map((f: { salonId: string }) => f.salonId));
        setFavoriteIds(ids);
      }
    } catch (error) {
      console.error("Failed to fetch favorites:", error);
    }
  }

  async function toggleFavorite(salonId: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (!session) {
      alert("Zaloguj sie, aby dodac salon do ulubionych");
      return;
    }

    const isFav = favoriteIds.has(salonId);

    try {
      if (isFav) {
        const res = await fetch(`/api/favorites/salons?salonId=${salonId}`, {
          method: "DELETE",
        });
        const json = await res.json();
        if (json.success) {
          setFavoriteIds((prev) => {
            const next = new Set(prev);
            next.delete(salonId);
            return next;
          });
        }
      } else {
        const res = await fetch("/api/favorites/salons", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ salonId }),
        });
        const json = await res.json();
        if (json.success) {
          setFavoriteIds((prev) => {
            const next = new Set(prev);
            next.add(salonId);
            return next;
          });
        }
      }
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
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

  if (fetchError) {
    return (
      <div className="container mx-auto p-6">
        <NetworkErrorHandler
          message={fetchError.message}
          isNetworkError={fetchError.isNetwork}
          onRetry={async () => {
            setLoading(true);
            await fetchSalons();
          }}
          isRetrying={loading}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12 text-muted-foreground">
          Ladowanie salonow...
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Salony</h1>
            <p className="text-muted-foreground">
              Przegladaj salony i rezerwuj wizyty
            </p>
          </div>
          {session && (
            <Button asChild variant="outline">
              <Link href="/favorites">
                <Heart className="w-4 h-4 mr-2" />
                Ulubione
              </Link>
            </Button>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Szukaj salonu po nazwie, adresie lub typie..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {filteredSalons.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {search ? "Brak wynikow wyszukiwania" : "Brak dostepnych salonow"}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSalons.map((salon) => (
              <Link key={salon.id} href={`/salons/${salon.id}`}>
                <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg">{salon.name}</CardTitle>
                        {salon.industryType && (
                          <div className="mt-1">
                            <Badge variant="secondary">
                              {getIndustryLabel(salon.industryType)}
                            </Badge>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => toggleFavorite(salon.id, e)}
                        className="p-1 hover:bg-muted rounded-md transition-colors"
                        aria-label={
                          favoriteIds.has(salon.id)
                            ? "Usun z ulubionych"
                            : "Dodaj do ulubionych"
                        }
                      >
                        <Heart
                          className={`w-5 h-5 ${
                            favoriteIds.has(salon.id)
                              ? "fill-red-500 text-red-500"
                              : "text-muted-foreground"
                          }`}
                        />
                      </button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {salon.address && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="w-4 h-4 flex-shrink-0" />
                        <span>{salon.address}</span>
                      </div>
                    )}
                    {salon.phone && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Phone className="w-4 h-4 flex-shrink-0" />
                        <span>{salon.phone}</span>
                      </div>
                    )}
                    {!salon.address && !salon.phone && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Star className="w-4 h-4" />
                        <span>Zobacz szczegoly salonu</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
