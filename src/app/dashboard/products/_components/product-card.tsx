"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, AlertTriangle, History } from "lucide-react";
import type { Product } from "../_types";

interface ProductCardProps {
  product: Product;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
}

export function ProductCard({ product, onEdit, onDelete }: ProductCardProps) {
  const router = useRouter();

  const qty = parseFloat(product.quantity || "0");
  const minQty = product.minQuantity ? parseFloat(product.minQuantity) : null;
  const isLowStock = minQty !== null && qty <= minQty;

  return (
    <Card
      className={`relative ${isLowStock ? "border-orange-300 dark:border-orange-700" : ""}`}
      data-testid={`product-card-${product.id}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle
              className="text-base truncate cursor-pointer hover:text-primary transition-colors"
              onClick={() =>
                router.push(`/dashboard/products/${product.id}`)
              }
              data-testid="product-name"
            >
              {product.name}
            </CardTitle>
            {product.category && (
              <Badge variant="secondary" className="mt-1 text-xs">
                {product.category}
              </Badge>
            )}
          </div>
          <div className="flex gap-1 shrink-0 ml-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onEdit(product)}
              data-testid={`edit-product-${product.id}`}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => onDelete(product)}
              data-testid={`delete-product-${product.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Stan:</span>
            <span
              className={`text-sm font-medium ${isLowStock ? "text-orange-600" : ""}`}
              data-testid="product-quantity"
            >
              {qty} {product.unit || "szt."}
              {isLowStock && (
                <AlertTriangle className="inline h-3.5 w-3.5 ml-1 text-orange-500" />
              )}
            </span>
          </div>
          {minQty !== null && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Min. stan:</span>
              <span className="text-sm">
                {minQty} {product.unit || "szt."}
              </span>
            </div>
          )}
          {product.pricePerUnit && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">
                Cena/jedn.:
              </span>
              <span className="text-sm">
                {parseFloat(product.pricePerUnit).toFixed(2)} PLN
              </span>
            </div>
          )}
          <div className="pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground hover:text-primary"
              onClick={() =>
                router.push(`/dashboard/products/${product.id}`)
              }
              data-testid={`usage-history-${product.id}`}
            >
              <History className="h-3.5 w-3.5 mr-1" />
              Historia zuzycia
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
