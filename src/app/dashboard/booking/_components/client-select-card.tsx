"use client";

import { Star, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NO_CLIENT } from "../_types";
import type { Client, Employee } from "../_types";

interface ClientSelectCardProps {
  stepNumber: number;
  clients: Client[];
  selectedClientId: string;
  loadingClients: boolean;
  /** Available employees for the selected service (used for favorite hint) */
  availableEmployees?: Employee[];
  onClientChange: (clientId: string) => void;
}

export function ClientSelectCard({
  stepNumber,
  clients,
  selectedClientId,
  loadingClients,
  availableEmployees,
  onClientChange,
}: ClientSelectCardProps) {
  const selectedClient = clients.find((c) => c.id === selectedClientId) ?? null;

  const handleValueChange = (value: string) => {
    const actualClientId = value === NO_CLIENT ? "" : value;
    onClientChange(actualClientId);
  };

  return (
    <Card className="mb-6" data-testid="booking-client-section">
      <CardHeader>
        <div className="flex items-center gap-2">
          <User className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">{stepNumber}. Wybierz klienta</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {loadingClients ? (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : (
          <Select
            value={selectedClientId || NO_CLIENT}
            onValueChange={handleValueChange}
          >
            <SelectTrigger data-testid="booking-client-select">
              <SelectValue placeholder="Wybierz klienta..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CLIENT}>Brak klienta (walk-in)</SelectItem>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.firstName} {client.lastName}
                  {client.phone ? ` (${client.phone})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {selectedClient && selectedClient.favoriteEmployeeId && availableEmployees && (
          <div
            className="flex items-center gap-2 mt-3 p-2 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800"
            data-testid="favorite-employee-hint"
          >
            <Star className="h-4 w-4 text-yellow-500 fill-yellow-500 shrink-0" />
            <span className="text-sm text-yellow-800 dark:text-yellow-300">
              Ten klient ma ulubionego pracownika
              {(() => {
                const favEmp = availableEmployees.find(
                  (e) => e.id === selectedClient.favoriteEmployeeId
                );
                return favEmp
                  ? `: ${favEmp.firstName} ${favEmp.lastName}`
                  : "";
              })()}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
