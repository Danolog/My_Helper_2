"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, X, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
}

interface EmployeeFilterProps {
  selectedEmployeeIds: string[];
  onSelectionChange: (ids: string[]) => void;
}

export function EmployeeFilter({
  selectedEmployeeIds,
  onSelectionChange,
}: EmployeeFilterProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/employees?salonId=${DEMO_SALON_ID}&activeOnly=true`
      );
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setEmployees(json.data || []);
        }
      }
    } catch (err) {
      console.error("[EmployeeFilter] Failed to fetch employees:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const toggleEmployee = (employeeId: string) => {
    if (selectedEmployeeIds.includes(employeeId)) {
      onSelectionChange(
        selectedEmployeeIds.filter((id) => id !== employeeId)
      );
    } else {
      onSelectionChange([...selectedEmployeeIds, employeeId]);
    }
  };

  const clearSelection = () => {
    onSelectionChange([]);
  };

  const selectAll = () => {
    onSelectionChange(employees.map((e) => e.id));
  };

  const getSelectedNames = (): string => {
    if (selectedEmployeeIds.length === 0) return "Wszyscy pracownicy";
    if (selectedEmployeeIds.length === employees.length)
      return "Wszyscy pracownicy";
    const names = employees
      .filter((e) => selectedEmployeeIds.includes(e.id))
      .map((e) => `${e.firstName} ${e.lastName}`);
    if (names.length <= 2) return names.join(", ");
    return `${names[0]}, ${names[1]} +${names.length - 2}`;
  };

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="justify-between min-w-[220px] max-w-[350px]"
            disabled={loading}
          >
            <div className="flex items-center gap-2 truncate">
              <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {loading ? "Ladowanie..." : getSelectedNames()}
              </span>
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <div className="p-2 border-b">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Filtruj wg pracownika</span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={selectAll}
                >
                  Zaznacz wszystkich
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={clearSelection}
                >
                  Wyczysc
                </Button>
              </div>
            </div>
          </div>
          <div className="max-h-[300px] overflow-y-auto p-1">
            {employees.length === 0 && !loading && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                Brak pracownikow
              </div>
            )}
            {employees.map((employee) => {
              const isSelected = selectedEmployeeIds.includes(employee.id);
              return (
                <button
                  key={employee.id}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted"
                  }`}
                  onClick={() => toggleEmployee(employee.id)}
                  type="button"
                >
                  <div
                    className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                      isSelected
                        ? "bg-primary border-primary"
                        : "border-muted-foreground/30"
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3 text-white" />}
                  </div>
                  <span className="truncate">
                    {employee.firstName} {employee.lastName}
                  </span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      {/* Selected employee badges */}
      {selectedEmployeeIds.length > 0 &&
        selectedEmployeeIds.length < employees.length && (
          <div className="flex items-center gap-1 flex-wrap">
            {employees
              .filter((e) => selectedEmployeeIds.includes(e.id))
              .slice(0, 3)
              .map((emp) => (
                <Badge
                  key={emp.id}
                  variant="secondary"
                  className="text-xs gap-1"
                >
                  {emp.firstName} {emp.lastName}
                  <X
                    className="h-3 w-3 cursor-pointer hover:text-destructive"
                    onClick={() => toggleEmployee(emp.id)}
                  />
                </Badge>
              ))}
            {selectedEmployeeIds.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{selectedEmployeeIds.length - 3} wiecej
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs px-2"
              onClick={clearSelection}
            >
              <X className="h-3 w-3 mr-1" />
              Wyczysc filtr
            </Button>
          </div>
        )}
    </div>
  );
}
