"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { Product, ProductCategory } from "../_types";

interface ProductStatsProps {
  productsData: Product[];
  categories: ProductCategory[];
  lowStockProducts: Product[];
}

export function ProductStats({
  productsData,
  categories,
  lowStockProducts,
}: ProductStatsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <p
              className="text-2xl font-bold"
              data-testid="total-products-count"
            >
              {productsData.length}
            </p>
            <p className="text-sm text-muted-foreground">Produktow lacznie</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-2xl font-bold">{categories.length}</p>
            <p className="text-sm text-muted-foreground">Kategorii</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <p
              className="text-2xl font-bold text-orange-600"
              data-testid="low-stock-count"
            >
              {lowStockProducts.length}
            </p>
            <p className="text-sm text-muted-foreground">Niski stan</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
