export interface Promotion {
  id: string;
  salonId: string;
  name: string;
  type: string;
  value: string;
  isActive: boolean;
}

export interface PromoCode {
  id: string;
  salonId: string;
  code: string;
  promotionId: string | null;
  usageLimit: number | null;
  usedCount: number | null;
  expiresAt: string | null;
  createdAt: string;
  promotion: Promotion | null;
}

export const TYPE_LABELS: Record<string, string> = {
  percentage: "Procentowa",
  fixed: "Kwotowa",
  package: "Pakiet",
  buy2get1: "2+1 gratis",
  happy_hours: "Happy Hours",
  first_visit: "Pierwsza wizyta",
};

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Brak";
  const d = new Date(dateStr);
  return d.toLocaleDateString("pl-PL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export function formatPromotionValue(type: string, value: string): string {
  const numVal = parseFloat(value);
  if (type === "percentage" || type === "buy2get1" || type === "happy_hours" || type === "first_visit") return `${numVal}%`;
  if (type === "fixed") return `${numVal.toFixed(2)} PLN`;
  if (type === "package") return `${numVal.toFixed(2)} PLN`;
  return value;
}
