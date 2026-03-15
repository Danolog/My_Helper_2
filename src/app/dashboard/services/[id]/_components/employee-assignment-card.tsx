"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import type { Employee } from "../_types";

interface EmployeeAssignmentCardProps {
  serviceId: string;
  allEmployees: Employee[];
  assignedEmployeeIds: Set<string>;
  setAssignedEmployeeIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function EmployeeAssignmentCard({
  serviceId,
  allEmployees,
  assignedEmployeeIds,
  setAssignedEmployeeIds,
}: EmployeeAssignmentCardProps) {
  const [togglingAssignment, setTogglingAssignment] = useState<string | null>(
    null,
  );

  const handleToggleEmployeeAssignment = async (
    employeeId: string,
    isCurrentlyAssigned: boolean,
  ) => {
    setTogglingAssignment(employeeId);
    try {
      if (isCurrentlyAssigned) {
        // Unassign
        const res = await mutationFetch(
          `/api/services/${serviceId}/employee-assignments?employeeId=${employeeId}`,
          { method: "DELETE" },
        );
        const data = await res.json();
        if (data.success) {
          setAssignedEmployeeIds((prev) => {
            const next = new Set(prev);
            next.delete(employeeId);
            return next;
          });
          const emp = allEmployees.find((e) => e.id === employeeId);
          toast.success(
            `${emp ? `${emp.firstName} ${emp.lastName}` : "Pracownik"} odlaczony od uslugi`,
          );
        } else {
          toast.error(data.error || "Nie udalo sie odlaczyc pracownika");
        }
      } else {
        // Assign
        const res = await mutationFetch(
          `/api/services/${serviceId}/employee-assignments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ employeeId }),
          },
        );
        const data = await res.json();
        if (data.success) {
          setAssignedEmployeeIds((prev) => new Set([...prev, employeeId]));
          const emp = allEmployees.find((e) => e.id === employeeId);
          toast.success(
            `${emp ? `${emp.firstName} ${emp.lastName}` : "Pracownik"} przypisany do uslugi`,
          );
        } else {
          toast.error(
            data.error || "Nie udalo sie przypisac pracownika",
          );
        }
      }
    } catch {
      toast.error("Blad podczas zmiany przypisania pracownika");
    } finally {
      setTogglingAssignment(null);
    }
  };

  return (
    <Card className="mb-6" data-testid="employee-assignment-section">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Przypisani pracownicy</CardTitle>
          <Badge variant="outline" data-testid="assigned-employees-count">
            {assignedEmployeeIds.size}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Zaznacz pracownikow, ktorzy oferuja ta usluge. Tylko przypisani
          pracownicy beda dostepni podczas rezerwacji.
        </p>
      </CardHeader>
      <CardContent>
        {allEmployees.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p
              className="text-muted-foreground"
              data-testid="no-employees-message"
            >
              Brak pracownikow w salonie. Dodaj pracownikow, aby moc ich
              przypisac do uslug.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {allEmployees.map((emp) => {
              const isAssigned = assignedEmployeeIds.has(emp.id);
              const isToggling = togglingAssignment === emp.id;
              return (
                <div
                  key={emp.id}
                  className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${
                    isAssigned
                      ? "bg-primary/5 border-primary/30"
                      : "hover:bg-muted/50"
                  } ${isToggling ? "opacity-60" : ""}`}
                  data-testid={`employee-assignment-${emp.id}`}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id={`assign-emp-${emp.id}`}
                      checked={isAssigned}
                      disabled={isToggling}
                      onCheckedChange={() =>
                        handleToggleEmployeeAssignment(emp.id, isAssigned)
                      }
                      data-testid={`assign-checkbox-${emp.id}`}
                    />
                    <label
                      htmlFor={`assign-emp-${emp.id}`}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      {emp.color && (
                        <span
                          className="inline-block w-3 h-3 rounded-full"
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
                    </label>
                  </div>
                  <div>
                    {isAssigned && (
                      <Badge
                        variant="default"
                        className="text-xs"
                        data-testid={`assigned-badge-${emp.id}`}
                      >
                        Przypisany
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
