"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";

export const DAY_NAMES = [
  "Niedziela",
  "Poniedzialek",
  "Wtorek",
  "Sroda",
  "Czwartek",
  "Piatek",
  "Sobota",
];

export interface DaySchedule {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isDayOff: boolean;
}

export interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  color: string | null;
  role: string;
}

export interface TimeBlock {
  id: string;
  employeeId: string;
  startTime: string;
  endTime: string;
  blockType: string;
  reason: string | null;
  createdAt: string;
}

export const DEFAULT_SCHEDULE: DaySchedule[] = [
  { dayOfWeek: 0, startTime: "09:00", endTime: "17:00", isDayOff: true },
  { dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isDayOff: false },
  { dayOfWeek: 2, startTime: "09:00", endTime: "17:00", isDayOff: false },
  { dayOfWeek: 3, startTime: "09:00", endTime: "17:00", isDayOff: false },
  { dayOfWeek: 4, startTime: "09:00", endTime: "17:00", isDayOff: false },
  { dayOfWeek: 5, startTime: "09:00", endTime: "17:00", isDayOff: false },
  { dayOfWeek: 6, startTime: "09:00", endTime: "14:00", isDayOff: false },
];

export const BLOCK_TYPE_LABELS: Record<string, string> = {
  vacation: "Urlop",
  holiday: "Dzien wolny",
  break: "Przerwa",
  personal: "Czas osobisty",
  other: "Inne",
};

export const BLOCK_TYPE_COLORS: Record<string, string> = {
  vacation: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  holiday: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  break: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  personal: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  other: "bg-gray-100 text-gray-800 dark:bg-gray-950 dark:text-gray-300",
};

interface UseScheduleDataReturn {
  session: ReturnType<typeof useSession>["data"];
  isPending: boolean;
  employee: Employee | null;
  schedule: DaySchedule[];
  loading: boolean;
  saving: boolean;
  saved: boolean;
  timeBlocksList: TimeBlock[];
  loadingBlocks: boolean;
  showAddVacation: boolean;
  newVacation: {
    startDate: string;
    endDate: string;
    blockType: string;
    reason: string;
  };
  savingVacation: boolean;
  deletingBlockId: string | null;
  orderedSchedule: DaySchedule[];
  workingDays: number;
  upcomingBlocks: TimeBlock[];
  pastBlocks: TimeBlock[];
  setShowAddVacation: (show: boolean) => void;
  setNewVacation: React.Dispatch<React.SetStateAction<{
    startDate: string;
    endDate: string;
    blockType: string;
    reason: string;
  }>>;
  handleTimeChange: (dayOfWeek: number, field: "startTime" | "endTime", value: string) => void;
  handleDayOffToggle: (dayOfWeek: number) => void;
  handleSave: () => Promise<void>;
  handleAddVacation: () => Promise<void>;
  handleDeleteBlock: (blockId: string) => Promise<void>;
  formatBlockDateRange: (startStr: string, endStr: string) => string;
}

export function useScheduleData(employeeId: string): UseScheduleDataReturn {
  const { data: session, isPending } = useSession();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [schedule, setSchedule] = useState<DaySchedule[]>(DEFAULT_SCHEDULE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Vacation state
  const [timeBlocksList, setTimeBlocksList] = useState<TimeBlock[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(true);
  const [showAddVacation, setShowAddVacation] = useState(false);
  const [newVacation, setNewVacation] = useState({
    startDate: "",
    endDate: "",
    blockType: "vacation",
    reason: "",
  });
  const [savingVacation, setSavingVacation] = useState(false);
  const [deletingBlockId, setDeletingBlockId] = useState<string | null>(null);

  // Fetch time blocks
  const fetchTimeBlocks = useCallback(async (signal: AbortSignal | null = null) => {
    setLoadingBlocks(true);
    try {
      const res = await fetch(`/api/time-blocks?employeeId=${employeeId}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setTimeBlocksList(data.data);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
    } finally {
      setLoadingBlocks(false);
    }
  }, [employeeId]);

  // Fetch employee info and existing schedule
  useEffect(() => {
    const controller = new AbortController();
    async function fetchData() {
      try {
        // Fetch user's salon to get the real salon ID
        const salonRes = await fetch("/api/salons/mine", { signal: controller.signal });
        if (!salonRes.ok) return;
        const salonData = await salonRes.json();
        const userSalonId = salonData.success && salonData.salon ? salonData.salon.id : null;

        if (userSalonId) {
          const empRes = await fetch(`/api/employees?salonId=${userSalonId}`, { signal: controller.signal });
          if (!empRes.ok) return;
          const empData = await empRes.json();
          if (empData.success) {
            const emp = empData.data.find((e: Employee) => e.id === employeeId);
            if (emp) {
              setEmployee(emp);
            }
          }
        }

        const schedRes = await fetch(`/api/work-schedules?employeeId=${employeeId}`, { signal: controller.signal });
        if (!schedRes.ok) return;
        const schedData = await schedRes.json();
        if (schedData.success && schedData.data.length > 0) {
          const existingDays = new Set(schedData.data.map((s: { dayOfWeek: number }) => s.dayOfWeek));
          const merged = DEFAULT_SCHEDULE.map((defaultDay) => {
            const existing = schedData.data.find(
              (s: { dayOfWeek: number }) => s.dayOfWeek === defaultDay.dayOfWeek
            );
            if (existing) {
              return {
                dayOfWeek: existing.dayOfWeek,
                startTime: existing.startTime,
                endTime: existing.endTime,
                isDayOff: false,
              };
            }
            return {
              ...defaultDay,
              isDayOff: !existingDays.has(defaultDay.dayOfWeek) || defaultDay.isDayOff,
            };
          });
          setSchedule(merged);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        toast.error("Nie udalo sie pobrac danych");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
    return () => controller.abort();
  }, [employeeId]);

  // Fetch time blocks on mount
  useEffect(() => {
    const controller = new AbortController();
    fetchTimeBlocks(controller.signal);
    return () => controller.abort();
  }, [fetchTimeBlocks]);

  const handleTimeChange = (dayOfWeek: number, field: "startTime" | "endTime", value: string) => {
    setSchedule((prev) =>
      prev.map((day) =>
        day.dayOfWeek === dayOfWeek ? { ...day, [field]: value } : day
      )
    );
    setSaved(false);
  };

  const handleDayOffToggle = (dayOfWeek: number) => {
    setSchedule((prev) =>
      prev.map((day) =>
        day.dayOfWeek === dayOfWeek ? { ...day, isDayOff: !day.isDayOff } : day
      )
    );
    setSaved(false);
  };

  const handleSave = async () => {
    for (const day of schedule) {
      if (!day.isDayOff && day.startTime >= day.endTime) {
        toast.error(`Bledne godziny dla ${DAY_NAMES[day.dayOfWeek]}`, {
          description: "Godzina rozpoczecia musi byc wczesniejsza niz zakonczenia",
        });
        return;
      }
    }

    setSaving(true);
    try {
      const res = await mutationFetch("/api/work-schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          schedules: schedule,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSaved(true);
        toast.success("Harmonogram zapisany!", {
          description: data.message,
        });
      } else {
        toast.error("Nie udalo sie zapisac harmonogramu", {
          description: data.error,
        });
      }
    } catch {
      toast.error("Wystapil blad podczas zapisu");
    } finally {
      setSaving(false);
    }
  };

  const handleAddVacation = async () => {
    if (!newVacation.startDate || !newVacation.endDate) {
      toast.error("Podaj daty rozpoczecia i zakonczenia");
      return;
    }

    const startTime = new Date(newVacation.startDate + "T00:00:00");
    const endTime = new Date(newVacation.endDate + "T23:59:59");

    if (startTime > endTime) {
      toast.error("Data rozpoczecia musi byc przed data zakonczenia");
      return;
    }

    setSavingVacation(true);
    try {
      const res = await mutationFetch("/api/time-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          blockType: newVacation.blockType,
          reason: newVacation.reason || null,
        }),
      });

      const data = await res.json();
      if (data.success) {
        toast.success("Dodano urlop/dzien wolny!", {
          description: `${BLOCK_TYPE_LABELS[newVacation.blockType]} od ${newVacation.startDate} do ${newVacation.endDate}`,
        });
        setShowAddVacation(false);
        setNewVacation({ startDate: "", endDate: "", blockType: "vacation", reason: "" });
        fetchTimeBlocks();
      } else {
        toast.error("Nie udalo sie dodac", {
          description: data.error,
        });
      }
    } catch {
      toast.error("Wystapil blad podczas dodawania");
    } finally {
      setSavingVacation(false);
    }
  };

  const handleDeleteBlock = async (blockId: string) => {
    setDeletingBlockId(blockId);
    try {
      const res = await mutationFetch(`/api/time-blocks?id=${blockId}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (data.success) {
        toast.success("Usunieto urlop/dzien wolny");
        fetchTimeBlocks();
      } else {
        toast.error("Nie udalo sie usunac", {
          description: data.error,
        });
      }
    } catch {
      toast.error("Wystapil blad podczas usuwania");
    } finally {
      setDeletingBlockId(null);
    }
  };

  const formatBlockDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("pl-PL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const formatBlockDateRange = (startStr: string, endStr: string) => {
    const start = new Date(startStr);
    const end = new Date(endStr);
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return `${formatBlockDate(startStr)} - ${formatBlockDate(endStr)} (${diffDays} ${diffDays === 1 ? "dzien" : "dni"})`;
  };

  const isBlockUpcoming = (endStr: string) => {
    return new Date(endStr) >= new Date();
  };

  // Reorder days to start from Monday (1,2,3,4,5,6,0)
  const orderedSchedule = [
    ...schedule.filter((d) => d.dayOfWeek >= 1 && d.dayOfWeek <= 6),
    ...schedule.filter((d) => d.dayOfWeek === 0),
  ];

  const workingDays = schedule.filter((d) => !d.isDayOff).length;

  // Separate upcoming and past time blocks
  const upcomingBlocks = timeBlocksList.filter((b) => isBlockUpcoming(b.endTime));
  const pastBlocks = timeBlocksList.filter((b) => !isBlockUpcoming(b.endTime));

  return {
    session,
    isPending,
    employee,
    schedule,
    loading,
    saving,
    saved,
    timeBlocksList,
    loadingBlocks,
    showAddVacation,
    newVacation,
    savingVacation,
    deletingBlockId,
    orderedSchedule,
    workingDays,
    upcomingBlocks,
    pastBlocks,
    setShowAddVacation,
    setNewVacation,
    handleTimeChange,
    handleDayOffToggle,
    handleSave,
    handleAddVacation,
    handleDeleteBlock,
    formatBlockDateRange,
  };
}
