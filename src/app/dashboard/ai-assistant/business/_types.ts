// ────────────────────────────────────────────────────────────
// Shared types and constants for the Business Assistant page
// ────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

export interface AnalyticsData {
  generatedAt: string;
  period: string;
  overview: {
    totalClients: number;
    totalEmployees: number;
    totalServices: number;
    newClientsThisMonth: number;
  };
  appointments: {
    last30Days: number;
    previous30Days: number;
    growthPercent: string;
    byStatus: Record<string, number>;
    cancellationRate: string;
  };
  revenue: {
    last30Days: number;
    previous30Days: number;
    growthPercent: string;
    currency: string;
  };
  topServices: { serviceName: string; servicePrice: string; count: number }[];
  topEmployees: {
    firstName: string;
    lastName: string;
    count: number;
  }[];
  reviews: {
    averageRating: string;
    totalReviews: number;
    recent: {
      rating: number;
      comment: string | null;
      status: string;
      createdAt: string;
    }[];
  };
  inventory: {
    lowStockProducts: {
      name: string;
      quantity: string;
      minQuantity: string | null;
      unit: string | null;
    }[];
    lowStockCount: number;
  };
}

export interface BusinessAlertData {
  id: string;
  severity: "critical" | "warning" | "info";
  category: string;
  title: string;
  problem: string;
  impact: string;
  suggestions: string[];
  metric: {
    label: string;
    current: number | string;
    previous: number | string;
    changePercent: number;
    unit: string;
  };
  actionHref?: string;
  actionLabel?: string;
}

export interface Suggestion {
  id: string;
  type: "warning" | "opportunity" | "action" | "insight";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  metric?: string;
  actionLabel?: string;
  actionHref?: string;
}

export interface ReviewAlertData {
  id: string;
  reviewId: string;
  rating: number;
  comment: string | null;
  clientName: string;
  employeeName: string;
  serviceName: string;
  appointmentDate: string | null;
  createdAt: string;
  severity: "critical" | "warning";
  suggestedResponse: string;
  responseType: "ai" | "template";
}

// ────────────────────────────────────────────────────────────
// Style constants for alert severity levels
// ────────────────────────────────────────────────────────────

export const SEVERITY_STYLES: Record<
  string,
  {
    border: string;
    bg: string;
    icon: string;
    badge: string;
    badgeText: string;
  }
> = {
  critical: {
    border: "border-red-300 dark:border-red-800",
    bg: "bg-red-50 dark:bg-red-950/50",
    icon: "text-red-600 dark:text-red-400",
    badge: "bg-red-600 text-white",
    badgeText: "Krytyczny",
  },
  warning: {
    border: "border-orange-300 dark:border-orange-800",
    bg: "bg-orange-50 dark:bg-orange-950/50",
    icon: "text-orange-600 dark:text-orange-400",
    badge: "bg-orange-500 text-white",
    badgeText: "Ostrzezenie",
  },
  info: {
    border: "border-blue-200 dark:border-blue-800",
    bg: "bg-blue-50 dark:bg-blue-950/50",
    icon: "text-blue-600 dark:text-blue-400",
    badge: "bg-blue-500 text-white",
    badgeText: "Informacja",
  },
};

export const DEFAULT_SEVERITY_STYLE = {
  border: "border-blue-200 dark:border-blue-800",
  bg: "bg-blue-50 dark:bg-blue-950/50",
  icon: "text-blue-600 dark:text-blue-400",
  badge: "bg-blue-500 text-white",
  badgeText: "Informacja",
};

// ────────────────────────────────────────────────────────────
// Style constants for suggestion types and priorities
// ────────────────────────────────────────────────────────────

export const SUGGESTION_COLORS: Record<string, string> = {
  warning: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950",
  opportunity:
    "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950",
  action:
    "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950",
  insight:
    "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950",
};

export const SUGGESTION_ICON_COLORS: Record<string, string> = {
  warning: "text-red-600 dark:text-red-400",
  opportunity: "text-green-600 dark:text-green-400",
  action: "text-blue-600 dark:text-blue-400",
  insight: "text-yellow-600 dark:text-yellow-400",
};

export const PRIORITY_BADGES: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  medium:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  low: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export const PRIORITY_LABELS: Record<string, string> = {
  high: "Wysoki",
  medium: "Sredni",
  low: "Niski",
};

// ────────────────────────────────────────────────────────────
// Suggested prompts for the AI chat
// ────────────────────────────────────────────────────────────

export const SUGGESTED_PROMPTS = [
  "Jak wyglada wydajnosc mojego salonu?",
  "Ktore uslugi sa najpopularniejsze?",
  "Jak moge zwiekszyc przychody?",
  "Jaki jest wskaznik anulacji i jak go poprawic?",
  "Jakie sa aktualne trendy w mojej branzy?",
  "Jak wypadam na tle konkurencji i jak sie wyrozniac?",
];
