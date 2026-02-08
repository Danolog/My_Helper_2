"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { TimeGrid } from "@/components/calendar/time-grid";
import { RescheduleDialog } from "@/components/calendar/reschedule-dialog";
import { CalendarLegend } from "@/components/calendar/calendar-legend";
import { ChevronLeft, ChevronRight, Calendar, Lock, Palette, Users, Plus } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { NewAppointmentDialog } from "@/components/appointments/new-appointment-dialog";
import type { Appointment, CalendarEvent, Employee, WorkSchedule } from "@/types/calendar";

// Demo salon ID - in production this would come from user's session
const DEMO_SALON_ID = "00000000-0000-0000-0000-000000000001";

export default function CalendarPage() {
  const { data: session, isPending } = useSession();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [workSchedules, setWorkSchedules] = useState<WorkSchedule[]>([]);
  const [loading, setLoading] = useState(true);

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

  // Fetch employees
  const fetchEmployees = useCallback(async () => {
    try {
      const response = await fetch(`/api/employees?salonId=${DEMO_SALON_ID}&activeOnly=true`);
      const data = await response.json();
      if (data.success) {
        setEmployees(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch employees:", error);
      toast.error("Nie udalo sie pobrac listy pracownikow");
    }
  }, []);

  // Fetch work schedules for all employees in the salon
  const fetchWorkSchedules = useCallback(async () => {
    try {
      const response = await fetch(`/api/work-schedules/by-salon?salonId=${DEMO_SALON_ID}`);
      const data = await response.json();
      if (data.success) {
        setWorkSchedules(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch work schedules:", error);
    }
  }, []);

  // Fetch appointments for current date
  const fetchAppointments = useCallback(async () => {
    try {
      const startOfDay = new Date(currentDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(currentDate);
      endOfDay.setHours(23, 59, 59, 999);

      const params = new URLSearchParams({
        salonId: DEMO_SALON_ID,
        startDate: startOfDay.toISOString(),
        endDate: endOfDay.toISOString(),
      });

      const response = await fetch(`/api/appointments?${params}`);
      const data = await response.json();

      if (data.success) {
        // Transform appointments to calendar events
        const calendarEvents: CalendarEvent[] = data.data.map((apt: Appointment) => ({
          id: apt.id,
          title: apt.service?.name || "Wizyta",
          start: new Date(apt.startTime),
          end: new Date(apt.endTime),
          employeeId: apt.employeeId,
          employeeColor: apt.employee?.color || "#3b82f6",
          appointment: apt,
        }));
        setEvents(calendarEvents);
      }
    } catch (error) {
      console.error("Failed to fetch appointments:", error);
      toast.error("Nie udalo sie pobrac wizyt");
    } finally {
      setLoading(false);
    }
  }, [currentDate]);

  // Initial data load
  useEffect(() => {
    fetchEmployees();
    fetchWorkSchedules();
  }, [fetchEmployees, fetchWorkSchedules]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  // Navigation handlers
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

  // Toggle color mode
  const toggleColorMode = () => {
    setColorMode((prev) => (prev === "status" ? "employee" : "status"));
  };

  // Drag handlers
  const handleDragStart = (event: CalendarEvent) => {
    setDraggedEvent(event);
  };

  const handleDragEnd = () => {
    // Only clear if not opening dialog
    if (!rescheduleDialogOpen) {
      setDraggedEvent(null);
    }
  };

  const handleDrop = (employeeId: string, time: Date) => {
    if (!draggedEvent) return;

    // Open confirmation dialog
    setPendingReschedule({
      event: draggedEvent,
      newStartTime: time,
      newEmployeeId: employeeId,
    });
    setRescheduleDialogOpen(true);
  };

  // Event click handler - shows allergy warning and preferences when client has them
  const handleEventClick = (event: CalendarEvent) => {
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

    if (hasAllergies) {
      toast.warning(`Wizyta: ${event.title}`, {
        description,
        duration: 8000,
      });
    } else if (hasPreferences) {
      toast.info(`Wizyta: ${event.title}`, {
        description,
        duration: 6000,
      });
    } else {
      toast.info(`Wizyta: ${event.title}`, {
        description,
      });
    }
  };

  // Confirm reschedule
  const handleConfirmReschedule = async (notifyClient: boolean) => {
    if (!pendingReschedule) return;

    setIsRescheduling(true);

    try {
      const { event, newStartTime, newEmployeeId } = pendingReschedule;
      const duration = new Date(event.end).getTime() - new Date(event.start).getTime();
      const newEndTime = new Date(newStartTime.getTime() + duration);

      const response = await fetch(`/api/appointments/${event.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startTime: newStartTime.toISOString(),
          endTime: newEndTime.toISOString(),
          employeeId: newEmployeeId,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success("Wizyta zostala przeniesiona", {
          description: notifyClient
            ? "Klient zostanie powiadomiony o zmianie terminu"
            : undefined,
        });
        // Refresh appointments
        fetchAppointments();
      } else {
        toast.error("Nie udalo sie przeniesc wizyty", {
          description: data.error,
        });
      }
    } catch (error) {
      console.error("Failed to reschedule:", error);
      toast.error("Wystapil blad podczas przenoszenia wizyty");
    } finally {
      setIsRescheduling(false);
      setRescheduleDialogOpen(false);
      setPendingReschedule(null);
      setDraggedEvent(null);
    }
  };

  // Cancel reschedule
  const handleCancelReschedule = () => {
    setRescheduleDialogOpen(false);
    setPendingReschedule(null);
    setDraggedEvent(null);
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("pl-PL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Wymagane logowanie</h1>
          <p className="text-muted-foreground mb-6">
            Musisz sie zalogowac, aby uzyskac dostep do kalendarza
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-full">
      {/* Header */}
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
        <div className="flex items-center gap-2">
          {/* New Appointment button */}
          <Button
            size="sm"
            onClick={() => setNewAppointmentDialogOpen(true)}
            data-testid="new-appointment-btn"
          >
            <Plus className="h-4 w-4 mr-1" />
            Nowa wizyta
          </Button>

          {/* Employees link */}
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/employees">
              <Users className="h-4 w-4 mr-1" />
              Pracownicy
            </Link>
          </Button>

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
        <CalendarLegend colorMode={colorMode} employees={employees} />
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="flex justify-center items-center h-96">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : employees.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-96 text-center">
          <p className="text-muted-foreground mb-4">
            Brak pracownikow w salonie. Dodaj pracownikow, aby korzystac z kalendarza.
          </p>
          <Button variant="outline">Dodaj pracownika</Button>
        </div>
      ) : (
        <TimeGrid
          date={currentDate}
          employees={employees}
          events={events}
          workSchedules={workSchedules}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDrop={handleDrop}
          onEventClick={handleEventClick}
          draggedEvent={draggedEvent}
          colorMode={colorMode}
        />
      )}

      {/* Reschedule confirmation dialog */}
      <RescheduleDialog
        open={rescheduleDialogOpen}
        onOpenChange={setRescheduleDialogOpen}
        event={pendingReschedule?.event || null}
        newStartTime={pendingReschedule?.newStartTime || null}
        newEmployeeId={pendingReschedule?.newEmployeeId || null}
        onConfirm={handleConfirmReschedule}
        onCancel={handleCancelReschedule}
        isLoading={isRescheduling}
      />

      {/* New appointment dialog */}
      <NewAppointmentDialog
        open={newAppointmentDialogOpen}
        onOpenChange={setNewAppointmentDialogOpen}
        onAppointmentCreated={fetchAppointments}
        defaultDate={currentDate}
      />
    </div>
  );
}
