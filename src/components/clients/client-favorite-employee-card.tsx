"use client";

import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NO_FAVORITE } from "./utils";
import type { Employee } from "./types";

interface ClientFavoriteEmployeeCardProps {
  employees: Employee[];
  selectedFavoriteEmployeeId: string;
  onFavoriteEmployeeChange: (value: string) => void;
}

/**
 * Card for selecting and displaying the client's favorite employee.
 */
export function ClientFavoriteEmployeeCard({
  employees,
  selectedFavoriteEmployeeId,
  onFavoriteEmployeeChange,
}: ClientFavoriteEmployeeCardProps) {
  return (
    <Card className="mb-6" data-testid="favorite-employee-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Star className="h-5 w-5 text-yellow-500" />
          <CardTitle className="text-lg">Ulubiony pracownik</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <Label className="text-sm text-muted-foreground">
            Wybierz ulubionego pracownika klienta
          </Label>
          <Select
            value={selectedFavoriteEmployeeId || NO_FAVORITE}
            onValueChange={(value) =>
              onFavoriteEmployeeChange(value === NO_FAVORITE ? "" : value)
            }
          >
            <SelectTrigger className="w-full max-w-sm" data-testid="favorite-employee-select">
              <SelectValue placeholder="Wybierz pracownika" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_FAVORITE}>Brak ulubionego pracownika</SelectItem>
              {employees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.firstName} {employee.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedFavoriteEmployeeId && (() => {
            const favEmployee = employees.find((e) => e.id === selectedFavoriteEmployeeId);
            if (!favEmployee) return null;
            return (
              <div className="flex items-center gap-2 mt-2">
                <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                <Badge
                  variant="secondary"
                  className="px-3 py-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300"
                >
                  {favEmployee.firstName} {favEmployee.lastName}
                </Badge>
              </div>
            );
          })()}
        </div>
      </CardContent>
    </Card>
  );
}
