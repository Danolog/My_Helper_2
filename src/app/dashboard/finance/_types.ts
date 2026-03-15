export interface CommissionRecord {
  id: string;
  employeeId: string;
  appointmentId: string;
  amount: string;
  percentage: string | null;
  paidAt: string | null;
  createdAt: string;
  employeeFirstName: string | null;
  employeeLastName: string | null;
  employeeColor: string | null;
  serviceName: string | null;
  servicePrice: string | null;
  clientFirstName: string | null;
  clientLastName: string | null;
  appointmentDate: string | null;
}

export interface EmployeeTotal {
  employeeId: string;
  firstName: string | null;
  lastName: string | null;
  color: string | null;
  commissionRate: string | null;
  totalAmount: string;
  commissionCount: number;
  avgPercentage: string;
}

export interface EmployeeRate {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  color: string | null;
  commissionRate: string | null;
  isActive: boolean;
}

export interface CommissionsData {
  commissions: CommissionRecord[];
  employeeTotals: EmployeeTotal[];
  summary: {
    totalCommissions: number;
    commissionCount: number;
    employeeCount: number;
  };
}
