"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Search, MapPin, Phone, Star, Heart, Scissors, ArrowRight, Clock } from "lucide-react";
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
  serviceCount?: number;
  averageRating?: number | null;
  reviewCount?: number;
}

const CATEGORIES = [
  { value: "", label: "Wszystkie" },
  { value: "hair_salon", label: "Fryzjer" },
  { value: "beauty_salon", label: "Kosmetyczka" },
  { value: "nails", label: "Paznokcie" },
  { value: "barbershop", label: "Barber" },
  { value: "spa", label: "SPA" },
  { value: "medical", label: "Gabinet" },
] as const;

export default function SalonsListPage() {
  const { data: session } = useSession();
  const [salons, setSalons] = useState<Salon[]>([]);
  const [filteredSalons, setFilteredSalons] = useState<Salon[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [selectedCategory, setSelectedCategory] = useState("");
  const [fetchError, setFetchError] = useState<{ message: string; isNetwork: boolean; isTimeout: boolean } | null>(null);

  useEffect(() => {
    fetchSalons();
  }, []);

  useEffect(() => {
    if (session) {
      fetchFavorites();
    }
  }, [session]);

  useEffect(() => {
    let result = salons;
    if (selectedCategory) {
      result = result.filter((s) => s.industryType === selectedCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.address && s.address.toLowerCase().includes(q)) ||
          (s.industryType && s.industryType.toLowerCase().includes(q))
      );
    }
    setFilteredSalons(result);
  }, [search, salons, selectedCategory]);

  async function fetchSalons() {
    try {
      setFetchError(null);
      const res = await fetch("/api/salons");
      const json = await res.json();
      if (json.success) {
        setSalons(json.data);
      }
    } catch (error) {
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
    } catch {
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
    } catch {
    }
  }

  function getIndustryLabel(type: string | null) {
    if (!type) return null;
    const labels: Record<string, string> = {
      hair_salon: "Salon fryzjerski",
      beauty_salon: "Salon kosmetyczny",
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
          isTimeout={fetchError.isTimeout}
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
    <div>
      {/* Hero search section */}
      <section className="bg-gradient-to-b from-primary/5 to-transparent py-12 md:py-16">
        <div className="container mx-auto px-4 text-center">
          <h1 className="font-[family-name:var(--font-playfair)] text-4xl md:text-5xl font-bold tracking-tight mb-3">
            Znajdz idealny salon
          </h1>
          <p className="text-muted-foreground text-lg mb-8 max-w-lg mx-auto">
            Przegladaj salony, porownuj uslugi i rezerwuj wizyty online.
          </p>
          <div className="relative max-w-xl mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Szukaj salonu po nazwie, adresie lub typie..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-12 h-12 rounded-full text-base"
            />
          </div>
          {/* Category chips */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setSelectedCategory(cat.value)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  selectedCategory === cat.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground hover:bg-primary/10"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-muted-foreground">
            {filteredSalons.length} {filteredSalons.length === 1 ? "salon" : "salonow"}
          </p>
          {session && (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link href="/favorites">
                <Heart className="w-4 h-4 mr-2" />
                Ulubione
              </Link>
            </Button>
          )}
        </div>

        {filteredSalons.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {search || selectedCategory ? "Brak wynikow wyszukiwania" : "Brak dostepnych salonow"}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredSalons.map((salon) => {
              const hasServices = (salon.serviceCount ?? 0) > 0;
              return (
              <Link key={salon.id} href={`/salons/${salon.id}`}>
                <Card className={`h-full border-border/60 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-1 transition-all duration-300 cursor-pointer ${!hasServices ? "opacity-75" : ""}`}>
                  {/* Gradient placeholder header */}
                  <div className="relative h-32 rounded-t-xl bg-gradient-to-br from-primary/10 via-rose-light/10 to-gold/10 flex items-center justify-center">
                    <Scissors className="h-8 w-8 text-primary/30" />
                    {!hasServices && (
                      <Badge variant="secondary" className="absolute top-3 right-3 text-xs gap-1">
                        <Clock className="w-3 h-3" />
                        Wkrotce dostepne
                      </Badge>
                    )}
                  </div>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="font-[family-name:var(--font-playfair)] text-lg">{salon.name}</CardTitle>
                        {salon.industryType && (
                          <div className="mt-1.5">
                            <Badge variant="secondary" className="text-xs">
                              {getIndustryLabel(salon.industryType)}
                            </Badge>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={(e) => toggleFavorite(salon.id, e)}
                        className="p-1.5 hover:bg-muted rounded-full transition-colors"
                        aria-label={
                          favoriteIds.has(salon.id)
                            ? "Usun z ulubionych"
                            : "Dodaj do ulubionych"
                        }
                      >
                        <Heart
                          className={`w-5 h-5 ${
                            favoriteIds.has(salon.id)
                              ? "fill-primary text-primary"
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
                    {salon.averageRating && (
                      <div className="flex items-center gap-1.5 text-sm">
                        <Star className="w-4 h-4 fill-gold text-gold" />
                        <span className="font-medium">{salon.averageRating}</span>
                        <span className="text-muted-foreground">({salon.reviewCount} opinii)</span>
                      </div>
                    )}
                    {hasServices && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Scissors className="w-4 h-4 flex-shrink-0" />
                        <span>{salon.serviceCount} {salon.serviceCount === 1 ? "usluga" : (salon.serviceCount ?? 0) < 5 ? "uslugi" : "uslug"}</span>
                      </div>
                    )}
                    <div className="pt-3">
                      {hasServices ? (
                        <Button variant="outline" size="sm" className="w-full rounded-full text-primary border-primary/30 hover:bg-primary/5">
                          Zarezerwuj
                          <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" className="w-full rounded-full" disabled>
                          Wkrotce dostepne
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
