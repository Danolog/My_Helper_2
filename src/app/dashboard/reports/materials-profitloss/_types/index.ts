export interface ProductProfitSummary {
  productId: string;
  productName: string;
  category: string | null;
  unit: string | null;
  pricePerUnit: string | null;
  currentStock: string | null;
  totalQuantityUsed: number;
  totalMaterialCost: string;
  attributedRevenue: string;
  profitLoss: string;
  profitMargin: string;
  usageCount: number;
  avgCostPerUse: string;
  avgRevenuePerUse: string;
}

export interface DetailRecord {
  id: string;
  product: {
    id: string;
    name: string;
    category: string | null;
    unit: string | null;
    pricePerUnit: string | null;
  };
  quantityUsed: string;
  materialCost: string;
  attributedRevenue: string;
  profitLoss: string;
  date: string;
  appointment: {
    id: string;
    date: string;
    status: string;
  };
  employee: string | null;
  service: string | null;
}

export interface ReportTotals {
  totalMaterialCost: string;
  totalRevenue: string;
  totalProfitLoss: string;
  profitMargin: string;
  totalUsages: number;
  uniqueProducts: number;
  profitableProducts: number;
  lossProducts: number;
}

export interface ReportData {
  summary: ProductProfitSummary[];
  details: DetailRecord[];
  totals: ReportTotals;
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
  };
}

export type ActiveTab = "summary" | "details";

/** Get Tailwind text color class based on profit margin severity */
export function getMarginColor(margin: number): string {
  if (margin >= 70) return "text-green-700";
  if (margin >= 50) return "text-green-600";
  if (margin >= 30) return "text-yellow-600";
  if (margin >= 0) return "text-orange-600";
  return "text-red-600";
}

/** Format a date string to Polish locale with date and time */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("pl-PL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
