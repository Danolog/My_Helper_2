"use client";

import { FolderOpen, Scissors, Plus } from "lucide-react";
import { NetworkErrorHandler } from "@/components/network-error-handler";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ServiceCard } from "./service-card";
import type { Service, ServiceCategory, ServiceGroup } from "../_types";

interface ServicesTabProps {
  services: Service[];
  categories: ServiceCategory[];
  groupedServices: ServiceGroup[];
  loading: boolean;
  fetchError: { message: string; isNetwork: boolean; isTimeout: boolean } | null;
  onRetry: () => Promise<void>;
  onOpenAddDialog: () => void;
  onAssignCategory: (serviceId: string, categoryId: string | null) => Promise<void>;
  onDeleteService: (service: Service) => void;
}

export function ServicesTab({
  services,
  categories,
  groupedServices,
  loading,
  fetchError,
  onRetry,
  onOpenAddDialog,
  onAssignCategory,
  onDeleteService,
}: ServicesTabProps) {
  if (fetchError) {
    return (
      <NetworkErrorHandler
        message={fetchError.message}
        isNetworkError={fetchError.isNetwork}
        isTimeout={fetchError.isTimeout}
        onRetry={onRetry}
        isRetrying={loading}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <EmptyState
        icon={Scissors}
        title="Brak uslug"
        description="Dodaj pierwsza usluge, aby rozpoczac."
        action={{
          label: "Dodaj usluge",
          icon: Plus,
          onClick: onOpenAddDialog,
          "data-testid": "empty-state-add-btn",
        }}
      />
    );
  }

  // Grouped by category view (when categories exist)
  if (categories.length > 0) {
    return (
      <div className="space-y-6">
        {groupedServices.map((group) => (
          <div key={group.category?.id || "uncategorized"}>
            <div className="flex items-center gap-2 mb-3">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold" data-testid={`category-group-${group.category?.id || "uncategorized"}`}>
                {group.category?.name || "Bez kategorii"}
              </h2>
              <Badge variant="secondary" className="text-xs">
                {group.services.length}
              </Badge>
            </div>
            {group.services.length > 0 ? (
              <div className="space-y-3 ml-2">
                {group.services.map((service) => (
                  <ServiceCard
                    key={service.id}
                    service={service}
                    categories={categories}
                    onAssignCategory={onAssignCategory}
                    onDelete={onDeleteService}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground ml-6 mb-4">
                Brak uslug w tej kategorii
              </p>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Flat view when no categories exist
  return (
    <div className="space-y-3">
      {services.map((service) => (
        <ServiceCard
          key={service.id}
          service={service}
          categories={categories}
          onAssignCategory={onAssignCategory}
          onDelete={onDeleteService}
        />
      ))}
    </div>
  );
}
