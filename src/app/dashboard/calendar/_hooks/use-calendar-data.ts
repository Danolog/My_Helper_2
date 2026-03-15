"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { useTabSync } from "@/hooks/use-tab-sync";
import { mutationFetch } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import { getStartOfWeek, getEndOfWeek } from "@/lib/date-utils";
import type { Appointment, CalendarEvent, CalendarView, Employee, TimeBlock, WorkSchedule } from "@/types/calendar";

interface UseCalendarDataParams {
  currentDate: Date;
  currentView: CalendarView;
}

export function useCalendarData({ currentDate, currentView }: UseCalendarDataParams) {
  const { data: session, isPending } = useSession();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [workSchedules, setWorkSchedules] = useState<WorkSchedule[]>([]);
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [salonId, setSalonId] = useState<string | null>(null);

  // Fetch the user's salon
  useEffect(() => {
    if (!session?.user) return;
    const controller = new AbortController();
    async function fetchSalon() {
      try {
        const res = await fetch("/api/salons/mine", { signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.salon) {
          setSalonId(data.salon.id);
        } else {
          setLoading(false);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setLoading(false);
      }
    }
    fetchSalon();
    return () => controller.abort();
  }, [session]);

  // Fetch employees
  const fetchEmployees = useCallback(async (signal: AbortSignal | null = null) => {
    if (!salonId) return;
    try {
      const response = await fetch(`/api/employees?salonId=${salonId}&activeOnly=true`, { signal });
      if (!response.ok) return;
      const data = await response.json();
      if (data.success) {
        setEmployees(data.data);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error("Nie udalo sie pobrac listy pracownikow");
    }
  }, [salonId]);

  // Fetch work schedules for all employees in the salon
  const fetchWorkSchedules = useCallback(async (signal: AbortSignal | null = null) => {
    if (!salonId) return;
    try {
      const response = await fetch(`/api/work-schedules/by-salon?salonId=${salonId}`, { signal });
      if (!response.ok) return;
      const data = await response.json();
      if (data.success) {
        setWorkSchedules(data.data);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
    }
  }, [salonId]);

  // Fetch time blocks (vacations, breaks, etc.) for the current date/week
  const fetchTimeBlocks = useCallback(async (signal: AbortSignal | null = null) => {
    try {
      let rangeStart: Date;
      let rangeEnd: Date;
      if (currentView === "week") {
        rangeStart = getStartOfWeek(currentDate);
        rangeEnd = getEndOfWeek(currentDate);
      } else {
        rangeStart = new Date(currentDate);
        rangeStart.setHours(0, 0, 0, 0);
        rangeEnd = new Date(currentDate);
        rangeEnd.setHours(23, 59, 59, 999);
      }

      const params = new URLSearchParams({
        startDate: rangeStart.toISOString(),
        endDate: rangeEnd.toISOString(),
      });

      const response = await fetch(`/api/time-blocks?${params}`, { signal });
      if (!response.ok) return;
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
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
    }
  }, [currentDate, currentView]);

  // Fetch appointments for current date/week
  const fetchAppointments = useCallback(async (signal: AbortSignal | null = null) => {
    if (!salonId) return;
    try {
      let rangeStart: Date;
      let rangeEnd: Date;
      if (currentView === "week") {
        rangeStart = getStartOfWeek(currentDate);
        rangeEnd = getEndOfWeek(currentDate);
      } else {
        rangeStart = new Date(currentDate);
        rangeStart.setHours(0, 0, 0, 0);
        rangeEnd = new Date(currentDate);
        rangeEnd.setHours(23, 59, 59, 999);
      }

      const params = new URLSearchParams({
        salonId: salonId!,
        startDate: rangeStart.toISOString(),
        endDate: rangeEnd.toISOString(),
      });

      const response = await fetch(`/api/appointments?${params}`, { signal });
      if (!response.ok) return;
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
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      toast.error("Nie udalo sie pobrac wizyt");
    } finally {
      setLoading(false);
    }
  }, [currentDate, currentView, salonId]);

  // Initial data load - wait for salonId
  useEffect(() => {
    if (!salonId) return;
    const controller = new AbortController();
    fetchEmployees(controller.signal);
    fetchWorkSchedules(controller.signal);
    return () => controller.abort();
  }, [salonId, fetchEmployees, fetchWorkSchedules]);

  useEffect(() => {
    if (!salonId) return;
    const controller = new AbortController();
    fetchAppointments(controller.signal);
    fetchTimeBlocks(controller.signal);
    return () => controller.abort();
  }, [salonId, fetchAppointments, fetchTimeBlocks]);

  // Cross-tab sync: refetch when another tab modifies appointments
  const { notifyChange: notifyCalendarChanged } = useTabSync("appointments", fetchAppointments);

  // Confirm reschedule
  const handleConfirmReschedule = async (
    pendingReschedule: { event: CalendarEvent; newStartTime: Date; newEmployeeId: string } | null,
    notifyClient: boolean,
  ) => {
    if (!pendingReschedule) return;

    try {
      const { event, newStartTime, newEmployeeId } = pendingReschedule;
      const duration = new Date(event.end).getTime() - new Date(event.start).getTime();
      const newEndTime = new Date(newStartTime.getTime() + duration);

      const response = await mutationFetch(`/api/appointments/${event.id}`, {
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
        return true;
      } else {
        toast.error("Nie udalo sie przeniesc wizyty", {
          description: data.error,
        });
        return false;
      }
    } catch {
      toast.error("Wystapil blad podczas przenoszenia wizyty");
      return false;
    }
  };

  return {
    session,
    isPending,
    employees,
    events,
    workSchedules,
    timeBlocks,
    loading,
    salonId,
    fetchAppointments,
    fetchTimeBlocks,
    handleConfirmReschedule,
  };
}
