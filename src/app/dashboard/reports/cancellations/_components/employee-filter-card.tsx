"use client";

import { Card, CardContent } from "@/components/ui/card";
import { EmployeeFilter } from "@/components/reports/employee-filter";

interface EmployeeFilterCardProps {
  selectedEmployeeIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export function EmployeeFilterCard({
  selectedEmployeeIds,
  onSelectionChange,
}: EmployeeFilterCardProps) {
  return (
    <Card className="mb-6">
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
            Filtruj wg pracownika:
          </span>
          <EmployeeFilter
            selectedEmployeeIds={selectedEmployeeIds}
            onSelectionChange={onSelectionChange}
          />
        </div>
        {selectedEmployeeIds.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            Raport pokazuje dane tylko dla wybranych pracownikow.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
