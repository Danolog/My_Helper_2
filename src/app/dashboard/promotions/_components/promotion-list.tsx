"use client";

import { Tag, Plus } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { Promotion, Service } from "../_types";
import { PromotionCard } from "./promotion-card";

interface PromotionListProps {
  promotionsList: Promotion[];
  servicesList: Service[];
  loading: boolean;
  onCreateNew: () => void;
  onEdit: (promo: Promotion) => void;
  onDelete: (promo: Promotion) => void;
  onToggleActive: (promo: Promotion) => void;
}

export function PromotionList({
  promotionsList,
  servicesList,
  loading,
  onCreateNew,
  onEdit,
  onDelete,
  onToggleActive,
}: PromotionListProps) {
  if (loading) {
    return (
      <div className="text-center py-12 text-muted-foreground">Ladowanie promocji...</div>
    );
  }

  if (promotionsList.length === 0) {
    return (
      <EmptyState
        icon={Tag}
        title="Brak promocji"
        description="Utworz pierwsza promocje, aby przyciagnac klientow."
        action={{
          label: "Utworz promocje",
          icon: Plus,
          onClick: onCreateNew,
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {promotionsList.map((promo) => (
        <PromotionCard
          key={promo.id}
          promo={promo}
          servicesList={servicesList}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleActive={onToggleActive}
        />
      ))}
    </div>
  );
}
