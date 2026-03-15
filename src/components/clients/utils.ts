/**
 * Utility functions shared across client detail page components.
 */

/**
 * Parses a comma-separated string into an array of trimmed, non-empty entries.
 */
export function parseCommaSeparated(str: string | null): string[] {
  if (!str) return [];
  return str
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Serializes an array of strings back to a comma-separated string,
 * or null if the array is empty.
 */
export function serializeCommaSeparated(items: string[]): string | null {
  if (items.length === 0) return null;
  return items.join(", ");
}

/**
 * Returns a Polish label for appointment status.
 */
export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    scheduled: "Zaplanowana",
    confirmed: "Potwierdzona",
    completed: "Zakonczona",
    cancelled: "Anulowana",
    no_show: "Nieobecnosc",
  };
  return labels[status] || status;
}

/**
 * Returns badge variant for appointment status.
 */
export function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "confirmed":
      return "secondary";
    case "cancelled":
    case "no_show":
      return "destructive";
    default:
      return "outline";
  }
}

/**
 * Formats a duration in minutes to a readable string.
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
}

/** Sentinel value for "no favorite employee" in the Select component. */
export const NO_FAVORITE = "__none__";
