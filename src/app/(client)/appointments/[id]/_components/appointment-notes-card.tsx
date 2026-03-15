"use client";

import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AppointmentNotesCardProps {
  notes: string;
}

export function AppointmentNotesCard({ notes }: AppointmentNotesCardProps) {
  return (
    <Card className="mb-4" data-testid="notes-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="w-5 h-5 text-primary" />
          Notatki
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm">{notes}</p>
      </CardContent>
    </Card>
  );
}
