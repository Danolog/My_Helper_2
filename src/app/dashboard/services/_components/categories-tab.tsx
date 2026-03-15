"use client";

import { FolderOpen, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ServiceCategory } from "../_types";

interface CategoriesTabProps {
  categories: ServiceCategory[];
  getServiceCountForCategory: (categoryId: string) => number;
  onAddCategory: () => void;
  onEditCategory: (category: ServiceCategory) => void;
  onDeleteCategory: (category: ServiceCategory) => void;
}

export function CategoriesTab({
  categories,
  getServiceCountForCategory,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
}: CategoriesTabProps) {
  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">
          Zarzadzaj kategoriami uslug salonu
        </p>
        <Button
          onClick={onAddCategory}
          data-testid="add-category-btn"
        >
          <Plus className="h-4 w-4 mr-2" />
          Dodaj kategorie
        </Button>
      </div>

      {categories.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FolderOpen className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              Brak kategorii. Dodaj pierwsza kategorie, aby organizowac uslugi.
            </p>
            <Button
              onClick={onAddCategory}
              data-testid="empty-state-add-category-btn"
            >
              <Plus className="h-4 w-4 mr-2" />
              Dodaj kategorie
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {categories.map((category) => {
            const serviceCount = getServiceCountForCategory(category.id);
            return (
              <Card
                key={category.id}
                data-testid={`category-card-${category.id}`}
              >
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <FolderOpen className="h-5 w-5 text-primary" />
                    <div>
                      <span className="font-medium" data-testid={`category-name-${category.id}`}>
                        {category.name}
                      </span>
                      <p className="text-sm text-muted-foreground">
                        {serviceCount === 0
                          ? "Brak uslug"
                          : serviceCount === 1
                          ? "1 usluga"
                          : `${serviceCount} uslug`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onEditCategory(category)}
                      data-testid={`edit-category-${category.id}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onDeleteCategory(category)}
                      data-testid={`delete-category-${category.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
