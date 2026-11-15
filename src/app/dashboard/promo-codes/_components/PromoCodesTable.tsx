"use client";

import { Tag, Edit, Trash2, Calendar, Copy, Plus, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isPromotionTypeFrozen } from "@/lib/features";
import { TYPE_LABELS, formatDate, isExpired, formatPromotionValue } from "../_types";
import type { PromoCode } from "../_types";

interface PromoCodesTableProps {
  codesList: PromoCode[];
  loading: boolean;
  onCreateClick: () => void;
  onEditClick: (code: PromoCode) => void;
  onDeleteClick: (code: PromoCode) => void;
  onCopyClick: (code: string) => void;
}

export function PromoCodesTable({
  codesList,
  loading,
  onCreateClick,
  onEditClick,
  onDeleteClick,
  onCopyClick,
}: PromoCodesTableProps) {
  if (loading) {
    return (
      <p className="text-center text-muted-foreground py-8">
        Ladowanie kodow promocyjnych...
      </p>
    );
  }

  if (codesList.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed rounded-lg">
        <Ticket className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <h3 className="text-lg font-semibold mb-2">Brak kodow promocyjnych</h3>
        <p className="text-muted-foreground mb-4">
          Utworz pierwszy kod promocyjny dla swoich klientow
        </p>
        <Button onClick={onCreateClick}>
          <Plus className="w-4 h-4 mr-2" />
          Generuj kod
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {codesList.map((promoCode) => {
        const expired = isExpired(promoCode.expiresAt);
        const usedUp =
          promoCode.usageLimit != null &&
          (promoCode.usedCount ?? 0) >= promoCode.usageLimit;
        // Kod powiązany z zamrożonym typem promocji nie daje rabatu (validate odrzuca).
        const promotionFrozen =
          promoCode.promotion != null && isPromotionTypeFrozen(promoCode.promotion.type);
        const isInactive = expired || usedUp || promotionFrozen;

        return (
          <Card
            key={promoCode.id}
            className={isInactive ? "opacity-60" : ""}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-primary" />
                  <CardTitle className="text-lg font-mono tracking-wider">
                    {promoCode.code}
                  </CardTitle>
                </div>
                <div className="flex gap-1">
                  {expired && (
                    <Badge variant="secondary">Wygasly</Badge>
                  )}
                  {usedUp && (
                    <Badge variant="secondary">Wykorzystany</Badge>
                  )}
                  {!isInactive && (
                    <Badge className="bg-green-100 text-green-800">
                      Aktywny
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {/* Linked promotion */}
                {promoCode.promotion && promotionFrozen ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Promocja:</span>
                      <span className="font-medium">
                        {promoCode.promotion.name}
                      </span>
                      <Badge variant="destructive" className="text-xs">
                        Promocja niedostępna
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Ten kod nie daje rabatu. Powiąż go z rabatem procentowym lub kwotowym.
                    </p>
                  </div>
                ) : promoCode.promotion ? (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Promocja:</span>
                    <span className="font-medium">
                      {promoCode.promotion.name}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {TYPE_LABELS[promoCode.promotion.type] || promoCode.promotion.type}
                      {" "}
                      {formatPromotionValue(promoCode.promotion.type, promoCode.promotion.value)}
                    </Badge>
                  </div>
                ) : (
                  <div className="text-muted-foreground">
                    Brak powiazanej promocji
                  </div>
                )}

                {/* Usage */}
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Uzycia:</span>
                  <span className="font-medium">
                    {promoCode.usedCount ?? 0}
                    {promoCode.usageLimit != null
                      ? ` / ${promoCode.usageLimit}`
                      : " (bez limitu)"}
                  </span>
                </div>

                {/* Expiry */}
                <div className="flex items-center gap-2">
                  <Calendar className="w-3 h-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Wygasa:</span>
                  <span className="font-medium">
                    {promoCode.expiresAt
                      ? formatDate(promoCode.expiresAt)
                      : "Bez terminu"}
                  </span>
                </div>

                {/* Created at */}
                <div className="text-xs text-muted-foreground">
                  Utworzony: {formatDate(promoCode.createdAt)}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCopyClick(promoCode.code)}
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Kopiuj
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEditClick(promoCode)}
                >
                  <Edit className="w-3 h-3 mr-1" />
                  Edytuj
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onDeleteClick(promoCode)}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
