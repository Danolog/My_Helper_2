"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Lock,
  ArrowLeft,
  Package,
  Clock,
  User,
  Scissors,
  AlertTriangle,
  History,
  ExternalLink,
  TrendingDown,
} from "lucide-react";
import { toast } from "sonner";

interface ProductDetail {
  id: string;
  name: string;
  category: string | null;
  quantity: string | null;
  unit: string | null;
  pricePerUnit: string | null;
  minQuantity: string | null;
}

interface UsageRecord {
  id: string;
  quantityUsed: string;
  notes: string | null;
  createdAt: string;
  appointment: {
    id: string;
    startTime: string;
    endTime: string;
    status: string;
    client: {
      id: string;
      firstName: string;
      lastName: string;
    } | null;
    employee: {
      id: string;
      firstName: string;
      lastName: string;
    } | null;
    service: {
      id: string;
      name: string;
    } | null;
  };
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    scheduled: "Zaplanowana",
    confirmed: "Potwierdzona",
    completed: "Zakonczona",
    cancelled: "Anulowana",
    no_show: "Nieobecnosc",
  };
  return labels[status] || status;
}

function getStatusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "confirmed":
      return "secondary";
    case "cancelled":
    case "no_show":
      return "destructive";
    default:
      return "outline";
  }
}

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;
  const { data: session, isPending } = useSession();

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [history, setHistory] = useState<UsageRecord[]>([]);
  const [totalUsed, setTotalUsed] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchUsageHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/usage-history`);
      const data = await res.json();
      if (data.success) {
        setProduct(data.data.product);
        setHistory(data.data.history);
        setTotalUsed(data.data.totalUsed);
      } else {
        toast.error("Nie znaleziono produktu");
        router.push("/dashboard/products");
      }
    } catch (error) {
      console.error("Failed to fetch usage history:", error);
      toast.error("Blad podczas ladowania historii zuzycia");
    } finally {
      setLoading(false);
    }
  }, [productId, router]);

  useEffect(() => {
    fetchUsageHistory();
  }, [fetchUsageHistory]);

  if (isPending || loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Wymagane logowanie</h1>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <p className="text-muted-foreground">Nie znaleziono produktu</p>
      </div>
    );
  }

  const qty = parseFloat(product.quantity || "0");
  const minQty = product.minQuantity ? parseFloat(product.minQuantity) : null;
  const isLowStock = minQty !== null && qty <= minQty;

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push("/dashboard/products")}
          data-testid="back-btn"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold" data-testid="product-title">
            {product.name}
          </h1>
          <p className="text-muted-foreground text-sm">
            Szczegoly produktu i historia zuzycia
          </p>
        </div>
      </div>

      {/* Low stock warning */}
      {isLowStock && (
        <div
          className="flex items-start gap-3 p-4 mb-6 rounded-lg border border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/30"
          data-testid="low-stock-warning"
        >
          <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-orange-800 dark:text-orange-300">
              Niski stan magazynowy
            </p>
            <p className="text-sm text-orange-700 dark:text-orange-400 mt-1">
              Pozostalo {qty} {product.unit || "szt."} (minimum: {minQty}{" "}
              {product.unit || "szt."})
            </p>
          </div>
        </div>
      )}

      {/* Product info */}
      <Card className="mb-6" data-testid="product-info-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Informacje o produkcie</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Kategoria
              </p>
              <div className="text-sm">
                {product.category ? (
                  <Badge variant="secondary">{product.category}</Badge>
                ) : (
                  <span className="text-muted-foreground italic">Brak</span>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Stan magazynowy
              </p>
              <p
                className={`text-sm font-medium ${isLowStock ? "text-orange-600" : ""}`}
                data-testid="current-stock"
              >
                {qty} {product.unit || "szt."}
                {isLowStock && (
                  <AlertTriangle className="inline h-3.5 w-3.5 ml-1 text-orange-500" />
                )}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Cena za jednostke
              </p>
              <p className="text-sm" data-testid="price-per-unit">
                {product.pricePerUnit
                  ? `${parseFloat(product.pricePerUnit).toFixed(2)} PLN/${product.unit || "szt."}`
                  : "Nie ustawiono"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Min. stan
              </p>
              <p className="text-sm">
                {minQty !== null
                  ? `${minQty} ${product.unit || "szt."}`
                  : "Nie ustawiono"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Usage stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <TrendingDown className="h-6 w-6 mx-auto mb-2 text-primary" />
              <p className="text-2xl font-bold" data-testid="total-used">
                {totalUsed.toFixed(2)}
              </p>
              <p className="text-sm text-muted-foreground">
                Lacznie zuzyto ({product.unit || "szt."})
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <History className="h-6 w-6 mx-auto mb-2 text-primary" />
              <p className="text-2xl font-bold" data-testid="total-records">
                {history.length}
              </p>
              <p className="text-sm text-muted-foreground">
                Liczba wizyt z uzyciem
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <Package className="h-6 w-6 mx-auto mb-2 text-primary" />
              <p className="text-2xl font-bold" data-testid="avg-usage">
                {history.length > 0
                  ? (totalUsed / history.length).toFixed(2)
                  : "0.00"}
              </p>
              <p className="text-sm text-muted-foreground">
                Srednie zuzycie / wizyte ({product.unit || "szt."})
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Usage history */}
      <Card data-testid="usage-history-card">
        <CardHeader>
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Historia zuzycia</CardTitle>
            <Badge variant="secondary" data-testid="history-count">
              {history.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="text-center py-8" data-testid="no-usage-history">
              <History className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground">Brak historii zuzycia</p>
              <p className="text-sm text-muted-foreground mt-1">
                Produkt nie byl jeszcze uzywany podczas wizyt
              </p>
            </div>
          ) : (
            <div className="space-y-3" data-testid="usage-history-list">
              {history.map((record) => {
                const appointmentDate = new Date(record.appointment.startTime);
                const cost =
                  product.pricePerUnit
                    ? (
                        parseFloat(record.quantityUsed) *
                        parseFloat(product.pricePerUnit)
                      ).toFixed(2)
                    : null;

                return (
                  <div
                    key={record.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                    data-testid={`usage-record-${record.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm" data-testid="usage-quantity">
                          {record.quantityUsed} {product.unit || "szt."}
                        </span>
                        {cost && (
                          <span className="text-sm text-muted-foreground">
                            ({cost} PLN)
                          </span>
                        )}
                        <Badge
                          variant={getStatusVariant(record.appointment.status)}
                          className="text-xs"
                        >
                          {getStatusLabel(record.appointment.status)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {appointmentDate.toLocaleDateString("pl-PL", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}{" "}
                          {appointmentDate.toLocaleTimeString("pl-PL", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        {record.appointment.client && (
                          <span className="flex items-center gap-1">
                            <User className="h-3.5 w-3.5" />
                            {record.appointment.client.firstName}{" "}
                            {record.appointment.client.lastName}
                          </span>
                        )}
                        {record.appointment.employee && (
                          <span className="flex items-center gap-1">
                            <User className="h-3.5 w-3.5" />
                            {record.appointment.employee.firstName}{" "}
                            {record.appointment.employee.lastName}
                          </span>
                        )}
                        {record.appointment.service && (
                          <span className="flex items-center gap-1">
                            <Scissors className="h-3.5 w-3.5" />
                            {record.appointment.service.name}
                          </span>
                        )}
                      </div>
                      {record.notes && (
                        <p className="text-xs text-muted-foreground mt-1 italic">
                          {record.notes}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 ml-2"
                      onClick={() =>
                        router.push(
                          `/dashboard/appointments/${record.appointment.id}`
                        )
                      }
                      data-testid={`view-appointment-${record.appointment.id}`}
                    >
                      <ExternalLink className="h-4 w-4 mr-1" />
                      Wizyta
                    </Button>
                  </div>
                );
              })}

              {/* Total summary */}
              <Separator />
              <div className="flex justify-between items-center px-3">
                <span className="font-medium">Lacznie zuzyto:</span>
                <span className="font-bold" data-testid="usage-total">
                  {totalUsed.toFixed(2)} {product.unit || "szt."}
                  {product.pricePerUnit && (
                    <span className="text-muted-foreground font-normal ml-2">
                      (
                      {(totalUsed * parseFloat(product.pricePerUnit)).toFixed(2)}{" "}
                      PLN)
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
