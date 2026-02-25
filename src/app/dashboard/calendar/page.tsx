"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { TimeGrid } from "@/components/calendar/time-grid";
import { RescheduleDialog } from "@/components/calendar/reschedule-dialog";
import { CalendarLegend } from "@/components/calendar/calendar-legend";
import { ChevronLeft, ChevronRight, Calendar, Lock, Palette, Users, Plus, Ban } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NewAppointmentDialog } from "@/components/appointments/new-appointment-dialog";
import { CancelAppointmentDialog } from "@/components/appointments/cancel-appointment-dialog";
import { CompleteAppointmentDialog } from "@/components/appointments/complete-appointment-dialog";
import { BlockTimeDialog } from "@/components/calendar/block-time-dialog";
import type { Appointment, CalendarEvent, Employee, TimeBlock, WorkSchedule } from "@/types/calendar";
import { useTabSync } from "@/hooks/use-tab-sync";

export default function CalendarPage() {
  const { data: session, isPending } = useSession();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [workSchedules, setWorkSchedules] = useState<WorkSchedule[]>([]);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [salonId, setSalonId] = useState<string | null>(null);

  // Fetch the user's salon
  useEffect(() => {
    async function fetchSalon() {
      try {
        const res = await fetch("/api/salons/mine");
        const data = await res.json();
        if (data.success && data.salon) {
          setSalonId(data.salon.id);
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to fetch salon:", err);
        setLoading(false);
      }
    }
    if (session?.user) {
      fetchSalon();
    }
  }, [session]);

  // Employee filter: "all" shows all employees, or a specific employee ID
  const [selectedEmployeeFilter, setSelectedEmployeeFilter] = useState<string>("all");

  // Block time dialog state
  const [blockTimeDialogOpen, setBlockTimeDialogOpen] = useState(false);

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

  // Cancel appointment dialog state
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelAppointmentId, setCancelAppointmentId] = useState<string | null>(null);

  // Complete appointment dialog state
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completeAppointment, setCompleteAppointment] = useState<CalendarEvent["appointment"] | null>(null);
  const [completeMaterials, setCompleteMaterials] = useState<Array<{id: string; product: {name: string; pricePerUnit: string | null; unit: string | null;} | null; quantityUsed: string;}>>([]);

  // Fetch employees
  const fetchEmployees = useCallback(async () => {
    if (!salonId) return;
    try {
      const response = await fetch(`/api/employees?salonId=${salonId}&activeOnly=true`);
      const data = await response.json();
      if (data.success) {
        setEmployees(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch employees:", error);
      toast.error("Nie udalo sie pobrac listy pracownikow");
    }
  }, [salonId]);

  // Fetch work schedules for all employees in the salon
  const fetchWorkSchedules = useCallback(async () => {
    if (!salonId) return;
    try {
      const response = await fetch(`/api/work-schedules/by-salon?salonId=${salonId}`);
      const data = await response.json();
      if (data.success) {
        setWorkSchedules(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch work schedules:", error);
    }
  }, [salonId]);

  // Fetch time blocks (vacations, breaks, etc.) for the current date
  const fetchTimeBlocks = useCallback(async () => {
    try {
      const startOfDay = new Date(currentDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(currentDate);
      endOfDay.setHours(23, 59, 59, 999);

      const params = new URLSearchParams({
        startDate: startOfDay.toISOString(),
        endDate: endOfDay.toISOString(),
      });

      const response = await fetch(`/api/time-blocks?${params}`);
      const data = await response.json();

      if (data.success) {
        // Parse date strings into Date objects
        const blocks: TimeBlock[] = data.data.map((block: TimeBlock) => ({
          ...block,
          startTime: new Date(block.startTime),
          endTime: new Date(block.endTime),
          createdAt: new Date(block.createdAt),
        }));
        setTimeBlocks(blocks);
      }
    } catch (error) {
      console.error("Failed to fetch time blocks:", error);
    }
  }, [currentDate]);

  // Fetch appointments for current date
  const fetchAppointments = useCallback(async () => {
    if (!salonId) return;
    try {
      const startOfDay = new Date(currentDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(currentDate);
      endOfDay.setHours(23, 59, 59, 999);

      const params = new URLSearchParams({
        salonId: salonId!,
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
  }, [currentDate, salonId]);

  // Initial data load - wait for salonId
  useEffect(() => {
    if (salonId) {
      fetchEmployees();
      fetchWorkSchedules();
    }
  }, [salonId, fetchEmployees, fetchWorkSchedules]);

  useEffect(() => {
    if (salonId) {
      fetchAppointments();
      fetchTimeBlocks();
    }
  }, [salonId, fetchAppointments, fetchTimeBlocks]);

  // Cross-tab sync: refetch when another tab modifies appointments
  const { notifyChange: notifyCalendarChanged } = useTabSync("appointments", fetchAppointments);

  // Filtered data based on employee selection (Feature #33: individual calendar view)
  const filteredEmployees = selectedEmployeeFilter === "all"
    ? employees
    : employees.filter((emp) => emp.id === selectedEmployeeFilter);

  const filteredEvents = selectedEmployeeFilter === "all"
    ? events
    : events.filter((event) => event.employeeId === selectedEmployeeFilter);

  const filteredTimeBlocks = selectedEmployeeFilter === "all"
    ? timeBlocks
    : timeBlocks.filter((block) => block.employeeId === selectedEmployeeFilter);

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

  // Handle opening cancel dialog
  const handleCancelAppointment = (appointmentId: string) => {
    setCancelAppointmentId(appointmentId);
    setCancelDialogOpen(true);
  };

  // Handle opening complete dialog
  const handleCompleteAppointment = async (event: CalendarEvent) => {
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
    } catch (error) {
      console.error("Failed to fetch materials:", error);
      setCompleteMaterials([]);
    }
    setCompleteDialogOpen(true);
  };

  // Event click handler - shows details with action buttons
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
        notifyCalendarChanged();
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

          {/* Block Time button (Feature #36) */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBlockTimeDialogOpen(true)}
            data-testid="block-time-btn"
          >
            <Ban className="h-4 w-4 mr-1" />
            Zablokuj czas
          </Button>

          {/* Employee filter (Feature #33: individual calendar view) */}
          <Select
            value={selectedEmployeeFilter}
            onValueChange={setSelectedEmployeeFilter}
          >
            <SelectTrigger className="w-[180px] h-8 text-sm" data-testid="employee-filter">
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
          employees={filteredEmployees}
          events={filteredEvents}
          workSchedules={workSchedules}
          timeBlocks={filteredTimeBlocks}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDrop={handleDrop}
          onEventClick={handleEventClick}
          onEventCancel={(event) => handleCancelAppointment(event.id)}
          onEventComplete={(event) => handleCompleteAppointment(event)}
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
        onOpenChange={(v) => {
          setNewAppointmentDialogOpen(v);
          if (!v) setScheduleNextData(null);
        }}
        onAppointmentCreated={() => {
          fetchAppointments();
          setScheduleNextData(null);
        }}
        defaultDate={currentDate}
        defaultClientId={scheduleNextData?.clientId}
        defaultServiceId={scheduleNextData?.serviceId}
        defaultEmployeeId={scheduleNextData?.employeeId || undefined}
        defaultDateString={scheduleNextData?.suggestedDate}
        title={scheduleNextData ? "Nastepna wizyta" : undefined}
      />

      {/* Cancel appointment dialog */}
      <CancelAppointmentDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        appointmentId={cancelAppointmentId}
        onAppointmentCancelled={fetchAppointments}
      />

      {/* Block time dialog (Feature #36) */}
      <BlockTimeDialog
        open={blockTimeDialogOpen}
        onOpenChange={setBlockTimeDialogOpen}
        employees={employees}
        defaultDate={currentDate}
        onBlockCreated={() => {
          fetchTimeBlocks();
        }}
      />

      {/* Complete appointment dialog */}
      {completeAppointment && (
        <CompleteAppointmentDialog
          open={completeDialogOpen}
          onOpenChange={setCompleteDialogOpen}
          appointment={{
            id: completeAppointment.id,
            employeeId: completeAppointment.employeeId,
            status: completeAppointment.status,
            service: completeAppointment.service ? {
              id: completeAppointment.service.id,
              name: completeAppointment.service.name,
              basePrice: completeAppointment.service.basePrice,
              baseDuration: completeAppointment.service.baseDuration,
              suggestedNextVisitDays: completeAppointment.service.suggestedNextVisitDays ?? null,
            } : null,
            employee: completeAppointment.employee ? {
              id: completeAppointment.employee.id,
              firstName: completeAppointment.employee.firstName,
              lastName: completeAppointment.employee.lastName,
            } : null,
            client: completeAppointment.client ? {
              id: completeAppointment.client.id,
              firstName: completeAppointment.client.firstName,
              lastName: completeAppointment.client.lastName,
            } : null,
          }}
          materials={completeMaterials}
          onCompleted={() => {
            fetchAppointments();
          }}
          onScheduleNext={(data) => {
            setScheduleNextData({
              clientId: data.clientId,
              serviceId: data.serviceId,
              employeeId: data.employeeId,
              suggestedDate: data.suggestedDate,
            });
            setCompleteAppointment(null);
            setNewAppointmentDialogOpen(true);
          }}
        />
      )}
    </div>
  );
}
