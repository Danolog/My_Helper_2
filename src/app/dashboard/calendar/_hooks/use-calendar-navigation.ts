"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { getStartOfWeek, getEndOfWeek } from "@/lib/date-utils";
import type { CalendarEvent, CalendarView, Employee, TimeBlock } from "@/types/calendar";

export function useCalendarNavigation() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useState<CalendarView>("day");

  // Employee filter: "all" shows all employees, or a specific employee ID
  const [selectedEmployeeFilter, setSelectedEmployeeFilter] = useState<string>("all");

  // Color mode: "status" for status-based colors, "employee" for employee-based colors
  const [colorMode, setColorMode] = useState<"status" | "employee">("status");

  // Drag & drop state
  const [draggedEvent, setDraggedEvent] = useState<CalendarEvent | null>(null);

  // Reschedule dialog state
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);
  const [pendingReschedule, setPendingReschedule] = useState<{
    event: CalendarEvent;
    newStartTime: Date;
    newEmployeeId: string;
  } | null>(null);
  const [isRescheduling, setIsRescheduling] = useState(false);

  // New appointment dialog state
  const [newAppointmentDialogOpen, setNewAppointmentDialogOpen] = useState(false);

  // Schedule next appointment data (from complete dialog)
  const [scheduleNextData, setScheduleNextData] = useState<{
    clientId: string;
    serviceId: string;
    employeeId: string;
    suggestedDate: string;
  } | null>(null);

  // Block time dialog state
  const [blockTimeDialogOpen, setBlockTimeDialogOpen] = useState(false);

  // Cancel appointment dialog state
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelAppointmentId, setCancelAppointmentId] = useState<string | null>(null);

  // Complete appointment dialog state
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completeAppointment, setCompleteAppointment] = useState<CalendarEvent["appointment"] | null>(null);
  const [completeMaterials, setCompleteMaterials] = useState<Array<{id: string; product: {name: string; pricePerUnit: string | null; unit: string | null;} | null; quantityUsed: string;}>>([]);

  // Navigation handlers
  const goToPrevious = () => {
    const step = currentView === "week" ? 7 : 1;
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() - step);
      return newDate;
    });
  };

  const goToNext = () => {
    const step = currentView === "week" ? 7 : 1;
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() + step);
      return newDate;
    });
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Toggle color mode
  const toggleColorMode = () => {
    setColorMode((prev) => (prev === "status" ? "employee" : "status"));
  };

  // Drag handlers
  const handleDragStart = useCallback((event: CalendarEvent) => {
    setDraggedEvent(event);
  }, []);

  const handleDragEnd = useCallback(() => {
    // Only clear if not opening dialog
    if (!rescheduleDialogOpen) {
      setDraggedEvent(null);
    }
  }, [rescheduleDialogOpen]);

  const handleDrop = useCallback((employeeId: string, time: Date) => {
    setDraggedEvent((current) => {
      if (!current) return current;
      setPendingReschedule({
        event: current,
        newStartTime: time,
        newEmployeeId: employeeId,
      });
      setRescheduleDialogOpen(true);
      return current;
    });
  }, []);

  // Handle opening cancel dialog
  const handleCancelAppointment = useCallback((appointmentId: string) => {
    setCancelAppointmentId(appointmentId);
    setCancelDialogOpen(true);
  }, []);

  // Handle opening complete dialog
  const handleCompleteAppointment = useCallback(async (event: CalendarEvent) => {
    setCompleteAppointment(event.appointment);
    // Fetch materials for this appointment
    try {
      const res = await fetch(`/api/appointments/${event.id}/materials`);
      const data = await res.json();
      if (data.success) {
        setCompleteMaterials(data.data.map((m: { id: string; quantityUsed: string; product: { name: string; pricePerUnit: string | null; unit: string | null } | null }) => ({
          id: m.id,
          product: m.product ? {
            name: m.product.name,
            pricePerUnit: m.product.pricePerUnit,
            unit: m.product.unit,
          } : null,
          quantityUsed: m.quantityUsed,
        })));
      }
    } catch {
      setCompleteMaterials([]);
    }
    setCompleteDialogOpen(true);
  }, []);

  // Stable callbacks for event cancel/complete (wrapping event -> appointmentId)
  const handleEventCancel = useCallback((event: CalendarEvent) => {
    handleCancelAppointment(event.id);
  }, [handleCancelAppointment]);

  const handleEventComplete = useCallback((event: CalendarEvent) => {
    handleCompleteAppointment(event);
  }, [handleCompleteAppointment]);

  // Event click handler - shows details with action buttons
  const handleEventClick = useCallback((event: CalendarEvent) => {
    const statusLabels: Record<string, string> = {
      scheduled: "Zaplanowana",
      confirmed: "Potwierdzona",
      completed: "Zakonczona",
      cancelled: "Anulowana",
      no_show: "Niestawienie sie",
    };

    const clientName = event.appointment.client
      ? `${event.appointment.client.firstName} ${event.appointment.client.lastName}`
      : null;
    const clientInfo = clientName
      ? `Klient: ${clientName}`
      : "Brak przypisanego klienta";
    const statusInfo = `Status: ${statusLabels[event.appointment.status] || event.appointment.status}`;

    // Check if the client has allergies or preferences
    const clientAllergies = event.appointment.client?.allergies;
    const clientPreferences = event.appointment.client?.preferences;
    const hasAllergies = clientAllergies && clientAllergies.trim().length > 0;
    const hasPreferences = clientPreferences && clientPreferences.trim().length > 0;

    let description = `${clientInfo} | ${statusInfo}`;
    if (hasPreferences) {
      description += `\nPreferencje: ${clientPreferences}`;
    }
    if (hasAllergies) {
      description += `\nUWAGA ALERGIE: ${clientAllergies}`;
    }

    // Show "Complete" button for completable appointments (scheduled/confirmed)
    const isCompletable = event.appointment.status === "scheduled" || event.appointment.status === "confirmed";

    if (hasAllergies) {
      toast.warning(`Wizyta: ${event.title}`, {
        description,
        duration: 8000,
        action: isCompletable ? {
          label: "Zakoncz wizyte",
          onClick: () => handleCompleteAppointment(event),
        } : {
          label: "Szczegoly",
          onClick: () => window.location.href = `/dashboard/appointments/${event.id}`,
        },
      });
    } else if (hasPreferences) {
      toast.info(`Wizyta: ${event.title}`, {
        description,
        duration: 6000,
        action: isCompletable ? {
          label: "Zakoncz wizyte",
          onClick: () => handleCompleteAppointment(event),
        } : {
          label: "Szczegoly",
          onClick: () => window.location.href = `/dashboard/appointments/${event.id}`,
        },
      });
    } else {
      toast.info(`Wizyta: ${event.title}`, {
        description,
        action: isCompletable ? {
          label: "Zakoncz wizyte",
          onClick: () => handleCompleteAppointment(event),
        } : {
          label: "Szczegoly",
          onClick: () => window.location.href = `/dashboard/appointments/${event.id}`,
        },
      });
    }
  }, [handleCompleteAppointment]);

  // Cancel reschedule
  const handleCancelReschedule = () => {
    setRescheduleDialogOpen(false);
    setPendingReschedule(null);
    setDraggedEvent(null);
  };

  // Format date display based on current view
  const formatDateDisplay = (date: Date) => {
    if (currentView === "week") {
      const weekStart = getStartOfWeek(date);
      const weekEnd = getEndOfWeek(date);
      const startStr = weekStart.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
      const endStr = weekEnd.toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
      return `${startStr} - ${endStr}`;
    }
    return date.toLocaleDateString("pl-PL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  // Compute filtered data based on employee selection
  const getFilteredData = (
    employees: Employee[],
    events: CalendarEvent[],
    timeBlocks: TimeBlock[],
  ) => {
    const filteredEmployees = selectedEmployeeFilter === "all"
      ? employees
      : employees.filter((emp) => emp.id === selectedEmployeeFilter);

    const filteredEvents = selectedEmployeeFilter === "all"
      ? events
      : events.filter((event) => event.employeeId === selectedEmployeeFilter);

    const filteredTimeBlocks = selectedEmployeeFilter === "all"
      ? timeBlocks
      : timeBlocks.filter((block) => block.employeeId === selectedEmployeeFilter);

    return { filteredEmployees, filteredEvents, filteredTimeBlocks };
  };

  return {
    // Navigation state
    currentDate,
    setCurrentDate,
    currentView,
    setCurrentView,

    // Filter state
    selectedEmployeeFilter,
    setSelectedEmployeeFilter,
    colorMode,
    toggleColorMode,

    // Drag & drop
    draggedEvent,
    setDraggedEvent,
    handleDragStart,
    handleDragEnd,
    handleDrop,

    // Reschedule
    rescheduleDialogOpen,
    setRescheduleDialogOpen,
    pendingReschedule,
    setPendingReschedule,
    isRescheduling,
    setIsRescheduling,
    handleCancelReschedule,

    // New appointment
    newAppointmentDialogOpen,
    setNewAppointmentDialogOpen,
    scheduleNextData,
    setScheduleNextData,

    // Block time
    blockTimeDialogOpen,
    setBlockTimeDialogOpen,

    // Cancel
    cancelDialogOpen,
    setCancelDialogOpen,
    cancelAppointmentId,

    // Complete
    completeDialogOpen,
    setCompleteDialogOpen,
    completeAppointment,
    setCompleteAppointment,
    completeMaterials,
    handleCompleteAppointment,

    // Event handlers
    handleEventCancel,
    handleEventComplete,
    handleEventClick,

    // Navigation actions
    goToPrevious,
    goToNext,
    goToToday,

    // Utilities
    formatDateDisplay,
    getFilteredData,
  };
}
