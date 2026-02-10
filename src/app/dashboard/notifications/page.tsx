"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageSquare, RefreshCw, Filter } from "lucide-react";
import Link from "next/link";
import { PushNotificationManager } from "@/components/push-notification-manager";

interface Notification {
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

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [salonId, setSalonId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [total, setTotal] = useState(0);

  // Fetch salon ID first
  useEffect(() => {
    async function fetchSalonId() {
      try {
        const res = await fetch("/api/salons");
        const data = await res.json();
        if (data.success && data.data.length > 0) {
          setSalonId(data.data[0].id);
        }
      } catch (err) {
        console.error("Failed to fetch salon:", err);
        setError("Nie mozna zaladowac salonu");
        setLoading(false);
      }
    }
    fetchSalonId();
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!salonId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ salonId, limit: "50", offset: "0" });
      if (typeFilter) params.set("type", typeFilter);
      if (statusFilter) params.set("status", statusFilter);

      const res = await fetch(`/api/notifications?${params}`);
      const data = await res.json();
      if (data.success) {
        setNotifications(data.data.notifications);
        setTotal(data.data.total);
      } else {
        setError(data.error || "Blad ladowania powiadomien");
      }
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
      setError("Nie mozna zaladowac powiadomien");
    } finally {
      setLoading(false);
    }
  }, [salonId, typeFilter, statusFilter]);

  useEffect(() => {
    if (salonId) {
      fetchNotifications();
    }
  }, [salonId, fetchNotifications]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "sent":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
            Wyslano
          </span>
        );
      case "pending":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
            Oczekuje
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
            Blad
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
            {status}
          </span>
        );
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "sms":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
            SMS
          </span>
        );
      case "email":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
            Email
          </span>
        );
      case "push":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
            Push
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
            {type}
          </span>
        );
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Dashboard
          </Link>
        </Button>
      </div>

      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Powiadomienia</h1>
          <span className="text-muted-foreground text-sm">({total} laczne)</span>
        </div>
        <Button variant="outline" size="sm" onClick={fetchNotifications}>
          <RefreshCw className="w-4 h-4 mr-1" />
          Odswiez
        </Button>
      </div>

      {/* Push Notification Settings */}
      <div className="mb-6">
        <PushNotificationManager />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Filtry:</span>
        </div>
        <select
          className="border rounded-md px-3 py-1.5 text-sm bg-background"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">Wszystkie typy</option>
          <option value="sms">SMS</option>
          <option value="email">Email</option>
          <option value="push">Push</option>
        </select>
        <select
          className="border rounded-md px-3 py-1.5 text-sm bg-background"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Wszystkie statusy</option>
          <option value="sent">Wyslane</option>
          <option value="pending">Oczekujace</option>
          <option value="failed">Nieudane</option>
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="text-muted-foreground">Ladowanie powiadomien...</div>
        </div>
      ) : error ? (
        <div className="flex justify-center items-center py-12">
          <div className="text-red-500">{error}</div>
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <MessageSquare className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">Brak powiadomien</h3>
          <p className="text-muted-foreground">
            Powiadomienia SMS pojawia sie tutaj po potwierdzeniu platnosci.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <div
              key={n.id}
              className="border rounded-lg p-4 hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    {getTypeBadge(n.type)}
                    {getStatusBadge(n.status)}
                    {n.clientName && (
                      <span className="text-sm font-medium">{n.clientName}</span>
                    )}
                    {n.clientPhone && (
                      <span className="text-sm text-muted-foreground">
                        ({n.clientPhone})
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground break-words">{n.message}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                  {n.sentAt ? (
                    <div>Wyslano: {formatDate(n.sentAt)}</div>
                  ) : (
                    <div>Utworzono: {formatDate(n.createdAt)}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
