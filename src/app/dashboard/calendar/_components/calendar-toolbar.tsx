"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Calendar, Palette, Users, Plus, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CalendarView, Employee } from "@/types/calendar";

interface CalendarToolbarProps {
  currentView: CalendarView;
  colorMode: "status" | "employee";
  selectedEmployeeFilter: string;
  employees: Employee[];
  onViewChange: (view: CalendarView) => void;
  onEmployeeFilterChange: (value: string) => void;
  onToggleColorMode: () => void;
  onNewAppointment: () => void;
  onBlockTime: () => void;
  onGoToPrevious: () => void;
  onGoToToday: () => void;
  onGoToNext: () => void;
}

export function CalendarToolbar({
  currentView,
  colorMode,
  selectedEmployeeFilter,
  employees,
  onViewChange,
  onEmployeeFilterChange,
  onToggleColorMode,
  onNewAppointment,
  onBlockTime,
  onGoToPrevious,
  onGoToToday,
  onGoToNext,
}: CalendarToolbarProps) {
  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
      <div className="flex items-center gap-4">
        <Calendar className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Kalendarz</h1>
          <p className="text-muted-foreground text-sm">
            Przeciagnij wizyte, aby zmienic jej termin
          </p>
        </div>
      </div>

      {/* Navigation & Controls */}
      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
        {/* New Appointment button */}
        <Button
          size="sm"
          onClick={onNewAppointment}
          data-testid="new-appointment-btn"
        >
          <Plus className="h-4 w-4 mr-1" />
          <span className="hidden sm:inline">Nowa wizyta</span>
          <span className="sm:hidden">Nowa</span>
        </Button>

        {/* Block Time button (Feature #36) */}
        <Button
          variant="outline"
          size="sm"
          onClick={onBlockTime}
          data-testid="block-time-btn"
        >
          <Ban className="h-4 w-4 mr-1" />
          <span className="hidden sm:inline">Zablokuj czas</span>
          <span className="sm:hidden">Blokuj</span>
        </Button>

        {/* Employee filter (Feature #33: individual calendar view) */}
        <Select
          value={selectedEmployeeFilter}
          onValueChange={onEmployeeFilterChange}
        >
          <SelectTrigger className="w-[140px] sm:w-[180px] h-8 text-sm" data-testid="employee-filter">
            <SelectValue placeholder="Filtruj pracownika" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Wszyscy pracownicy</SelectItem>
            {employees.map((emp) => (
              <SelectItem key={emp.id} value={emp.id}>
                <span className="flex items-center gap-2">
                  {emp.color && (
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: emp.color }}
                    />
                  )}
                  {emp.firstName} {emp.lastName}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Employees link */}
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/employees">
            <Users className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Pracownicy</span>
          </Link>
        </Button>

        {/* Color mode toggle */}
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleColorMode}
          title={colorMode === "status" ? "Koloruj wg statusu" : "Koloruj wg pracownika"}
        >
          <Palette className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">{colorMode === "status" ? "Status" : "Pracownik"}</span>
        </Button>

        {/* View toggle */}
        <div className="flex items-center rounded-md border border-border">
          <Button
            variant={currentView === "day" ? "default" : "ghost"}
            size="sm"
            onClick={() => onViewChange("day")}
            className="rounded-r-none"
          >
            Dzien
          </Button>
          <Button
            variant={currentView === "week" ? "default" : "ghost"}
            size="sm"
            onClick={() => onViewChange("week")}
            className="rounded-l-none"
          >
            Tydzien
          </Button>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={onGoToPrevious}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={onGoToToday}>
            Dzisiaj
          </Button>
          <Button variant="outline" size="sm" onClick={onGoToNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
