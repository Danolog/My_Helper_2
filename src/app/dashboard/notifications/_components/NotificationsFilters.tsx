"use client";

import { Filter } from "lucide-react";

interface NotificationsFiltersProps {
  typeFilter: string;
  onTypeFilterChange: (filter: string) => void;
  statusFilter: string;
  onStatusFilterChange: (filter: string) => void;
}

export function NotificationsFilters({
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
}: NotificationsFiltersProps) {
  return (
    <div className="flex items-center gap-4 mb-6 flex-wrap">
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Filtry:</span>
      </div>
      <select
        className="border rounded-md px-3 py-1.5 text-sm bg-background"
        value={typeFilter}
        onChange={(e) => onTypeFilterChange(e.target.value)}
      >
        <option value="">Wszystkie typy</option>
        <option value="sms">SMS</option>
        <option value="email">Email</option>
        <option value="push">Push</option>
      </select>
      <select
        className="border rounded-md px-3 py-1.5 text-sm bg-background"
        value={statusFilter}
        onChange={(e) => onStatusFilterChange(e.target.value)}
      >
        <option value="">Wszystkie statusy</option>
        <option value="sent">Wyslane</option>
        <option value="pending">Oczekujace</option>
        <option value="failed">Nieudane</option>
      </select>
    </div>
  );
}
