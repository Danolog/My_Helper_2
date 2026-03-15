"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Heart, MapPin, Phone, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";
import { mutationFetch } from "@/lib/api-client";

interface FavoriteSalon {
  id: string;
  salonId: string;
  createdAt: string;
  salonName: string;
  salonPhone: string | null;
  salonEmail: string | null;
  salonAddress: string | null;
  salonIndustryType: string | null;
}

export default function FavoritesPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [favorites, setFavorites] = useState<FavoriteSalon[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFavorites = useCallback(async () => {
    try {
      const res = await fetch("/api/favorites/salons");
      const json = await res.json();
      if (json.success) {
        setFavorites(json.data);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/login");
      return;
    }
    if (session) {
      fetchFavorites();
    }
  }, [session, isPending, router, fetchFavorites]);

  async function removeFavorite(salonId: string) {
    try {
      const res = await mutationFetch(`/api/favorites/salons?salonId=${salonId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (json.success) {
        setFavorites((prev) => prev.filter((f) => f.salonId !== salonId));
      }
    } catch {
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

  if (isPending || loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12 text-muted-foreground">
          Ladowanie ulubionych salonow...
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <Button variant="ghost" asChild>
          <Link href="/salons">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Powrot do listy salonow
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <Heart className="w-6 h-6 text-red-500 fill-red-500" />
        <h1 className="text-3xl font-bold">Ulubione salony</h1>
      </div>

      {favorites.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Heart className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold mb-2">
              Nie masz jeszcze ulubionych salonow
            </h2>
            <p className="text-muted-foreground mb-4">
              Przegladaj salony i dodawaj je do ulubionych, aby miec do nich
              szybki dostep.
            </p>
            <Button asChild>
              <Link href="/salons">Przegladaj salony</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {favorites.map((fav) => (
            <Card key={fav.id} className="h-full">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <Link href={`/salons/${fav.salonId}`} className="flex-1">
                    <CardTitle className="text-lg hover:text-primary transition-colors">
                      {fav.salonName}
                    </CardTitle>
                    {fav.salonIndustryType && (
                      <Badge variant="secondary" className="mt-1">
                        {getIndustryLabel(fav.salonIndustryType)}
                      </Badge>
                    )}
                  </Link>
                  <button
                    onClick={() => removeFavorite(fav.salonId)}
                    className="p-1 hover:bg-muted rounded-md transition-colors"
                    aria-label="Usun z ulubionych"
                    title="Usun z ulubionych"
                  >
                    <Heart className="w-5 h-5 fill-red-500 text-red-500" />
                  </button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {fav.salonAddress && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="w-4 h-4 flex-shrink-0" />
                    <span>{fav.salonAddress}</span>
                  </div>
                )}
                {fav.salonPhone && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="w-4 h-4 flex-shrink-0" />
                    <span>{fav.salonPhone}</span>
                  </div>
                )}
                <div className="pt-2">
                  <Button asChild size="sm" variant="outline" className="w-full">
                    <Link href={`/salons/${fav.salonId}`}>
                      Zobacz profil
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
