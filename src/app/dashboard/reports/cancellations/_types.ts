export interface ReasonBreakdown {
  reason: string;
  reasonLabel: string;
  count: number;
  percentage: string;
}

export interface EmployeeBreakdown {
  employeeId: string;
  employeeName: string;
  total: number;
  cancelled: number;
  noShow: number;
  rate: string;
}

export interface ServiceBreakdown {
  serviceId: string;
  serviceName: string;
  total: number;
  cancelled: number;
  noShow: number;
  rate: string;
  grossLostRevenue: string;
  replacedRevenue: string;
  netLostRevenue: string;
}

export interface DayOfWeekBreakdown {
  dayOfWeek: number;
  dayLabel: string;
  total: number;
  cancelled: number;
  rate: string;
}

export interface TrendPoint {
  date: string;
  total: number;
  cancelled: number;
  noShow: number;
  rate: string;
  grossLostRevenue: string;
  replacedRevenue: string;
  netLostRevenue: string;
}

export interface ComparisonData {
  period: {
    dateFrom: string;
    dateTo: string;
  };
  summary: {
    totalAppointments: number;
    cancellationCount: number;
    cancellationRate: string;
    cancelledCount: number;
    noShowCount: number;
    completedCount: number;
    grossLostRevenue: string;
    replacedRevenue: string;
    netLostRevenue: string;
    replacedCount: number;
    lostRevenue: string;
  };
  deltas: {
    netLostRevenue: string;
    netLostRevenuePercent: string;
    cancellationRate: string;
    cancellationCount: number;
    totalAppointments: number;
  };
}

export interface ReportData {
  summary: {
    totalAppointments: number;
    cancellationCount: number;
    cancellationRate: string;
    cancelledCount: number;
    noShowCount: number;
    completedCount: number;
    grossLostRevenue: string;
    replacedRevenue: string;
    netLostRevenue: string;
    replacedCount: number;
    lostRevenue: string;
  };
  byReason: ReasonBreakdown[];
  byEmployee: EmployeeBreakdown[];
  byService: ServiceBreakdown[];
  byDayOfWeek: DayOfWeekBreakdown[];
  trend: TrendPoint[];
  comparison: ComparisonData | null;
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
    compareDateFrom: string | null;
    compareDateTo: string | null;
  };
}

export type ActiveTab =
  | "lostrevenue"
  | "reason"
  | "employee"
  | "service"
  | "dayofweek"
  | "trend";

/** Get Tailwind text color class based on cancellation rate severity */
export function getRateColor(rate: string): string {
  const val = parseFloat(rate);
  if (val >= 30) return "text-red-600";
  if (val >= 15) return "text-orange-600";
  if (val >= 5) return "text-yellow-600";
  return "text-green-600";
}

/** Get Badge variant based on cancellation rate severity */
export function getRateBadge(
  rate: string,
): "destructive" | "secondary" | "outline" {
  const val = parseFloat(rate);
  if (val >= 30) return "destructive";
  if (val >= 15) return "secondary";
  return "outline";
}

/** Format a date string to short Polish locale (dd.MM) */
export function formatDateShort(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
  });
}
