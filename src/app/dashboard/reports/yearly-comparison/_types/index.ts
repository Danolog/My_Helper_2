export interface MetricData {
  totalRevenue: string;
  totalAppointments: number;
  avgRevenuePerAppointment: string;
  totalCancellations: number;
  cancellationRate: string;
  uniqueClients: number;
  newClients: number;
  topService: { name: string; count: number } | null;
  topEmployee: { name: string; count: number } | null;
  monthlyBreakdown: MonthEntry[];
}

export interface MonthEntry {
  month: number;
  monthLabel: string;
  revenue: string;
  appointments: number;
  cancellations: number;
}

export interface ChangeData {
  value: string;
  percent: string;
  direction: "up" | "down" | "neutral";
}

export interface MonthlyComparisonEntry {
  month: number;
  monthLabel: string;
  year1Revenue: string;
  year2Revenue: string;
  revenueChange: ChangeData;
  year1Appointments: number;
  year2Appointments: number;
  appointmentsChange: ChangeData;
}

export interface ComparisonData {
  year1: { label: string; year: number; metrics: MetricData };
  year2: { label: string; year: number; metrics: MetricData };
  changes: Record<string, ChangeData>;
  monthlyComparison: MonthlyComparisonEntry[];
}
