// ────────────────────────────────────────────────────────────
// Shared types for the Trends Analysis page
// ────────────────────────────────────────────────────────────

export type TrendDirection = "up" | "down" | "stable";

export type InsightType = "positive" | "negative" | "info";

export interface Insight {
  type: InsightType;
  message: string;
}

export interface RevenueTrends {
  currentMonth: number;
  previousMonth: number;
  changePercent: number;
  trend: TrendDirection;
  weeklyCurrentRevenue: number;
  weeklyPreviousRevenue: number;
  weeklyChangePercent: number;
  weeklyTrend: TrendDirection;
  monthlyBreakdown: { month: string; revenue: number }[];
}

export interface AppointmentTrends {
  currentMonth: number;
  previousMonth: number;
  changePercent: number;
  trend: TrendDirection;
  weeklyCurrentCount: number;
  weeklyPreviousCount: number;
  weeklyChangePercent: number;
  weeklyTrend: TrendDirection;
}

export interface ClientTrends {
  newClientsThisMonth: number;
  newClientsPrevMonth: number;
  changePercent: number;
  trend: TrendDirection;
  totalClients: number;
  returningClientsThisMonth: number;
  returningClientsPrevMonth: number;
}

export interface ServiceTrend {
  serviceName: string;
  currentCount: number;
  previousCount: number;
  changePercent: number;
  trend: TrendDirection;
}

export interface EmployeeTrend {
  employeeName: string;
  currentRevenue: number;
  previousRevenue: number;
  changePercent: number;
  trend: TrendDirection;
}

export interface CancellationTrends {
  currentRate: number;
  previousRate: number;
  trend: TrendDirection;
}

export interface RatingTrends {
  currentAvg: number;
  previousAvg: number;
  currentCount: number;
  previousCount: number;
  trend: TrendDirection;
}

export interface Period {
  currentMonth: string;
  previousMonth: string;
  currentWeek: string;
  previousWeek: string;
}

export interface TrendsData {
  period: Period;
  revenue: RevenueTrends;
  appointments: AppointmentTrends;
  clients: ClientTrends;
  servicePopularity: ServiceTrend[];
  employeePerformance: EmployeeTrend[];
  cancellations: CancellationTrends;
  ratings: RatingTrends;
  insights: Insight[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}
