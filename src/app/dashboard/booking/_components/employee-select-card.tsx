"use client";

import { Users, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Employee } from "../_types";

interface EmployeeSelectCardProps {
  stepNumber: number;
  employees: Employee[];
  selectedEmployeeId: string;
  loadingEmployees: boolean;
  /** Whether a service has been selected (controls the "select service first" message) */
  hasServiceSelected: boolean;
  /** Favorite employee ID for the selected client */
  favoriteEmployeeId: string | null;
  onEmployeeSelect: (empId: string) => void;
}

export function EmployeeSelectCard({
  stepNumber,
  employees,
  selectedEmployeeId,
  loadingEmployees,
  hasServiceSelected,
  favoriteEmployeeId,
  onEmployeeSelect,
}: EmployeeSelectCardProps) {
  return (
    <Card className="mb-6" data-testid="booking-employee-section">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">{stepNumber}. Wybierz pracownika</CardTitle>
          {hasServiceSelected && (
            <Badge variant="outline" data-testid="available-employees-count">
              {employees.length} dostepnych
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!hasServiceSelected ? (
          <p className="text-muted-foreground text-sm" data-testid="select-service-first-message">
            Najpierw wybierz usluge, aby zobaczyc dostepnych pracownikow.
          </p>
        ) : loadingEmployees ? (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : employees.length === 0 ? (
          <div className="text-center py-6">
            <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground text-sm" data-testid="no-employees-for-service-message">
              Brak przypisanych pracownikow do tej uslugi.
              Przypisz pracownikow w ustawieniach uslugi.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {employees.map((emp) => {
              const isFavorite = favoriteEmployeeId === emp.id;
              return (
                <div
                  key={emp.id}
                  className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedEmployeeId === emp.id
                      ? "bg-primary/10 border-primary"
                      : isFavorite
                        ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 hover:bg-yellow-100 dark:hover:bg-yellow-900/30"
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
                  {isFavorite && (
                    <Badge
                      variant="secondary"
                      className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"
                      data-testid={`favorite-employee-badge-${emp.id}`}
                    >
                      <Star className="h-3 w-3 mr-1 fill-yellow-500 text-yellow-500" />
                      Ulubiony
                    </Badge>
                  )}
                  {emp.role === "owner" && (
                    <Badge variant="outline" className="text-xs">
                      wlasciciel
                    </Badge>
                  )}
                  {selectedEmployeeId === emp.id && (
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
