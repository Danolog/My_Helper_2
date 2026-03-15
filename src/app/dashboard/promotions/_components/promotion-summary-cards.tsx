"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Tag, Percent, Calendar } from "lucide-react";
import type { Promotion } from "../_types";
import { isExpired } from "../_types";

interface PromotionSummaryCardsProps {
  promotionsList: Promotion[];
}

export function PromotionSummaryCards({ promotionsList }: PromotionSummaryCardsProps) {
  const activePromotions = promotionsList.filter((p) => p.isActive && !isExpired(p.endDate));
  const inactivePromotions = promotionsList.filter((p) => !p.isActive || isExpired(p.endDate));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Wszystkie promocje</p>
              <p className="text-2xl font-bold">{promotionsList.length}</p>
            </div>
            <Tag className="w-8 h-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Aktywne</p>
              <p className="text-2xl font-bold text-green-600">{activePromotions.length}</p>
            </div>
            <Percent className="w-8 h-8 text-green-600" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Nieaktywne / Wygasle</p>
              <p className="text-2xl font-bold text-gray-400">{inactivePromotions.length}</p>
            </div>
            <Calendar className="w-8 h-8 text-gray-400" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
