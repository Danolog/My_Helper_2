"use client";

import { DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CommissionRecord } from "./types";

interface AppointmentCommissionProps {
  commission: CommissionRecord;
}

export function AppointmentCommission({ commission }: AppointmentCommissionProps) {
  return (
    <Card className="mb-6" data-testid="commission-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Prowizja pracownika</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
              Pracownik
            </p>
            <p className="text-sm" data-testid="commission-employee">
              {commission.employee
                ? `${commission.employee.firstName} ${commission.employee.lastName}`
                : "Nieznany"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
              Procent prowizji
            </p>
            <p className="text-sm font-medium" data-testid="commission-percentage">
              {commission.percentage ? `${parseFloat(commission.percentage).toFixed(0)}%` : "N/A"}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
              Kwota prowizji
            </p>
            <p className="text-sm font-bold text-green-600" data-testid="commission-amount">
              {parseFloat(commission.amount).toFixed(2)} PLN
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
