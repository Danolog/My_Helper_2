"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock,
  ArrowLeft,
  Bell,
  BellRing,
  Check,
  X,
  CalendarClock,
  User,
  Scissors,
  MapPin,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";
import { mutationFetch } from "@/lib/api-client";

interface WaitingListEntry {
  id: string;
  salonId: string;
  salonName: string;
  serviceId: string | null;
  serviceName: string | null;
  preferredEmployeeId: string | null;
  preferredEmployeeName: string | null;
  preferredDate: string | null;
  notifiedAt: string | null;
  accepted: boolean | null;
  offeredStartTime: string | null;
  offeredEndTime: string | null;
  offeredEmployeeId: string | null;
  offeredEmployeeName: string | null;
  existingAppointmentId: string | null;
  createdAt: string;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusInfo(entry: WaitingListEntry) {
  if (entry.accepted === true) {
    return {
      label: "Zaakceptowany",
      color: "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700",
      icon: Check,
    };
  }
  if (entry.accepted === false) {
    return {
      label: "Odrzucony",
      color: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700",
      icon: X,
    };
  }
  if (entry.notifiedAt) {
    return {
      label: "Dostepny termin!",
      color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700",
      icon: BellRing,
    };
  }
  return {
    label: "Oczekiwanie",
    color: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700",
    icon: Clock,
  };
}

export default function WaitingListPage() {
  const { data: session, isPending: sessionLoading } = useSession();
  const router = useRouter();
  const [entries, setEntries] = useState<WaitingListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch("/api/client/waiting-list");
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/portal");
          return;
        }
        throw new Error("Blad pobierania danych");
      }
      const data = await res.json();
      if (data.success) {
        setEntries(data.data);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!sessionLoading) {
      if (!session) {
        router.push("/portal");
      } else {
        fetchEntries();
      }
    }
  }, [session, sessionLoading, router, fetchEntries]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleAccept = async (entryId: string) => {
    setActionLoading(entryId);
    try {
      const res = await mutationFetch(`/api/client/waiting-list/${entryId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: true }),
      });
      const data = await res.json();
      if (data.success) {
        setToast({
          message: data.message || "Termin zostal zaakceptowany!",
          type: "success",
        });
        await fetchEntries();
      } else {
        setToast({
          message: data.error || "Nie udalo sie zaakceptowac terminu",
          type: "error",
        });
      }
    } catch (error) {
      setToast({
        message: "Wystapil blad podczas akceptacji terminu",
        type: "error",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDecline = async (entryId: string) => {
    setActionLoading(entryId);
    try {
      const res = await mutationFetch(`/api/client/waiting-list/${entryId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: false }),
      });
      const data = await res.json();
      if (data.success) {
        setToast({
          message: data.message || "Termin zostal odrzucony",
          type: "success",
        });
        await fetchEntries();
      } else {
        setToast({
          message: data.error || "Nie udalo sie odrzucic terminu",
          type: "error",
        });
      }
    } catch (error) {
      setToast({
        message: "Wystapil blad podczas odrzucania terminu",
        type: "error",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemove = async (entryId: string) => {
    setActionLoading(entryId);
    try {
      const res = await mutationFetch(`/api/client/waiting-list/${entryId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        setToast({
          message: "Usuniety z listy oczekujacych",
          type: "success",
        });
        await fetchEntries();
      } else {
        setToast({
          message: data.error || "Nie udalo sie usunac",
          type: "error",
        });
      }
    } catch (error) {
      setToast({
        message: "Wystapil blad podczas usuwania",
        type: "error",
      });
    } finally {
      setActionLoading(null);
    }
  };

  if (sessionLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // Split into notified (actionable) and pending/completed
  const notifiedEntries = entries.filter(
    (e) => e.notifiedAt && e.accepted === null
  );
  const pendingEntries = entries.filter(
    (e) => !e.notifiedAt && e.accepted === null
  );
  const completedEntries = entries.filter((e) => e.accepted !== null);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg text-white font-medium transition-all duration-300 ${
            toast.type === "success" ? "bg-green-600" : "bg-red-600"
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        {/* Header */}
        <div className="mb-6">
          <Link href="/appointments">
            <Button variant="ghost" size="sm" className="mb-2">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Moje wizyty
            </Button>
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Bell className="w-6 h-6" />
            Lista oczekujacych
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Otrzymuj powiadomienia o wczesniejszych dostepnych terminach
          </p>
        </div>

        {/* Notified entries - requiring action */}
        {notifiedEntries.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <BellRing className="w-5 h-5 text-amber-500" />
              Dostepne terminy ({notifiedEntries.length})
            </h2>
            <div className="space-y-4">
              {notifiedEntries.map((entry) => {
                const status = getStatusInfo(entry);
                const StatusIcon = status.icon;
                return (
                  <Card
                    key={entry.id}
                    className="border-amber-200 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/10"
                  >
                    <CardContent className="p-4 sm:p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <Badge variant="outline" className={status.color}>
                            <StatusIcon className="w-3 h-3 mr-1" />
                            {status.label}
                          </Badge>
                        </div>
                      </div>

                      {/* Salon info */}
                      <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-2">
                        <MapPin className="w-4 h-4 text-gray-400" />
                        <span className="font-medium">{entry.salonName}</span>
                      </div>

                      {/* Service info */}
                      {entry.serviceName && (
                        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-2">
                          <Scissors className="w-4 h-4 text-gray-400" />
                          <span>{entry.serviceName}</span>
                        </div>
                      )}

                      {/* Offered slot details */}
                      {entry.offeredStartTime && (
                        <div className="mt-3 p-3 bg-white dark:bg-gray-800 rounded-lg border border-amber-200 dark:border-amber-700">
                          <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-2">
                            Proponowany wczesniejszy termin:
                          </p>
                          <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-1">
                            <CalendarClock className="w-4 h-4 text-amber-500" />
                            <span className="font-semibold">
                              {formatDate(entry.offeredStartTime)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-1">
                            <Clock className="w-4 h-4 text-amber-500" />
                            <span className="font-semibold">
                              {formatTime(entry.offeredStartTime)} - {formatTime(entry.offeredEndTime!)}
                            </span>
                          </div>
                          {entry.offeredEmployeeName && (
                            <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                              <User className="w-4 h-4 text-amber-500" />
                              <span>{entry.offeredEmployeeName}</span>
                            </div>
                          )}
                          {entry.existingAppointmentId && (
                            <div className="mt-2 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                              <ArrowRight className="w-3 h-3" />
                              <span>
                                Twoja istniejaca wizyta zostanie przeniesiona na
                                ten termin
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Accept / Decline buttons */}
                      <div className="mt-4 flex gap-3">
                        <Button
                          onClick={() => handleAccept(entry.id)}
                          disabled={actionLoading === entry.id}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                        >
                          {actionLoading === entry.id ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                          ) : (
                            <Check className="w-4 h-4 mr-1" />
                          )}
                          Akceptuj termin
                        </Button>
                        <Button
                          onClick={() => handleDecline(entry.id)}
                          disabled={actionLoading === entry.id}
                          variant="outline"
                          className="flex-1 border-red-200 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                        >
                          {actionLoading === entry.id ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                          ) : (
                            <X className="w-4 h-4 mr-1" />
                          )}
                          Odrzuc
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Pending entries - waiting for notification */}
        {pendingEntries.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-500" />
              Oczekujace ({pendingEntries.length})
            </h2>
            <div className="space-y-3">
              {pendingEntries.map((entry) => {
                const status = getStatusInfo(entry);
                const StatusIcon = status.icon;
                return (
                  <Card key={entry.id}>
                    <CardContent className="p-4 sm:p-5">
                      <div className="flex items-start justify-between mb-2">
                        <Badge variant="outline" className={status.color}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {status.label}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemove(entry.id)}
                          disabled={actionLoading === entry.id}
                          className="text-gray-400 hover:text-red-500 text-xs"
                        >
                          {actionLoading === entry.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <X className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-1">
                        <MapPin className="w-4 h-4 text-gray-400" />
                        <span className="font-medium">{entry.salonName}</span>
                      </div>
                      {entry.serviceName && (
                        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-1">
                          <Scissors className="w-4 h-4 text-gray-400" />
                          <span>{entry.serviceName}</span>
                        </div>
                      )}
                      {entry.preferredEmployeeName && (
                        <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mb-1">
                          <User className="w-4 h-4 text-gray-400" />
                          <span>{entry.preferredEmployeeName}</span>
                        </div>
                      )}
                      <p className="text-xs text-gray-400 mt-2">
                        Dodano: {formatDate(entry.createdAt)}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Completed entries */}
        {completedEntries.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
              Historia ({completedEntries.length})
            </h2>
            <div className="space-y-3">
              {completedEntries.map((entry) => {
                const status = getStatusInfo(entry);
                const StatusIcon = status.icon;
                return (
                  <Card key={entry.id} className="opacity-75">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Badge variant="outline" className={status.color}>
                            <StatusIcon className="w-3 h-3 mr-1" />
                            {status.label}
                          </Badge>
                          <div className="text-sm">
                            <span className="text-gray-600 dark:text-gray-400">
                              {entry.salonName}
                            </span>
                            {entry.serviceName && (
                              <span className="text-gray-400 dark:text-gray-500">
                                {" "}
                                - {entry.serviceName}
                              </span>
                            )}
                          </div>
                        </div>
                        {entry.offeredStartTime && (
                          <span className="text-xs text-gray-400">
                            {formatDate(entry.offeredStartTime)}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {entries.length === 0 && (
          <div className="text-center py-16">
            <Bell className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-600 dark:text-gray-400">
              Brak wpisow na liscie oczekujacych
            </h3>
            <p className="text-gray-400 dark:text-gray-500 mt-2 max-w-md mx-auto">
              Mozesz dopisac sie do listy oczekujacych podczas rezerwacji wizyty.
              Gdy zwolni sie wczesniejszy termin, otrzymasz powiadomienie.
            </p>
            <Link href="/appointments">
              <Button variant="outline" className="mt-4">
                <ArrowLeft className="w-4 h-4 mr-1" />
                Wroc do wizyt
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
