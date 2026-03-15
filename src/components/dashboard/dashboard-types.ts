// Shared types and helpers for dashboard components

export interface UserSalon {
  id: string;
  name: string;
}

export interface TodayAppointment {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  clientName: string;
  clientPhone: string | null;
  employeeId: string;
  employeeName: string;
  employeeColor: string | null;
  serviceName: string;
  servicePrice: number;
  serviceDuration: number;
}

export interface EmployeeToday {
  id: string;
  firstName: string;
  lastName: string;
  color: string | null;
  role: string;
  isWorkingToday: boolean;
  workStart: string | null;
  workEnd: string | null;
  appointmentCount: number;
}

export interface CancellationStats {
  totalThisMonth: number;
  cancelledThisMonth: number;
  noShowThisMonth: number;
  cancellationRate: number;
}

export interface Last30DaysStats {
  totalAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  revenue: number;
  avgPerDay: number;
  newClients: number;
}

export interface DashboardStats {
  todayAppointments: TodayAppointment[];
  employeesToday: EmployeeToday[];
  cancellationStats: CancellationStats;
  last30Days: Last30DaysStats;
}

/** Props shared by components that display stats data */
export interface StatsProps {
  stats: DashboardStats | null;
  statsLoading: boolean;
  statsError: string | null;
}

// ────────────────────────────────────────────────────────────
// Helper: format time from ISO string
// ────────────────────────────────────────────────────────────

export function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

// ────────────────────────────────────────────────────────────
// Status badge color mapping
// ────────────────────────────────────────────────────────────

export const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  confirmed: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  completed: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  no_show: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

export const STATUS_LABELS: Record<string, string> = {
  scheduled: "Zaplanowana",
  confirmed: "Potwierdzona",
  completed: "Zakonczona",
  cancelled: "Anulowana",
  no_show: "Nieobecnosc",
};
