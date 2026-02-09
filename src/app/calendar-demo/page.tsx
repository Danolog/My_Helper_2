"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TimeGrid } from "@/components/calendar/time-grid";
import { CalendarLegend } from "@/components/calendar/calendar-legend";
import { ChevronLeft, ChevronRight, Calendar, Palette } from "lucide-react";
import type { Appointment, CalendarEvent, Employee } from "@/types/calendar";

// Demo data - sample employees
const DEMO_EMPLOYEES: Employee[] = [
  {
    id: "emp1",
    salonId: "salon1",
    firstName: "Anna",
    lastName: "Kowalska",
    phone: null,
    email: null,
    photoUrl: null,
    role: "employee",
    isActive: true,
    color: "#8b5cf6", // Purple
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "emp2",
    salonId: "salon1",
    firstName: "Marek",
    lastName: "Nowak",
    phone: null,
    email: null,
    photoUrl: null,
    role: "employee",
    isActive: true,
    color: "#06b6d4", // Cyan
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

// Generate demo appointments for today showing all status types
function generateDemoEvents(date: Date): CalendarEvent[] {
  const today = new Date(date);

  const createAppointment = (
    id: string,
    status: Appointment["status"],
    hour: number,
    minute: number,
    durationMinutes: number,
    employeeId: string,
    serviceName: string,
    clientFirst: string,
    clientLast: string
  ): CalendarEvent => {
    const start = new Date(today);
    start.setHours(hour, minute, 0, 0);
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

    const employee = DEMO_EMPLOYEES.find(e => e.id === employeeId)!;

    return {
      id,
      title: serviceName,
      start,
      end,
      employeeId,
      employeeColor: employee.color || "#3b82f6",
      appointment: {
        id,
        salonId: "salon1",
        clientId: `client-${id}`,
        employeeId,
        serviceId: `service-${id}`,
        startTime: start,
        endTime: end,
        status,
        notes: null,
        depositAmount: null,
        depositPaid: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        client: {
          id: `client-${id}`,
          salonId: "salon1",
          firstName: clientFirst,
          lastName: clientLast,
          phone: null,
          email: null,
          notes: null,
          preferences: null,
          allergies: null,
          favoriteEmployeeId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        employee,
        service: {
          id: `service-${id}`,
          salonId: "salon1",
          categoryId: null,
          name: serviceName,
          description: null,
          basePrice: "100",
          baseDuration: durationMinutes,
          suggestedNextVisitDays: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    };
  };

  return [
    // Anna's appointments
    createAppointment("apt1", "scheduled", 9, 0, 60, "emp1", "Manicure", "Maria", "Wisniewska"),
    createAppointment("apt2", "confirmed", 10, 30, 90, "emp1", "Pedicure", "Ewa", "Kaczmarek"),
    createAppointment("apt3", "completed", 12, 30, 60, "emp1", "Hybrid manicure", "Joanna", "Zielinska"),
    createAppointment("apt4", "cancelled", 14, 0, 45, "emp1", "Gel removal", "Katarzyna", "Wojcik"),
    createAppointment("apt5", "no_show", 15, 30, 60, "emp1", "Nail art", "Malgorzata", "Kaminska"),

    // Marek's appointments
    createAppointment("apt6", "scheduled", 8, 30, 45, "emp2", "Haircut men", "Piotr", "Lewandowski"),
    createAppointment("apt7", "confirmed", 10, 0, 60, "emp2", "Hair coloring", "Tomasz", "Dabrowski"),
    createAppointment("apt8", "completed", 11, 30, 90, "emp2", "Full styling", "Adam", "Mazur"),
    createAppointment("apt9", "cancelled", 13, 30, 45, "emp2", "Beard trim", "Michal", "Krawczyk"),
    createAppointment("apt10", "scheduled", 15, 0, 60, "emp2", "Haircut + wash", "Jakub", "Wozniak"),
  ];
}

export default function CalendarDemoPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [colorMode, setColorMode] = useState<"status" | "employee">("status");
  const events = generateDemoEvents(currentDate);

  const goToPreviousDay = () => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() - 1);
      return newDate;
    });
  };

  const goToNextDay = () => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() + 1);
      return newDate;
    });
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const toggleColorMode = () => {
    setColorMode((prev) => (prev === "status" ? "employee" : "status"));
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("pl-PL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  // Dummy handlers for demo
  const handleDragStart = () => {};
  const handleDragEnd = () => {};
  const handleDrop = () => {};
  const handleEventClick = () => {};

  return (
    <div className="container mx-auto p-6 max-w-full">
      {/* Demo badge */}
      <div className="mb-4 p-3 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-400 dark:border-yellow-600 rounded-lg text-sm text-yellow-800 dark:text-yellow-200">
        <strong>Demo Mode:</strong> This page shows sample calendar data to demonstrate appointment color coding by status.
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div className="flex items-center gap-4">
          <Calendar className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Kalendarz - Demo</h1>
            <p className="text-muted-foreground text-sm">
              Demonstracja kolorowania wizyt wg statusu
            </p>
          </div>
        </div>

        {/* Navigation & Controls */}
        <div className="flex items-center gap-2">
          {/* Color mode toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={toggleColorMode}
            title={colorMode === "status" ? "Koloruj wg statusu" : "Koloruj wg pracownika"}
          >
            <Palette className="h-4 w-4 mr-1" />
            {colorMode === "status" ? "Status" : "Pracownik"}
          </Button>

          <div className="w-px h-6 bg-border mx-1" />

          <Button variant="outline" size="sm" onClick={goToPreviousDay}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToToday}>
            Dzisiaj
          </Button>
          <Button variant="outline" size="sm" onClick={goToNextDay}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Current date display */}
      <div className="mb-4">
        <h2 className="text-lg font-medium capitalize">{formatDate(currentDate)}</h2>
      </div>

      {/* Legend */}
      <div className="mb-4">
        <CalendarLegend colorMode={colorMode} employees={DEMO_EMPLOYEES} />
      </div>

      {/* Calendar grid */}
      <TimeGrid
        date={currentDate}
        employees={DEMO_EMPLOYEES}
        events={events}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDrop={handleDrop}
        onEventClick={handleEventClick}
        draggedEvent={null}
        colorMode={colorMode}
      />
    </div>
  );
}
