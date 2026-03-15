export interface ServiceProfit {
  serviceId: string;
  serviceName: string;
  baseDuration: number;
  appointmentCount: number;
  totalRevenue: string;
  totalMaterialCost: string;
  totalLaborCost: string;
  totalProfit: string;
  profitMargin: string;
  avgRevenue: string;
  avgMaterialCost: string;
  avgLaborCost: string;
  avgProfit: string;
  revenueShare: string;
}

export interface ReportData {
  summary: {
    totalRevenue: string;
    totalMaterialCost: string;
    totalLaborCost: string;
    totalProfit: string;
    profitMargin: string;
    totalAppointments: number;
  };
  byService: ServiceProfit[];
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
  };
}
