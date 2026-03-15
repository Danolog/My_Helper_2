"use client";

import {
  ArrowLeft,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AssignedEmployee } from "./types";
import { forwardRef } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EmployeeSelectorProps {
  /** Whether this step is shown (service + variant satisfied) */
  canShow: boolean;
  /** Whether a service has been selected (used for placeholder text) */
  hasSelectedService: boolean;
  /** Whether the service has variants (used for placeholder text) */
  hasVariants: boolean;
  /** Step number to display (varies based on whether variants step exists) */
  stepNumber: number;
  assignedEmployees: AssignedEmployee[];
  loadingEmployees: boolean;
  selectedEmployeeId: string;
  onEmployeeSelect: (empId: string) => void;
  onBackToService: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const EmployeeSelector = forwardRef<HTMLDivElement, EmployeeSelectorProps>(
  function EmployeeSelector(
    {
      canShow,
      hasSelectedService,
      hasVariants,
      stepNumber,
      assignedEmployees,
      loadingEmployees,
      selectedEmployeeId,
      onEmployeeSelect,
      onBackToService,
    },
    ref
  ) {
    return (
      <Card ref={ref} className="mb-6" data-testid="booking-step-employee">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge
                variant={selectedEmployeeId ? "default" : "outline"}
                className="w-6 h-6 rounded-full p-0 flex items-center justify-center text-xs"
              >
                {stepNumber}
              </Badge>
              <Users className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Wybierz pracownika</CardTitle>
              {canShow && assignedEmployees.length > 0 && (
                <Badge variant="outline">
                  {assignedEmployees.length} dostepnych
                </Badge>
              )}
            </div>
            {canShow && (
              <Button variant="ghost" size="sm" onClick={onBackToService}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                Zmien usluge
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!canShow ? (
            <p className="text-muted-foreground text-sm">
              {!hasSelectedService
                ? "Najpierw wybierz usluge."
                : hasVariants
                  ? "Najpierw wybierz wariant uslugi."
                  : "Najpierw wybierz usluge."}
            </p>
          ) : loadingEmployees ? (
            <div className="flex justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : assignedEmployees.length === 0 ? (
            <div className="text-center py-6">
              <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">
                Brak przypisanych pracownikow do tej uslugi.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {assignedEmployees.map((emp) => {
                const isSelected = selectedEmployeeId === emp.id;
                return (
                  <div
                    key={emp.id}
                    className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-primary/10 border-primary"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => onEmployeeSelect(emp.id)}
                    data-testid={`booking-employee-option-${emp.id}`}
                  >
                    {emp.color && (
                      <span
                        className="inline-block w-4 h-4 rounded-full shrink-0"
                        style={{ backgroundColor: emp.color }}
                      />
                    )}
                    <span className="font-medium">
                      {emp.firstName} {emp.lastName}
                    </span>
                    {emp.role === "owner" && (
                      <Badge variant="outline" className="text-xs">
                        wlasciciel
                      </Badge>
                    )}
                    {isSelected && (
                      <Badge variant="default" className="ml-auto text-xs">
                        Wybrany
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }
);
