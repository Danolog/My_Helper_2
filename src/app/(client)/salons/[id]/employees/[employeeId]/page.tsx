"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Star,
  Scissors,
  Camera,
  MessageSquare,
  Clock,
  User,
  Package,
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

interface EmployeeSpecialty {
  id: string;
  name: string;
  basePrice: string;
  baseDuration: number;
}

interface Review {
  id: string;
  rating: number | null;
  comment: string | null;
  createdAt: string;
  clientName: string;
}

interface GalleryPhoto {
  id: string;
  beforePhotoUrl: string | null;
  afterPhotoUrl: string | null;
  description: string | null;
  productsUsed: string | null;
  showProductsToClients: boolean;
  createdAt: string;
}

interface EmployeeDetail {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  photoUrl: string | null;
  color: string | null;
  phone: string | null;
  email: string | null;
  salon: {
    id: string;
    name: string;
  };
  specialties: EmployeeSpecialty[];
  averageRating: number | null;
  reviewCount: number;
  recentReviews: Review[];
  galleryPhotos: GalleryPhoto[];
  galleryCount: number;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) return `${hours}h`;
  return `${hours}h ${remaining}min`;
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`w-4 h-4 ${
            star <= rating
              ? "fill-yellow-400 text-yellow-400"
              : "text-gray-300"
          }`}
        />
      ))}
    </div>
  );
}

export default function EmployeeProfilePage() {
  const params = useParams();
  const salonId = params.id as string;
  const employeeId = params.employeeId as string;
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchEmployee = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/salons/${salonId}/employees/${employeeId}`
      );
      const json = await res.json();
      if (json.success) {
        setEmployee(json.data);
      }
    } catch (error) {
      console.error("Failed to fetch employee:", error);
    } finally {
      setLoading(false);
    }
  }, [salonId, employeeId]);

  useEffect(() => {
    fetchEmployee();
  }, [fetchEmployee]);

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12 text-muted-foreground">
          Ladowanie profilu pracownika...
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold mb-2">
            Pracownik nie znaleziony
          </h2>
          <Button asChild>
            <Link href={`/salons/${salonId}`}>Powrot do salonu</Link>
          </Button>
        </div>
      </div>
    );
  }

  function getRoleLabel(role: string) {
    switch (role) {
      case "owner":
        return "Wlasciciel";
      case "employee":
        return "Pracownik";
      case "receptionist":
        return "Recepcja";
      default:
        return role;
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      {/* Back navigation */}
      <div className="mb-6">
        <Button variant="ghost" asChild>
          <Link href={`/salons/${salonId}`}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Powrot do {employee.salon.name}
          </Link>
        </Button>
      </div>

      {/* Employee Header */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            {/* Photo / Avatar */}
            {employee.photoUrl ? (
              <img
                src={employee.photoUrl}
                alt={`${employee.firstName} ${employee.lastName}`}
                className="w-20 h-20 rounded-full object-cover flex-shrink-0"
                data-testid="employee-photo"
              />
            ) : (
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center text-white font-bold text-xl flex-shrink-0"
                style={{
                  backgroundColor: employee.color || "#3b82f6",
                }}
                data-testid="employee-avatar"
              >
                {employee.firstName.charAt(0)}
                {employee.lastName.charAt(0)}
              </div>
            )}

            <div className="flex-1">
              <h1 className="text-2xl font-bold" data-testid="employee-full-name">
                {employee.firstName} {employee.lastName}
              </h1>
              <Badge variant="secondary" className="mt-1">
                {getRoleLabel(employee.role)}
              </Badge>

              {/* Rating */}
              <div className="flex items-center gap-2 mt-3" data-testid="employee-profile-rating">
                {employee.averageRating !== null && employee.averageRating > 0 ? (
                  <>
                    <StarRating rating={Math.round(employee.averageRating)} />
                    <span className="font-semibold text-sm">
                      {employee.averageRating.toFixed(1)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      ({employee.reviewCount}{" "}
                      {employee.reviewCount === 1
                        ? "opinia"
                        : employee.reviewCount < 5
                          ? "opinie"
                          : "opinii"})
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    Brak opinii
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Specialties / Services */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Scissors className="w-5 h-5" />
              Specjalizacje ({employee.specialties.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {employee.specialties.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="no-specialties">
                Brak przypisanych uslug
              </p>
            ) : (
              <div className="space-y-2" data-testid="specialties-list">
                {employee.specialties.map((spec) => (
                  <div
                    key={spec.id}
                    className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50"
                  >
                    <div>
                      <p className="text-sm font-medium">{spec.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {formatDuration(spec.baseDuration)}
                        </span>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {parseFloat(spec.basePrice).toFixed(0)} PLN
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Portfolio / Gallery link */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Camera className="w-5 h-5" />
              Portfolio
            </CardTitle>
          </CardHeader>
          <CardContent>
            {employee.galleryCount > 0 ? (
              <div data-testid="portfolio-section">
                <p className="text-sm text-muted-foreground mb-3">
                  {employee.galleryCount}{" "}
                  {employee.galleryCount === 1
                    ? "zdjecie"
                    : employee.galleryCount < 5
                      ? "zdjecia"
                      : "zdjec"}{" "}
                  w portfolio
                </p>
                {/* Show a preview grid of gallery photos */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {employee.galleryPhotos.slice(0, 4).map((photo) => (
                    <div
                      key={photo.id}
                      className="rounded-lg bg-muted overflow-hidden"
                    >
                      <div className="aspect-square relative">
                        {photo.afterPhotoUrl ? (
                          <img
                            src={photo.afterPhotoUrl}
                            alt={photo.description || "Portfolio photo"}
                            className="w-full h-full object-cover"
                          />
                        ) : photo.beforePhotoUrl ? (
                          <img
                            src={photo.beforePhotoUrl}
                            alt={photo.description || "Portfolio photo"}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Camera className="w-8 h-8 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      {photo.productsUsed && photo.showProductsToClients && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground flex items-start gap-1" data-testid="product-info-visible">
                          <Package className="w-3 h-3 mt-0.5 shrink-0" />
                          <span className="line-clamp-2">{photo.productsUsed}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link
                    href={`/salons/${salonId}/employees/${employeeId}/portfolio`}
                    data-testid="portfolio-link"
                  >
                    <Camera className="w-4 h-4 mr-2" />
                    Zobacz pelne portfolio
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="text-center py-4" data-testid="no-portfolio">
                <Camera className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Brak zdjec w portfolio
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled
                  data-testid="portfolio-link"
                >
                  <Camera className="w-4 h-4 mr-2" />
                  Portfolio
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reviews section */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageSquare className="w-5 h-5" />
              Opinie ({employee.reviewCount})
            </CardTitle>
            {employee.reviewCount > 0 && (
              <Button variant="outline" size="sm" asChild>
                <Link
                  href={`/salons/${salonId}/employees/${employeeId}/reviews`}
                  data-testid="reviews-link"
                >
                  Zobacz wszystkie
                </Link>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {employee.recentReviews.length === 0 ? (
            <div className="text-center py-4" data-testid="no-reviews">
              <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                Brak opinii - badz pierwsza osoba, ktora wystawi ocene!
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                disabled
                data-testid="reviews-link"
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                Opinie
              </Button>
            </div>
          ) : (
            <div className="space-y-4" data-testid="reviews-list">
              {employee.recentReviews.map((review) => (
                <div key={review.id} className="border-b last:border-0 pb-3 last:pb-0" data-testid="review-item">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium" data-testid="reviewer-name">
                        {review.clientName}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground" data-testid="review-date">
                      {new Date(review.createdAt).toLocaleDateString("pl-PL")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-1 ml-6">
                    {review.rating ? (
                      <StarRating rating={review.rating} />
                    ) : (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" />
                        Komentarz
                      </span>
                    )}
                  </div>
                  {review.comment && (
                    <p className="text-sm text-muted-foreground ml-6">
                      {review.comment}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Separator className="my-6" />

      {/* Book appointment CTA */}
      <div className="text-center">
        <p className="text-muted-foreground mb-4">
          Chcesz umowic sie na wizyte z {employee.firstName}?
        </p>
        <Button asChild size="lg">
          <Link href="/dashboard/booking">
            <User className="w-4 h-4 mr-2" />
            Zarezerwuj wizyte
          </Link>
        </Button>
      </div>
    </div>
  );
}
