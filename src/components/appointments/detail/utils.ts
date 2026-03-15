/** Shared utility functions for appointment detail sub-components. */

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

export function getStatusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
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

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}min`;
}
