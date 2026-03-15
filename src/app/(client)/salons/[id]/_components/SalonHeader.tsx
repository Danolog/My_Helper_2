"use client";

import {
  Heart,
  MapPin,
  Phone,
  Mail,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SalonDetail } from "../_types";

interface SalonHeaderProps {
  salon: SalonDetail;
  isFavorite: boolean;
  favoriteLoading: boolean;
  onToggleFavorite: () => void;
}

function getIndustryLabel(type: string | null) {
  if (!type) return null;
  const labels: Record<string, string> = {
    hair_salon: "Salon fryzjerski",
    beauty: "Salon kosmetyczny",
    beauty_salon: "Salon kosmetyczny",
    medical: "Gabinet lekarski",
    spa: "SPA",
    barbershop: "Barber",
    nails: "Paznokcie",
  };
  return labels[type] || type;
}

export function SalonHeader({
  salon,
  isFavorite,
  favoriteLoading,
  onToggleFavorite,
}: SalonHeaderProps) {
  return (
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
            onClick={onToggleFavorite}
            disabled={favoriteLoading}
            className="gap-2"
          >
            <Heart
              className={`w-4 h-4 ${isFavorite ? "fill-white" : ""}`}
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
  );
}
