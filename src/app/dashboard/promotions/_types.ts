import type React from "react";
import { createElement } from "react";
import {
  Percent,
  DollarSign,
  Package,
  Gift,
  Clock,
  UserPlus,
} from "lucide-react";

export interface Promotion {
  id: string;
  salonId: string;
  name: string;
  type: string;
  value: string;
  startDate: string | null;
  endDate: string | null;
  conditionsJson: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

export interface Service {
  id: string;
  name: string;
  basePrice: string;
  baseDuration: number;
  isActive: boolean;
}

export const TYPE_LABELS: Record<string, string> = {
  percentage: "Procentowa",
  fixed: "Kwotowa",
  package: "Pakiet",
  buy2get1: "2+1 gratis",
  happy_hours: "Happy Hours",
  first_visit: "Pierwsza wizyta",
};

export const TYPE_ICONS: Record<string, React.ReactNode> = {
  percentage: createElement(Percent, { className: "w-4 h-4" }),
  fixed: createElement(DollarSign, { className: "w-4 h-4" }),
  package: createElement(Package, { className: "w-4 h-4" }),
  buy2get1: createElement(Gift, { className: "w-4 h-4" }),
  happy_hours: createElement(Clock, { className: "w-4 h-4" }),
  first_visit: createElement(UserPlus, { className: "w-4 h-4" }),
};

export const DAY_NAMES_PL = ["Nd", "Pn", "Wt", "Sr", "Cz", "Pt", "Sb"];
export const DAY_FULL_NAMES_PL = ["Niedziela", "Poniedzialek", "Wtorek", "Sroda", "Czwartek", "Piatek", "Sobota"];

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Brak";
  const d = new Date(dateStr);
  return d.toLocaleDateString("pl-PL", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function formatValue(type: string, value: string): string {
  const numVal = parseFloat(value);
  if (type === "percentage") return `${numVal}%`;
  if (type === "fixed") return `${numVal.toFixed(2)} PLN`;
  if (type === "buy2get1") return `${numVal}% zn. na 3.`;
  if (type === "happy_hours") return `-${numVal}%`;
  if (type === "first_visit") return `-${numVal}%`;
  if (type === "package") return `${numVal.toFixed(2)} PLN`;
  return value;
}

export function isExpired(endDate: string | null): boolean {
  if (!endDate) return false;
  return new Date(endDate) < new Date();
}

export function isUpcoming(startDate: string | null): boolean {
  if (!startDate) return false;
  return new Date(startDate) > new Date();
}

/** Validate the value field based on promotion type */
export function validateValueField(value: string, type: string): string {
  if (!value || value.trim() === "") {
    return "Podaj wartosc rabatu, np. 10 (dla 10% lub 10 PLN)";
  }
  const numVal = parseFloat(value);
  if (isNaN(numVal)) {
    return "Wartosc musi byc liczba. Wpisz np. 10 lub 25.50";
  }
  if (numVal < 0) {
    return "Wartosc rabatu nie moze byc ujemna. Wpisz liczbe wieksza od 0";
  }
  if (numVal === 0) {
    return "Wartosc musi byc wieksza od zera. Wpisz np. 5, 10 lub 20";
  }
  const isPercentageType = type === "percentage" || type === "buy2get1" || type === "happy_hours" || type === "first_visit";
  if (isPercentageType && numVal > 100) {
    return "Rabat procentowy nie moze przekraczac 100%. Wpisz wartosc od 1 do 100";
  }
  return "";
}
