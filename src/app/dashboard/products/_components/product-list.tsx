"use client";

import { Package } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { Product } from "../_types";
import { ProductCard } from "./product-card";

interface ProductListProps {
  filteredProducts: Product[];
  totalCount: number;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
}

export function ProductList({
  filteredProducts,
  totalCount,
  onEdit,
  onDelete,
}: ProductListProps) {
  if (filteredProducts.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title={totalCount === 0 ? "Brak produktow" : "Brak wynikow"}
        description={
          totalCount === 0
            ? "Dodaj pierwszy produkt do magazynu."
            : "Zmien kryteria wyszukiwania."
        }
      />
    );
  }

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      data-testid="products-grid"
    >
      {filteredProducts.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
