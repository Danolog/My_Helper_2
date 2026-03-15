export interface ServiceBreakdown {
  serviceId: string;
  serviceName: string;
  count: number;
  revenue: string;
  avgPrice: string;
  share: string;
}

export interface EmployeeBreakdown {
  employeeId: string;
  employeeName: string;
  count: number;
  revenue: string;
  avgPrice: string;
  share: string;
}

export interface TrendPoint {
  date: string;
  revenue: string;
  count: number;
}

export interface ReportData {
  summary: {
    totalRevenue: string;
    totalAppointments: number;
    avgRevenuePerAppointment: string;
    totalDiscount: string;
  };
  byService: ServiceBreakdown[];
  byEmployee: EmployeeBreakdown[];
  trend: TrendPoint[];
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
    employeeIds: string[] | null;
  };
}

export type RevenueActiveTab = "service" | "employee" | "trend";
