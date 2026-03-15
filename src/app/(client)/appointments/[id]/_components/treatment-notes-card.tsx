"use client";

import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TreatmentInfo } from "../_types";

interface TreatmentNotesCardProps {
  treatment: TreatmentInfo;
}

export function TreatmentNotesCard({ treatment }: TreatmentNotesCardProps) {
  return (
    <Card className="mb-4" data-testid="treatment-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="w-5 h-5 text-primary" />
          Notatki z zabiegu
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {treatment.recipe && (
          <div className="text-sm">
            <span className="text-muted-foreground font-medium">
              Receptura:{" "}
            </span>
            <span>{treatment.recipe}</span>
          </div>
        )}
        {treatment.techniques && (
          <div className="text-sm">
            <span className="text-muted-foreground font-medium">
              Techniki:{" "}
            </span>
            <span>{treatment.techniques}</span>
          </div>
        )}
        {treatment.notes && (
          <div className="text-sm">
            <span className="text-muted-foreground font-medium">
              Uwagi:{" "}
            </span>
            <span>{treatment.notes}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
