export interface ServiceBreakdown {
  serviceId: string;
  serviceName: string;
  count: number;
  revenue: string;
  commission: string;
}

export interface EmployeePayrollData {
  employeeId: string;
  employeeName: string;
  completedAppointments: number;
  hoursWorked: string;
  hoursWorkedMinutes: number;
  totalRevenue: string;
  totalCommission: string;
  paidCommission: string;
  unpaidCommission: string;
  avgCommissionRate: string;
  services: ServiceBreakdown[];
}

export interface ReportData {
  summary: {
    totalCompletedAppointments: number;
    totalHoursWorked: string;
    totalHoursWorkedMinutes: number;
    totalRevenue: string;
    totalCommission: string;
    paidCommission: string;
    unpaidCommission: string;
  };
  byEmployee: EmployeePayrollData[];
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
    employeeIds: string[] | null;
  };
}
