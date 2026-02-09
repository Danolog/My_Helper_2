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
  ChevronDown,
  ChevronUp,
  Tag,
  Eye,
  Image as ImageIcon,
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

interface ServiceVariant {
  id: string;
  serviceId: string;
  name: string;
  priceModifier: string | null;
  durationModifier: number | null;
}

interface ServiceItem {
  id: string;
  name: string;
  basePrice: string;
  baseDuration: number;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  variants: ServiceVariant[];
}

interface ServiceCategory {
  id: string;
  name: string;
  sortOrder: number | null;
}

interface EmployeeProfile {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  photoUrl: string | null;
  color: string | null;
  specialties: string[];
  averageRating: number | null;
  reviewCount: number;
  galleryCount: number;
}

interface SalonDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  industryType: string | null;
  services: ServiceItem[];
  categories: ServiceCategory[];
  employees: EmployeeProfile[];
  averageRating: number | null;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) return `${hours}h`;
  return `${hours}h ${remaining}min`;
}

function ServiceCard({
  service,
  isExpanded,
  onToggle,
  salonId,
}: {
  service: ServiceItem;
  isExpanded: boolean;
  onToggle: () => void;
  salonId: string;
}) {
  const hasDetails = service.description || service.variants.length > 0;

  return (
    <div
      className={`border rounded-lg transition-all ${hasDetails ? "cursor-pointer hover:border-primary/40 hover:shadow-sm" : ""}`}
      onClick={hasDetails ? onToggle : undefined}
      data-testid={`service-${service.id}`}
    >
      <div className="flex items-center justify-between p-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm">{service.name}</p>
            {service.variants.length > 0 && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                {service.variants.length} wariant{service.variants.length === 1 ? "" : service.variants.length < 5 ? "y" : "ow"}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {formatDuration(service.baseDuration)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-semibold whitespace-nowrap">
            {parseFloat(service.basePrice).toFixed(0)} PLN
          </Badge>
          {!hasDetails && (
            <Link
              href={`/salons/${salonId}/services/${service.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-primary hover:text-primary/80"
              data-testid={`service-details-link-${service.id}`}
            >
              <Eye className="w-4 h-4" />
            </Link>
          )}
          {hasDetails && (
            <div className="text-muted-foreground">
              {isExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Expandable details */}
      {isExpanded && hasDetails && (
        <div className="px-3 pb-3 border-t bg-muted/30">
          {service.description && (
            <p className="text-sm text-muted-foreground mt-2 mb-2">
              {service.description}
            </p>
          )}
          {service.variants.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
                Warianty
              </p>
              <div className="space-y-1.5">
                {service.variants.map((variant) => {
                  const priceModifier = variant.priceModifier
                    ? parseFloat(variant.priceModifier)
                    : 0;
                  const durationModifier = variant.durationModifier || 0;
                  const totalPrice =
                    parseFloat(service.basePrice) + priceModifier;
                  const totalDuration =
                    service.baseDuration + durationModifier;

                  return (
                    <div
                      key={variant.id}
                      className="flex items-center justify-between py-1.5 px-2 rounded bg-background text-sm"
                    >
                      <div>
                        <span className="font-medium">{variant.name}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDuration(totalDuration)}
                          </span>
                          {priceModifier !== 0 && (
                            <span
                              className={`text-xs ${priceModifier > 0 ? "text-red-500" : "text-green-600"}`}
                            >
                              ({priceModifier > 0 ? "+" : ""}
                              {priceModifier.toFixed(0)} PLN)
                            </span>
                          )}
                          {durationModifier !== 0 && (
                            <span className="text-xs text-muted-foreground">
                              ({durationModifier > 0 ? "+" : ""}
                              {durationModifier} min)
                            </span>
                          )}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {totalPrice.toFixed(0)} PLN
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="mt-3 flex justify-end">
            <Link
              href={`/salons/${salonId}/services/${service.id}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
              data-testid={`service-details-link-${service.id}`}
            >
              <Eye className="w-3.5 h-3.5" />
              Szczegoly uslugi
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SalonProfilePage() {
  const params = useParams();
  const salonId = params.id as string;
  const { data: session } = useSession();
  const [salon, setSalon] = useState<SalonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [expandedServices, setExpandedServices] = useState<Set<string>>(
    new Set()
  );

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
      const res = await fetch(
        `/api/favorites/salons/check?salonId=${salonId}`
      );
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

  function toggleServiceExpanded(serviceId: string) {
    setExpandedServices((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) {
        next.delete(serviceId);
      } else {
        next.add(serviceId);
      }
      return next;
    });
  }

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
      beauty_salon: "Salon kosmetyczny",
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

  // Group services by category
  const categorizedServices: {
    categoryId: string | null;
    categoryName: string;
    services: ServiceItem[];
  }[] = [];

  // Build a map of categories from the salon data
  const categoryMap = new Map<string, string>();
  if (salon.categories) {
    for (const cat of salon.categories) {
      categoryMap.set(cat.id, cat.name);
    }
  }

  // Group services
  const servicesByCategory = new Map<string | null, ServiceItem[]>();
  for (const service of salon.services) {
    const catId = service.categoryId;
    if (!servicesByCategory.has(catId)) {
      servicesByCategory.set(catId, []);
    }
    servicesByCategory.get(catId)!.push(service);
  }

  // Sort categories: named categories first (sorted by their sortOrder), then uncategorized last
  const sortedCategoryIds = Array.from(servicesByCategory.keys()).sort(
    (a, b) => {
      if (a === null) return 1;
      if (b === null) return -1;
      // Use category sortOrder from the salon.categories array
      const catA = salon.categories?.find((c) => c.id === a);
      const catB = salon.categories?.find((c) => c.id === b);
      return (catA?.sortOrder ?? 999) - (catB?.sortOrder ?? 999);
    }
  );

  for (const catId of sortedCategoryIds) {
    const servicesInCat = servicesByCategory.get(catId) || [];
    categorizedServices.push({
      categoryId: catId,
      categoryName: catId ? categoryMap.get(catId) || "Inne" : "Inne uslugi",
      services: servicesInCat,
    });
  }

  const hasMultipleCategories = categorizedServices.length > 1;

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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Services - takes 2 columns on desktop */}
        <Card className="md:col-span-2">
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
            ) : hasMultipleCategories ? (
              // Show services grouped by category
              <div className="space-y-6">
                {categorizedServices.map((group) => (
                  <div key={group.categoryId || "uncategorized"}>
                    <div className="flex items-center gap-2 mb-3">
                      <Tag className="w-4 h-4 text-primary" />
                      <h3 className="font-semibold text-sm uppercase tracking-wider text-primary">
                        {group.categoryName}
                      </h3>
                      <Badge variant="secondary" className="text-xs">
                        {group.services.length}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      {group.services.map((service) => (
                        <ServiceCard
                          key={service.id}
                          service={service}
                          isExpanded={expandedServices.has(service.id)}
                          onToggle={() => toggleServiceExpanded(service.id)}
                          salonId={salonId}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              // Single category or no categories - flat list
              <div className="space-y-2">
                {salon.services.map((service) => (
                  <ServiceCard
                    key={service.id}
                    service={service}
                    isExpanded={expandedServices.has(service.id)}
                    onToggle={() => toggleServiceExpanded(service.id)}
                    salonId={salonId}
                  />
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
                  <Link
                    key={emp.id}
                    href={`/salons/${salonId}/employees/${emp.id}`}
                    className="block"
                    data-testid={`employee-card-${emp.id}`}
                  >
                    <div className="flex items-start gap-3 py-3 px-2 border rounded-lg hover:border-primary/40 hover:shadow-sm transition-all cursor-pointer">
                      {/* Employee Photo / Avatar */}
                      {emp.photoUrl ? (
                        <img
                          src={emp.photoUrl}
                          alt={`${emp.firstName} ${emp.lastName}`}
                          className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div
                          className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
                          style={{
                            backgroundColor: emp.color || "#3b82f6",
                          }}
                        >
                          {emp.firstName.charAt(0)}
                          {emp.lastName.charAt(0)}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        {/* Name */}
                        <p className="font-medium text-sm" data-testid={`employee-name-${emp.id}`}>
                          {emp.firstName} {emp.lastName}
                        </p>

                        {/* Role */}
                        <p className="text-xs text-muted-foreground capitalize">
                          {emp.role === "owner"
                            ? "Wlasciciel"
                            : emp.role === "employee"
                              ? "Pracownik"
                              : emp.role === "receptionist"
                                ? "Recepcja"
                                : emp.role}
                        </p>

                        {/* Specialties */}
                        {emp.specialties && emp.specialties.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5" data-testid={`employee-specialties-${emp.id}`}>
                            {emp.specialties.slice(0, 3).map((spec, idx) => (
                              <Badge
                                key={idx}
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0"
                              >
                                {spec}
                              </Badge>
                            ))}
                            {emp.specialties.length > 3 && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0"
                              >
                                +{emp.specialties.length - 3}
                              </Badge>
                            )}
                          </div>
                        )}

                        {/* Rating + Stats */}
                        <div className="flex items-center gap-3 mt-1.5">
                          {emp.averageRating !== null && emp.averageRating > 0 && (
                            <div className="flex items-center gap-1" data-testid={`employee-rating-${emp.id}`}>
                              <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                              <span className="text-xs font-medium">
                                {emp.averageRating.toFixed(1)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                ({emp.reviewCount})
                              </span>
                            </div>
                          )}
                          {emp.galleryCount > 0 && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Scissors className="w-3 h-3" />
                              <span>
                                {emp.galleryCount} {emp.galleryCount === 1 ? "praca" : "prac"}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Gallery Preview Section */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ImageIcon className="w-5 h-5" />
              Galeria
            </CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/salons/${salonId}/gallery`} data-testid="gallery-link">
                Zobacz pelna galerie
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Przegladaj portfolio zdjec salonu - efekty zabiegow, metamorfozy przed i po.
          </p>
        </CardContent>
      </Card>

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
