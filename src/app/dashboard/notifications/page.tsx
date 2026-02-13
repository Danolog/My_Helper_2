"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageSquare, RefreshCw, Filter, Cake, Gift, Send, Settings, UserX, Calendar } from "lucide-react";
import { toast } from "sonner";
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

interface BirthdayClient {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  birthday: string | null;
}

interface InactiveClient {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  lastVisitDate: string | null;
  daysSinceVisit: number;
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [salonId, setSalonId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [total, setTotal] = useState(0);

  // Birthday notifications state
  const [birthdayClients, setBirthdayClients] = useState<BirthdayClient[]>([]);
  const [loadingBirthday, setLoadingBirthday] = useState(false);
  const [birthdayChecked, setBirthdayChecked] = useState(false);
  const [sendingBirthday, setSendingBirthday] = useState(false);
  const [birthdayDiscount, setBirthdayDiscount] = useState<string>("10");
  const [birthdaySettingsLoaded, setBirthdaySettingsLoaded] = useState(false);
  const [birthdayGiftType, setBirthdayGiftType] = useState<string>("discount");
  const [birthdayProductName, setBirthdayProductName] = useState<string>("");
  const [birthdayEnabled, setBirthdayEnabled] = useState(false);

  // We Miss You state
  const [inactiveClients, setInactiveClients] = useState<InactiveClient[]>([]);
  const [loadingInactive, setLoadingInactive] = useState(false);
  const [inactiveChecked, setInactiveChecked] = useState(false);
  const [sendingWeMissYou, setSendingWeMissYou] = useState(false);
  const [inactiveDays, setInactiveDays] = useState(30);
  const [weMissYouEnabled, setWeMissYouEnabled] = useState(false);

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

  // Check for birthday clients and load saved settings
  const checkBirthdayClients = useCallback(async () => {
    if (!salonId) return;
    setLoadingBirthday(true);
    try {
      const res = await fetch(`/api/notifications/birthday?salonId=${salonId}`);
      const data = await res.json();
      if (data.success) {
        setBirthdayClients(data.data.clients);
        setBirthdayChecked(true);
        // Load saved birthday settings
        if (data.data.birthdaySettings) {
          const saved = data.data.birthdaySettings;
          setBirthdayEnabled(saved.enabled || false);
          setBirthdayGiftType(saved.giftType || "discount");
          setBirthdayDiscount(String(saved.discountPercentage || 10));
          setBirthdayProductName(saved.productName || "");
          setBirthdaySettingsLoaded(true);
        }
        if (data.data.clients.length === 0) {
          toast.info("Brak klientow z urodzinami dzisiaj");
        }
      }
    } catch (err) {
      console.error("Failed to check birthdays:", err);
      toast.error("Blad sprawdzania urodzin");
    } finally {
      setLoadingBirthday(false);
    }
  }, [salonId]);

  // Auto-check birthdays when salonId is available
  useEffect(() => {
    if (salonId && !birthdayChecked) {
      checkBirthdayClients();
    }
  }, [salonId, birthdayChecked, checkBirthdayClients]);

  // Send birthday notifications
  const sendBirthdayNotifications = async () => {
    if (!salonId) return;
    setSendingBirthday(true);
    try {
      // Build request body using saved settings
      const requestBody: Record<string, unknown> = { salonId };
      if (birthdayGiftType === "discount") {
        requestBody.birthdayDiscount = birthdayDiscount ? parseInt(birthdayDiscount) : 0;
        requestBody.giftType = "discount";
      } else if (birthdayGiftType === "product") {
        requestBody.giftType = "product";
        requestBody.productName = birthdayProductName;
      }
      const res = await fetch("/api/notifications/birthday", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.data.message);
        // Refresh notifications list
        fetchNotifications();
        // Re-check birthdays
        checkBirthdayClients();
      } else {
        toast.error(data.error || "Blad wysylania powiadomien urodzinowych");
      }
    } catch (err) {
      console.error("Failed to send birthday notifications:", err);
      toast.error("Blad wysylania powiadomien");
    } finally {
      setSendingBirthday(false);
    }
  };

  // Check for inactive clients (We Miss You)
  const checkInactiveClients = useCallback(async () => {
    if (!salonId) return;
    setLoadingInactive(true);
    try {
      const res = await fetch(`/api/notifications/we-miss-you?salonId=${salonId}`);
      const data = await res.json();
      if (data.success) {
        setInactiveClients(data.data.clients);
        setInactiveChecked(true);
        setInactiveDays(data.data.inactiveDays || 30);
        if (data.data.weMissYouSettings) {
          setWeMissYouEnabled(data.data.weMissYouSettings.enabled || false);
        }
        if (data.data.clients.length === 0) {
          toast.info("Brak nieaktywnych klientow");
        }
      }
    } catch (err) {
      console.error("Failed to check inactive clients:", err);
      toast.error("Blad sprawdzania nieaktywnych klientow");
    } finally {
      setLoadingInactive(false);
    }
  }, [salonId]);

  // Auto-check inactive clients when salonId is available
  useEffect(() => {
    if (salonId && !inactiveChecked) {
      checkInactiveClients();
    }
  }, [salonId, inactiveChecked, checkInactiveClients]);

  // Send "We miss you" notifications
  const sendWeMissYouNotifications = async () => {
    if (!salonId) return;
    setSendingWeMissYou(true);
    try {
      const res = await fetch("/api/notifications/we-miss-you", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salonId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.data.message);
        fetchNotifications();
        checkInactiveClients();
      } else {
        toast.error(data.error || "Blad wysylania powiadomien");
      }
    } catch (err) {
      console.error("Failed to send we-miss-you notifications:", err);
      toast.error("Blad wysylania powiadomien");
    } finally {
      setSendingWeMissYou(false);
    }
  };

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

  /**
   * Render a notification message with URLs converted to clickable links.
   * Detects http:// and https:// URLs and renders them as anchor tags.
   */
  const renderMessageWithLinks = (message: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = message.split(urlRegex);

    if (parts.length === 1) {
      // No URLs found, return plain text
      return <>{message}</>;
    }

    return (
      <>
        {parts.map((part, index) => {
          if (urlRegex.test(part)) {
            // Reset regex lastIndex since we're reusing it
            urlRegex.lastIndex = 0;
            return (
              <a
                key={index}
                href={part}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline hover:text-primary/80 font-medium"
                data-testid="notification-booking-link"
              >
                {part}
              </a>
            );
          }
          return <span key={index}>{part}</span>;
        })}
      </>
    );
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

      {/* Birthday Notifications Section */}
      <div className="mb-6 border rounded-lg p-4 bg-pink-50 dark:bg-pink-950/20 border-pink-200 dark:border-pink-800" data-testid="birthday-notifications-section">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Cake className="w-5 h-5 text-pink-600" />
            <h2 className="text-lg font-semibold text-pink-800 dark:text-pink-300">
              Powiadomienia urodzinowe
            </h2>
            {birthdayEnabled && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                Wlaczone
              </span>
            )}
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/settings/notifications">
              <Settings className="w-4 h-4 mr-1" />
              Konfiguruj
            </Link>
          </Button>
        </div>

        {loadingBirthday ? (
          <div className="text-sm text-muted-foreground">Sprawdzanie urodzin...</div>
        ) : birthdayClients.length > 0 ? (
          <div>
            <div className="mb-3">
              <p className="text-sm text-pink-700 dark:text-pink-400 mb-2" data-testid="birthday-count-message">
                <Cake className="h-4 w-4 inline mr-1" />
                Dzisiaj urodziny obchodzi <strong>{birthdayClients.length}</strong>{" "}
                {birthdayClients.length === 1 ? "klient" : birthdayClients.length >= 2 && birthdayClients.length <= 4 ? "klientow" : "klientow"}:
              </p>
              <div className="space-y-1">
                {birthdayClients.map((client) => (
                  <div
                    key={client.id}
                    className="flex items-center gap-2 text-sm px-2 py-1 bg-white dark:bg-gray-900 rounded border border-pink-200 dark:border-pink-700"
                    data-testid={`birthday-client-${client.id}`}
                  >
                    <Cake className="h-3.5 w-3.5 text-pink-500 shrink-0" />
                    <span className="font-medium">{client.firstName} {client.lastName}</span>
                    {client.phone && <span className="text-muted-foreground">({client.phone})</span>}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {birthdaySettingsLoaded && (
                <div className="flex items-center gap-2 text-sm text-pink-700 dark:text-pink-400 mr-2">
                  <Gift className="h-4 w-4 text-pink-600" />
                  {birthdayGiftType === "discount" ? (
                    <span>Prezent: <strong>{birthdayDiscount}% rabatu</strong></span>
                  ) : (
                    <span>Prezent: <strong>{birthdayProductName || "Produkt"}</strong></span>
                  )}
                </div>
              )}
              {!birthdaySettingsLoaded && (
                <div className="flex items-center gap-2">
                  <Gift className="h-4 w-4 text-pink-600" />
                  <label htmlFor="birthday-discount" className="text-sm text-pink-700 dark:text-pink-400">
                    Rabat urodzinowy:
                  </label>
                  <input
                    id="birthday-discount"
                    type="number"
                    min="0"
                    max="100"
                    value={birthdayDiscount}
                    onChange={(e) => setBirthdayDiscount(e.target.value)}
                    className="w-20 border rounded px-2 py-1 text-sm bg-background"
                    data-testid="birthday-discount-input"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              )}
              <Button
                size="sm"
                onClick={sendBirthdayNotifications}
                disabled={sendingBirthday}
                className="bg-pink-600 hover:bg-pink-700 text-white"
                data-testid="send-birthday-notifications-btn"
              >
                <Send className="h-4 w-4 mr-1" />
                {sendingBirthday ? "Wysylanie..." : "Wyslij zyczenia"}
              </Button>
            </div>
          </div>
        ) : birthdayChecked ? (
          <p className="text-sm text-muted-foreground" data-testid="no-birthdays-message">
            Brak klientow z urodzinami dzisiaj
          </p>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={checkBirthdayClients}
            disabled={loadingBirthday}
            data-testid="check-birthdays-btn"
          >
            <Cake className="h-4 w-4 mr-1" />
            Sprawdz urodziny
          </Button>
        )}
      </div>

      {/* We Miss You Re-engagement Section */}
      <div className="mb-6 border rounded-lg p-4 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800" data-testid="we-miss-you-section">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <UserX className="w-5 h-5 text-amber-600" />
            <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-300">
              Tesknimy za Toba
            </h2>
            {weMissYouEnabled && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                Wlaczone
              </span>
            )}
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/settings/notifications">
              <Settings className="w-4 h-4 mr-1" />
              Konfiguruj
            </Link>
          </Button>
        </div>

        {loadingInactive ? (
          <div className="text-sm text-muted-foreground">Sprawdzanie nieaktywnych klientow...</div>
        ) : inactiveClients.length > 0 ? (
          <div>
            <div className="mb-3">
              <p className="text-sm text-amber-700 dark:text-amber-400 mb-2" data-testid="inactive-count-message">
                <Calendar className="h-4 w-4 inline mr-1" />
                Znaleziono <strong>{inactiveClients.length}</strong>{" "}
                nieaktywnych klientow (brak wizyty przez {inactiveDays}+ dni):
              </p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {inactiveClients.map((client) => (
                  <div
                    key={client.id}
                    className="flex items-center gap-2 text-sm px-2 py-1 bg-white dark:bg-gray-900 rounded border border-amber-200 dark:border-amber-700"
                    data-testid={`inactive-client-${client.id}`}
                  >
                    <UserX className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <span className="font-medium">{client.firstName} {client.lastName}</span>
                    <span className="text-muted-foreground text-xs">
                      ({client.daysSinceVisit} dni)
                    </span>
                    {client.lastVisitDate ? (
                      <span className="text-muted-foreground text-xs">
                        Ostatnia wizyta: {client.lastVisitDate}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs italic">
                        Brak wizyt
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onClick={sendWeMissYouNotifications}
                disabled={sendingWeMissYou}
                className="bg-amber-600 hover:bg-amber-700 text-white"
                data-testid="send-we-miss-you-btn"
              >
                <Send className="h-4 w-4 mr-1" />
                {sendingWeMissYou ? "Wysylanie..." : "Wyslij powiadomienia"}
              </Button>
              <span className="text-xs text-muted-foreground">
                Wiadomosc zawiera link do rezerwacji
              </span>
            </div>
          </div>
        ) : inactiveChecked ? (
          <p className="text-sm text-muted-foreground" data-testid="no-inactive-message">
            Brak nieaktywnych klientow (prog: {inactiveDays} dni)
          </p>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={checkInactiveClients}
            disabled={loadingInactive}
            data-testid="check-inactive-btn"
          >
            <UserX className="h-4 w-4 mr-1" />
            Sprawdz nieaktywnych
          </Button>
        )}
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
                  <p className="text-sm text-foreground break-words" data-testid="notification-message">{renderMessageWithLinks(n.message)}</p>
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
