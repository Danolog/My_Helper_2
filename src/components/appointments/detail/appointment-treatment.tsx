"use client";

import { ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TreatmentRecord } from "./types";

interface AppointmentTreatmentProps {
  treatment: TreatmentRecord;
}

export function AppointmentTreatment({ treatment }: AppointmentTreatmentProps) {
  return (
    <Card className="mb-6" data-testid="treatment-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Notatki z zabiegu</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {treatment.recipe && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Receptura
              </p>
              <p className="text-sm" data-testid="treatment-recipe">{treatment.recipe}</p>
            </div>
          )}
          {treatment.techniques && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Techniki
              </p>
              <p className="text-sm" data-testid="treatment-techniques">{treatment.techniques}</p>
            </div>
          )}
          {treatment.notes && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                Notatki dodatkowe
              </p>
              <p className="text-sm" data-testid="treatment-notes">{treatment.notes}</p>
            </div>
          )}
          {!treatment.recipe && !treatment.techniques && !treatment.notes && (
            <p className="text-sm text-muted-foreground italic">
              Brak notatek z zabiegu
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
