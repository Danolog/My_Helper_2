"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Package, Trash2 } from "lucide-react";
import type { Product, ServiceProductLink } from "../_types";

interface LinkedProductsCardProps {
  serviceProductLinks: ServiceProductLink[];
  allProducts: Product[];
  productLinkDialogOpen: boolean;
  setProductLinkDialogOpen: (open: boolean) => void;
  productLinkProductId: string;
  setProductLinkProductId: (value: string) => void;
  productLinkQuantity: string;
  setProductLinkQuantity: (value: string) => void;
  savingProductLink: boolean;
  resetProductLinkForm: () => void;
  handleSaveProductLink: () => Promise<void>;
  handleDeleteProductLink: (link: ServiceProductLink) => Promise<void>;
}

export function LinkedProductsCard({
  serviceProductLinks,
  allProducts,
  productLinkDialogOpen,
  setProductLinkDialogOpen,
  productLinkProductId,
  setProductLinkProductId,
  productLinkQuantity,
  setProductLinkQuantity,
  savingProductLink,
  resetProductLinkForm,
  handleSaveProductLink,
  handleDeleteProductLink,
}: LinkedProductsCardProps) {
  return (
    <Card className="mt-6" data-testid="service-products-section">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Powiazane produkty</CardTitle>
          <Badge variant="outline" data-testid="service-products-count">
            {serviceProductLinks.length}
          </Badge>
        </div>
        <Dialog
          open={productLinkDialogOpen}
          onOpenChange={(open) => {
            setProductLinkDialogOpen(open);
            if (!open) resetProductLinkForm();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" data-testid="add-product-link-btn">
              <Plus className="h-4 w-4 mr-2" />
              Dodaj produkt
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[450px]">
            <DialogHeader>
              <DialogTitle>Powiaz produkt z usluga</DialogTitle>
              <DialogDescription>
                Po zakonczeniu wizyty z ta usluga, powiazane produkty zostana
                automatycznie odliczone z magazynu o podana ilosc.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="product-link-product">Produkt *</Label>
                <Select
                  value={productLinkProductId}
                  onValueChange={setProductLinkProductId}
                >
                  <SelectTrigger
                    id="product-link-product"
                    data-testid="product-link-select"
                  >
                    <SelectValue placeholder="Wybierz produkt" />
                  </SelectTrigger>
                  <SelectContent>
                    {allProducts.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        Brak produktow w magazynie
                      </SelectItem>
                    ) : (
                      allProducts.map((prod) => (
                        <SelectItem key={prod.id} value={prod.id}>
                          <div className="flex items-center gap-2">
                            <span>{prod.name}</span>
                            {prod.unit && (
                              <span className="text-xs text-muted-foreground">
                                ({prod.unit})
                              </span>
                            )}
                            {prod.category && (
                              <span className="text-xs text-muted-foreground">
                                [{prod.category}]
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="product-link-quantity">
                  Ilosc do odliczenia *
                </Label>
                <Input
                  id="product-link-quantity"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="1"
                  value={productLinkQuantity}
                  onChange={(e) => setProductLinkQuantity(e.target.value)}
                  data-testid="product-link-quantity-input"
                />
                <p className="text-xs text-muted-foreground">
                  Ile jednostek produktu zostanie automatycznie odliczone z
                  magazynu po zakonczeniu wizyty.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  resetProductLinkForm();
                  setProductLinkDialogOpen(false);
                }}
              >
                Anuluj
              </Button>
              <Button
                onClick={handleSaveProductLink}
                disabled={savingProductLink}
                data-testid="save-product-link-btn"
              >
                {savingProductLink ? "Zapisywanie..." : "Powiaz produkt"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Produkty powiazane z usluga sa automatycznie odliczane z magazynu po
          zakonczeniu wizyty.
        </p>
        {serviceProductLinks.length === 0 ? (
          <div className="text-center py-8">
            <Package className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p
              className="text-muted-foreground mb-4"
              data-testid="no-product-links-message"
            >
              Brak powiazanych produktow. Dodaj produkty, ktore beda
              automatycznie odliczane z magazynu po zakonczeniu wizyty z ta
              usluga.
            </p>
            <Button
              variant="outline"
              onClick={() => setProductLinkDialogOpen(true)}
              data-testid="empty-state-add-product-link-btn"
            >
              <Plus className="h-4 w-4 mr-2" />
              Powiaz pierwszy produkt
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {serviceProductLinks.map((link) => {
              const currentQty = parseFloat(link.productQuantity || "0");
              const deductQty = parseFloat(link.defaultQuantity || "0");
              const minQty = link.productMinQuantity
                ? parseFloat(link.productMinQuantity)
                : null;
              const isLowStock = minQty !== null && currentQty <= minQty;

              return (
                <div
                  key={link.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  data-testid={`product-link-card-${link.id}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <span
                        className="font-medium"
                        data-testid={`product-link-name-${link.id}`}
                      >
                        {link.productName || "Usuniety produkt"}
                      </span>
                      {link.productCategory && (
                        <Badge variant="outline" className="text-xs">
                          {link.productCategory}
                        </Badge>
                      )}
                      {isLowStock && (
                        <Badge variant="destructive" className="text-xs">
                          Niski stan
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span data-testid={`product-link-deduct-${link.id}`}>
                        Odliczenie:{" "}
                        <span className="font-medium text-foreground">
                          {deductQty}
                        </span>{" "}
                        {link.productUnit || "szt."} / wizyta
                      </span>
                      <span data-testid={`product-link-stock-${link.id}`}>
                        Stan:{" "}
                        <span
                          className={`font-medium ${isLowStock ? "text-destructive" : "text-foreground"}`}
                        >
                          {currentQty}
                        </span>{" "}
                        {link.productUnit || "szt."}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteProductLink(link)}
                      data-testid={`delete-product-link-${link.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
