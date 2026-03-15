import type React from "react";
import { createElement } from "react";

export interface Notification {
  id: string;
  salonId: string;
  clientId: string | null;
  type: string;
  message: string;
  sentAt: string | null;
  status: string;
  createdAt: string;
  clientName: string | null;
  clientPhone: string | null;
}

export interface BirthdayClient {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
}

export interface InactiveClient {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  lastVisitDate: string | null;
  daysSinceVisit: number;
}

export function getStatusBadge(status: string): React.ReactNode {
  switch (status) {
    case "sent":
      return createElement(
        "span",
        { className: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
        "Wyslano"
      );
    case "pending":
      return createElement(
        "span",
        { className: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
        "Oczekuje"
      );
    case "failed":
      return createElement(
        "span",
        { className: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
        "Blad"
      );
    default:
      return createElement(
        "span",
        { className: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200" },
        status
      );
  }
}

export function getTypeBadge(type: string): React.ReactNode {
  switch (type) {
    case "sms":
      return createElement(
        "span",
        { className: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
        "SMS"
      );
    case "email":
      return createElement(
        "span",
        { className: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
        "Email"
      );
    case "push":
      return createElement(
        "span",
        { className: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
        "Push"
      );
    default:
      return createElement(
        "span",
        { className: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800" },
        type
      );
  }
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
