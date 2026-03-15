"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Edit, Trash2, Tag, FolderOpen } from "lucide-react";
import type { ProductCategory } from "../_types";

interface CategoriesTabProps {
  categories: ProductCategory[];
  categoriesLoading: boolean;
  onAddCategory: () => void;
  onEditCategory: (category: ProductCategory) => void;
  onDeleteCategory: (category: ProductCategory) => void;
}

export function CategoriesTab({
  categories,
  categoriesLoading,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
}: CategoriesTabProps) {
  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2
            className="text-lg font-semibold"
            data-testid="categories-title"
          >
            Kategorie produktow
          </h2>
          <p className="text-sm text-muted-foreground">
            Organizuj produkty wedlug typow
          </p>
        </div>
        <Button onClick={onAddCategory} data-testid="add-category-btn">
          <Plus className="h-4 w-4 mr-2" />
          Dodaj kategorie
        </Button>
      </div>

      {categoriesLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : categories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FolderOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-muted-foreground text-lg font-medium">
              Brak kategorii
            </p>
            <p className="text-muted-foreground text-sm mt-1">
              Dodaj pierwsza kategorie, aby organizowac produkty
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="categories-list">
          {categories.map((category) => (
            <Card
              key={category.id}
              data-testid={`category-card-${category.id}`}
            >
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Tag className="h-5 w-5 text-primary shrink-0" />
                    <div>
                      <p
                        className="font-medium"
                        data-testid={`category-name-${category.id}`}
                      >
                        {category.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {category.productCount === 0
                          ? "Brak produktow"
                          : `${category.productCount} ${category.productCount === 1 ? "produkt" : category.productCount < 5 ? "produkty" : "produktow"}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onEditCategory(category)}
                      data-testid={`edit-category-${category.id}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => onDeleteCategory(category)}
                      disabled={category.productCount > 0}
                      title={
                        category.productCount > 0
                          ? "Nie mozna usunac kategorii z produktami"
                          : "Usun kategorie"
                      }
                      data-testid={`delete-category-${category.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
