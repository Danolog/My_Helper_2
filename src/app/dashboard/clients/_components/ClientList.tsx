"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Phone,
  Mail,
  Search,
  UserPlus,
  StickyNote,
  AlertTriangle,
  Filter,
  X,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { NetworkErrorHandler } from "@/components/network-error-handler";
import { EmptyState } from "@/components/ui/empty-state";
import type { Client } from "../_types";

/** Format a date string to Polish locale dd.MM.yyyy */
function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

interface ClientListProps {
  clients: Client[];
  filteredClients: Client[];
  loading: boolean;
  fetchError: { message: string; isNetwork: boolean; isTimeout: boolean } | null;
  hasActiveFilters: boolean;
  searchQuery: string;

  // Actions
  onRetry: () => Promise<void>;
  onAddClient: () => void;
  onClearFilters: () => void;
}

export function ClientList({
  clients,
  filteredClients,
  loading,
  fetchError,
  hasActiveFilters,
  searchQuery,
  onRetry,
  onAddClient,
  onClearFilters,
}: ClientListProps) {
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

  if (clients.length === 0 && !hasActiveFilters) {
    return (
      <EmptyState
        icon={UserPlus}
        title="Brak klientow"
        description="Dodaj pierwszego klienta, aby rozpoczac."
        action={{
          label: "Dodaj klienta",
          icon: Plus,
          onClick: onAddClient,
          "data-testid": "empty-state-add-client-btn",
        }}
      />
    );
  }

  if (clients.length === 0 && hasActiveFilters) {
    return (
      <EmptyState
        icon={Filter}
        title="Brak wynikow"
        description="Brak klientow pasujacych do wybranych filtrow."
        action={{
          label: "Wyczysc filtry",
          icon: X,
          onClick: onClearFilters,
          variant: "outline",
        }}
      />
    );
  }

  if (filteredClients.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="Brak wynikow wyszukiwania"
        description={`Nie znaleziono klientow pasujacych do "${searchQuery}"`}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground mb-2" data-testid="clients-count-text">
        {hasActiveFilters
          ? `Wyniki filtrowania: ${filteredClients.length} klientow`
          : filteredClients.length === clients.length
            ? `Liczba klientow: ${clients.length}`
            : `Wyniki wyszukiwania: ${filteredClients.length} z ${clients.length}`}
      </p>
      {filteredClients.map((client) => {
        const clientAllergies = client.allergies
          ? client.allergies
              .split(",")
              .map((a) => a.trim())
              .filter((a) => a.length > 0)
          : [];
        const hasAllergies = clientAllergies.length > 0;
        const lastVisitFormatted = formatDate(client.lastVisit);
        const createdAtFormatted = formatDate(client.createdAt);

        return (
          <Link
            key={client.id}
            href={`/dashboard/clients/${client.id}`}
            className="block"
            data-testid={`client-link-${client.id}`}
          >
            <Card
              className="hover:shadow-md transition-shadow cursor-pointer"
              data-testid={`client-card-${client.id}`}
            >
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-base" data-testid={`client-name-${client.id}`}>
                      {client.firstName} {client.lastName}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      Klient
                    </Badge>
                    {hasAllergies && (
                      <AlertTriangle
                        className="h-4 w-4 text-orange-500"
                        data-testid={`client-allergy-icon-${client.id}`}
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                    {client.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" />
                        {client.phone}
                      </span>
                    )}
                    {client.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="h-3.5 w-3.5" />
                        {client.email}
                      </span>
                    )}
                    {client.notes && (
                      <span className="flex items-center gap-1">
                        <StickyNote className="h-3.5 w-3.5" />
                        {client.notes.length > 50
                          ? client.notes.substring(0, 50) + "..."
                          : client.notes}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    {createdAtFormatted && (
                      <span data-testid={`client-created-${client.id}`}>
                        Dodano: {createdAtFormatted}
                      </span>
                    )}
                    {lastVisitFormatted && (
                      <span data-testid={`client-last-visit-${client.id}`}>
                        Ostatnia wizyta: {lastVisitFormatted}
                      </span>
                    )}
                  </div>
                  {hasAllergies && (
                    <div
                      className="flex flex-wrap items-center gap-1.5 mt-2"
                      data-testid={`client-allergies-${client.id}`}
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                      {clientAllergies.map((allergy, idx) => (
                        <Badge
                          key={`${allergy}-${idx}`}
                          variant="destructive"
                          className="text-xs"
                        >
                          {allergy}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
