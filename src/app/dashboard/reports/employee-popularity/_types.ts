import type React from "react";
import { createElement } from "react";
import { Crown, Trophy, Star } from "lucide-react";

export interface TopService {
  name: string;
  count: number;
}

export interface EmployeePopularity {
  rank: number;
  employeeId: string;
  employeeName: string;
  color: string | null;
  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  noShowBookings: number;
  uniqueClients: number;
  returningClients: number;
  retentionRate: string;
  avgRating: string;
  reviewCount: number;
  revenue: string;
  topServices: TopService[];
  bookingShare: string;
}

export interface ReportData {
  employees: EmployeePopularity[];
  summary: {
    totalEmployees: number;
    totalBookings: number;
    avgRetentionRate: string;
    avgRating: string;
    totalRevenue: string;
  };
  filters: {
    salonId: string;
    dateFrom: string | null;
    dateTo: string | null;
  };
}

export function getRankIcon(rank: number): React.ReactNode {
  if (rank === 1) return createElement(Crown, { className: "h-5 w-5 text-yellow-500" });
  if (rank === 2) return createElement(Trophy, { className: "h-5 w-5 text-gray-400" });
  if (rank === 3) return createElement(Trophy, { className: "h-5 w-5 text-amber-700" });
  return createElement("span", {
    className: "text-sm font-bold text-muted-foreground w-5 text-center inline-block",
  }, rank);
}

export function getRankBadgeColor(rank: number): string {
  if (rank === 1) return "bg-yellow-100 text-yellow-800 border-yellow-300";
  if (rank === 2) return "bg-gray-100 text-gray-700 border-gray-300";
  if (rank === 3) return "bg-amber-100 text-amber-800 border-amber-300";
  return "bg-muted text-muted-foreground border-border";
}

export function renderStars(rating: number): React.ReactNode {
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.25;
  const stars: React.ReactNode[] = [];
  for (let i = 0; i < 5; i++) {
    if (i < fullStars) {
      stars.push(
        createElement(Star, { key: i, className: "h-3.5 w-3.5 fill-yellow-400 text-yellow-400" })
      );
    } else if (i === fullStars && hasHalf) {
      stars.push(
        createElement(Star, { key: i, className: "h-3.5 w-3.5 fill-yellow-400/50 text-yellow-400" })
      );
    } else {
      stars.push(
        createElement(Star, { key: i, className: "h-3.5 w-3.5 text-gray-300" })
      );
    }
  }
  return createElement("span", { className: "flex items-center gap-0.5" }, ...stars);
}
