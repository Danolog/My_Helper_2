"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useSession } from "@/lib/auth-client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Clock, Save, Lock, CheckCircle2, Palmtree, Plus, Trash2, CalendarDays } from "lucide-react";
import { toast } from "sonner";

const DAY_NAMES = [
  "Niedziela",
  "Poniedzialek",
  "Wtorek",
  "Sroda",
  "Czwartek",
  "Piatek",
  "Sobota",
];

interface DaySchedule {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isDayOff: boolean;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  color: string | null;
  role: string;
}

interface TimeBlock {
  id: string;
  employeeId: string;
  startTime: string;
  endTime: string;
  blockType: string;
  reason: string | null;
  createdAt: string;
}

const DEFAULT_SCHEDULE: DaySchedule[] = [
  { dayOfWeek: 0, startTime: "09:00", endTime: "17:00", isDayOff: true },
  { dayOfWeek: 1, startTime: "09:00", endTime: "17:00", isDayOff: false },
  { dayOfWeek: 2, startTime: "09:00", endTime: "17:00", isDayOff: false },
  { dayOfWeek: 3, startTime: "09:00", endTime: "17:00", isDayOff: false },
  { dayOfWeek: 4, startTime: "09:00", endTime: "17:00", isDayOff: false },
  { dayOfWeek: 5, startTime: "09:00", endTime: "17:00", isDayOff: false },
  { dayOfWeek: 6, startTime: "09:00", endTime: "14:00", isDayOff: false },
];

const BLOCK_TYPE_LABELS: Record<string, string> = {
  vacation: "Urlop",
  holiday: "Dzien wolny",
  break: "Przerwa",
  personal: "Czas osobisty",
  other: "Inne",
};

const BLOCK_TYPE_COLORS: Record<string, string> = {
  vacation: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  holiday: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  break: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  personal: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
  other: "bg-gray-100 text-gray-800 dark:bg-gray-950 dark:text-gray-300",
};

export default function EmployeeSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: employeeId } = use(params);
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
  const fetchTimeBlocks = useCallback(async () => {
    setLoadingBlocks(true);
    try {
      const res = await fetch(`/api/time-blocks?employeeId=${employeeId}`);
      const data = await res.json();
      if (data.success) {
        setTimeBlocksList(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch time blocks:", error);
    } finally {
      setLoadingBlocks(false);
    }
  }, [employeeId]);

  // Fetch employee info and existing schedule
  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch user's salon to get the real salon ID
        const salonRes = await fetch("/api/salons/mine");
        const salonData = await salonRes.json();
        const userSalonId = salonData.success && salonData.salon ? salonData.salon.id : null;

        if (userSalonId) {
          const empRes = await fetch(`/api/employees?salonId=${userSalonId}`);
          const empData = await empRes.json();
          if (empData.success) {
            const emp = empData.data.find((e: Employee) => e.id === employeeId);
            if (emp) {
              setEmployee(emp);
            }
          }
        }

        const schedRes = await fetch(`/api/work-schedules?employeeId=${employeeId}`);
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
        console.error("Failed to fetch data:", error);
        toast.error("Nie udalo sie pobrac danych");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [employeeId]);

  // Fetch time blocks on mount
  useEffect(() => {
    fetchTimeBlocks();
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
      const res = await fetch("/api/work-schedules", {
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
    } catch (error) {
      console.error("Failed to save schedule:", error);
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
      const res = await fetch("/api/time-blocks", {
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
    } catch (error) {
      console.error("Failed to add vacation:", error);
      toast.error("Wystapil blad podczas dodawania");
    } finally {
      setSavingVacation(false);
    }
  };

  const handleDeleteBlock = async (blockId: string) => {
    setDeletingBlockId(blockId);
    try {
      const res = await fetch(`/api/time-blocks?id=${blockId}`, {
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
    } catch (error) {
      console.error("Failed to delete time block:", error);
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

  if (isPending || loading) {
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
            Musisz sie zalogowac, aby zarzadzac harmonogramem
          </p>
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-2">Pracownik nie znaleziony</h1>
          <p className="text-muted-foreground mb-6">
            Nie znaleziono pracownika o podanym ID
          </p>
          <Button asChild>
            <Link href="/dashboard/employees">Powrot do listy</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Reorder days to start from Monday (1,2,3,4,5,6,0)
  const orderedSchedule = [
    ...schedule.filter((d) => d.dayOfWeek >= 1 && d.dayOfWeek <= 6),
    ...schedule.filter((d) => d.dayOfWeek === 0),
  ];

  const workingDays = schedule.filter((d) => !d.isDayOff).length;

  // Separate upcoming and past time blocks
  const upcomingBlocks = timeBlocksList.filter((b) => isBlockUpcoming(b.endTime));
  const pastBlocks = timeBlocksList.filter((b) => !isBlockUpcoming(b.endTime));

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      {/* Back link */}
      <Link
        href="/dashboard/employees"
        className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Powrot do listy pracownikow
      </Link>

      {/* Employee info header */}
      <div className="flex items-center gap-4 mb-6">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold"
          style={{ backgroundColor: employee.color || "#3b82f6" }}
        >
          {employee.firstName[0]}{employee.lastName[0]}
        </div>
        <div>
          <h1 className="text-2xl font-bold">
            {employee.firstName} {employee.lastName}
          </h1>
          <p className="text-muted-foreground text-sm">
            Harmonogram pracy · {workingDays} dni roboczych
          </p>
        </div>
      </div>

      {/* Schedule Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Godziny pracy</CardTitle>
              <CardDescription>
                Ustaw regularne godziny pracy dla kazdego dnia tygodnia.
                Dni oznaczone jako wolne nie beda dostepne dla rezerwacji.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {orderedSchedule.map((day) => (
              <div
                key={day.dayOfWeek}
                className={`flex items-center gap-4 p-3 rounded-lg border transition-colors ${
                  day.isDayOff
                    ? "bg-muted/50 border-muted"
                    : "bg-background border-border"
                }`}
              >
                <div className="w-28 flex-shrink-0">
                  <span className={`font-medium ${day.isDayOff ? "text-muted-foreground" : ""}`}>
                    {DAY_NAMES[day.dayOfWeek]}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleDayOffToggle(day.dayOfWeek)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    day.isDayOff
                      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900"
                      : "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900"
                  }`}
                >
                  {day.isDayOff ? "Dzien wolny" : "Pracujacy"}
                </button>

                {!day.isDayOff ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      type="time"
                      value={day.startTime}
                      onChange={(e) => handleTimeChange(day.dayOfWeek, "startTime", e.target.value)}
                      className="w-32"
                    />
                    <span className="text-muted-foreground">-</span>
                    <Input
                      type="time"
                      value={day.endTime}
                      onChange={(e) => handleTimeChange(day.dayOfWeek, "endTime", e.target.value)}
                      className="w-32"
                    />
                  </div>
                ) : (
                  <div className="flex-1 text-sm text-muted-foreground italic">
                    Brak godzin pracy
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-6 flex items-center gap-4">
            <Button onClick={handleSave} disabled={saving} className="min-w-[200px]">
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Zapisywanie...
                </>
              ) : saved ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Zapisano
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Zapisz harmonogram
                </>
              )}
            </Button>
            {saved && (
              <span className="text-sm text-green-600 dark:text-green-400">
                Harmonogram zostal zapisany pomyslnie
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Vacation / Days Off Card */}
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Palmtree className="h-5 w-5 text-orange-500" />
              <div>
                <CardTitle>Urlopy i dni wolne</CardTitle>
                <CardDescription>
                  Zaplanuj urlopy, dni wolne i inne blokady czasu.
                  Rezerwacje nie beda mozliwe w wybranych terminach.
                </CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddVacation(!showAddVacation)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Dodaj urlop
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Add vacation form */}
          {showAddVacation && (
            <div className="mb-6 p-4 rounded-lg border border-dashed border-primary/50 bg-primary/5">
              <h4 className="font-medium mb-3">Nowy urlop / dzien wolny</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <Label htmlFor="vacationStart">Data rozpoczecia</Label>
                  <Input
                    id="vacationStart"
                    type="date"
                    value={newVacation.startDate}
                    onChange={(e) =>
                      setNewVacation((prev) => ({ ...prev, startDate: e.target.value }))
                    }
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="vacationEnd">Data zakonczenia</Label>
                  <Input
                    id="vacationEnd"
                    type="date"
                    value={newVacation.endDate}
                    onChange={(e) =>
                      setNewVacation((prev) => ({ ...prev, endDate: e.target.value }))
                    }
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <Label htmlFor="blockType">Typ</Label>
                  <select
                    id="blockType"
                    value={newVacation.blockType}
                    onChange={(e) =>
                      setNewVacation((prev) => ({ ...prev, blockType: e.target.value }))
                    }
                    className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="vacation">Urlop</option>
                    <option value="holiday">Dzien wolny</option>
                    <option value="personal">Czas osobisty</option>
                    <option value="other">Inne</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="vacationReason">Powod (opcjonalnie)</Label>
                  <Input
                    id="vacationReason"
                    type="text"
                    placeholder="np. Urlop wypoczynkowy"
                    value={newVacation.reason}
                    onChange={(e) =>
                      setNewVacation((prev) => ({ ...prev, reason: e.target.value }))
                    }
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAddVacation} disabled={savingVacation} size="sm">
                  {savingVacation ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      Zapisywanie...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Potwierdz
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowAddVacation(false);
                    setNewVacation({ startDate: "", endDate: "", blockType: "vacation", reason: "" });
                  }}
                >
                  Anuluj
                </Button>
              </div>
            </div>
          )}

          {/* Time blocks list */}
          {loadingBlocks ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          ) : timeBlocksList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Palmtree className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p>Brak zaplanowanych urlopow i dni wolnych</p>
              <p className="text-sm mt-1">
                Kliknij &quot;Dodaj urlop&quot; aby dodac nowy
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingBlocks.length > 0 && (
                <>
                  <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Nadchodzace
                  </h4>
                  {upcomingBlocks.map((block) => (
                    <div
                      key={block.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-background"
                    >
                      <div className="flex items-center gap-3">
                        <CalendarDays className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">
                              {formatBlockDateRange(block.startTime, block.endTime)}
                            </span>
                            <Badge
                              variant="secondary"
                              className={BLOCK_TYPE_COLORS[block.blockType] || BLOCK_TYPE_COLORS.other}
                            >
                              {BLOCK_TYPE_LABELS[block.blockType] || block.blockType}
                            </Badge>
                          </div>
                          {block.reason && (
                            <p className="text-sm text-muted-foreground mt-0.5">{block.reason}</p>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteBlock(block.id)}
                        disabled={deletingBlockId === block.id}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 flex-shrink-0"
                      >
                        {deletingBlockId === block.id ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-500" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ))}
                </>
              )}

              {pastBlocks.length > 0 && (
                <>
                  <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mt-4 mb-2">
                    Przeszle
                  </h4>
                  {pastBlocks.map((block) => (
                    <div
                      key={block.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-muted/30 opacity-60"
                    >
                      <div className="flex items-center gap-3">
                        <CalendarDays className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">
                              {formatBlockDateRange(block.startTime, block.endTime)}
                            </span>
                            <Badge
                              variant="secondary"
                              className={BLOCK_TYPE_COLORS[block.blockType] || BLOCK_TYPE_COLORS.other}
                            >
                              {BLOCK_TYPE_LABELS[block.blockType] || block.blockType}
                            </Badge>
                          </div>
                          {block.reason && (
                            <p className="text-sm text-muted-foreground mt-0.5">{block.reason}</p>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteBlock(block.id)}
                        disabled={deletingBlockId === block.id}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 flex-shrink-0"
                      >
                        {deletingBlockId === block.id ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-500" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div className="mt-6 flex gap-4">
        <Button variant="outline" asChild>
          <Link href="/dashboard/calendar">Otworz kalendarz</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard/employees">Lista pracownikow</Link>
        </Button>
      </div>
    </div>
  );
}
