"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  Clock,
  MapPin,
  User,
  ArrowLeft,
  Scissors,
  ChevronRight,
  CalendarCheck,
  CalendarX,
  AlertCircle,
  CheckCircle2,
  Timer,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth-client";

interface ClientAppointment {
  id: string;
  salonId: string;
  salonName: string;
  salonAddress: string | null;
  employeeName: string;
  employeeColor: string | null;
  serviceName: string;
  servicePrice: string | null;
  serviceDuration: number | null;
  startTime: string;
  endTime: string;
  status: string;
  notes: string | null;
  depositAmount: string | null;
  depositPaid: boolean | null;
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

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) return `${hours}h`;
  return `${hours}h ${remaining}min`;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "scheduled":
      return (
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700">
          <Timer className="w-3 h-3 mr-1" />
          Zaplanowana
        </Badge>
      );
    case "confirmed":
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700">
          <CalendarCheck className="w-3 h-3 mr-1" />
          Potwierdzona
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Zakonczona
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700">
          <CalendarX className="w-3 h-3 mr-1" />
          Anulowana
        </Badge>
      );
    case "no_show":
      return (
        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700">
          <AlertCircle className="w-3 h-3 mr-1" />
          Nieobecnosc
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function isUpcoming(startTime: string): boolean {
  return new Date(startTime) > new Date();
}

export default function ClientAppointmentsPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [appointments, setAppointments] = useState<ClientAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"upcoming" | "past">("upcoming");

  const fetchAppointments = useCallback(async () => {
    try {
      const res = await fetch("/api/client/appointments");
      const json = await res.json();
      if (json.success) {
        setAppointments(json.data);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/login");
      return;
    }
    if (session) {
      fetchAppointments();
    }
  }, [session, isPending, router, fetchAppointments]);

  const upcomingAppointments = appointments.filter(
    (a) => isUpcoming(a.startTime) && a.status !== "cancelled" && a.status !== "completed" && a.status !== "no_show"
  );

  const pastAppointments = appointments.filter(
    (a) => !isUpcoming(a.startTime) || a.status === "cancelled" || a.status === "completed" || a.status === "no_show"
  );

  const displayedAppointments = activeTab === "upcoming" ? upcomingAppointments : pastAppointments;

  if (isPending || loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      {/* Back navigation */}
      <div className="mb-6">
        <Button variant="ghost" asChild>
          <Link href="/salons">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Powrot do salonow
          </Link>
        </Button>
      </div>

      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <CalendarDays className="w-8 h-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Moje wizyty</h1>
          <p className="text-muted-foreground text-sm">
            Historia i nadchodzace wizyty
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6" data-testid="appointments-tabs">
        <Button
          variant={activeTab === "upcoming" ? "default" : "outline"}
          onClick={() => setActiveTab("upcoming")}
          data-testid="tab-upcoming"
        >
          <CalendarCheck className="w-4 h-4 mr-2" />
          Nadchodzace ({upcomingAppointments.length})
        </Button>
        <Button
          variant={activeTab === "past" ? "default" : "outline"}
          onClick={() => setActiveTab("past")}
          data-testid="tab-past"
        >
          <Clock className="w-4 h-4 mr-2" />
          Historia ({pastAppointments.length})
        </Button>
      </div>

      {/* Appointment list */}
      {displayedAppointments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CalendarDays className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold mb-2">
              {activeTab === "upcoming"
                ? "Nie masz nadchodzacych wizyt"
                : "Brak historii wizyt"}
            </h2>
            <p className="text-muted-foreground mb-4">
              {activeTab === "upcoming"
                ? "Zarezerwuj wizyte w jednym z naszych salonow."
                : "Twoja historia wizyt pojawi sie tutaj."}
            </p>
            <Button asChild>
              <Link href="/salons">Przegladaj salony</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="appointments-list">
          {displayedAppointments.map((apt) => (
            <Link
              key={apt.id}
              href={`/appointments/${apt.id}`}
              className="block"
              data-testid={`appointment-card-${apt.id}`}
            >
              <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Date & Time row */}
                      <div className="flex items-center gap-2 mb-2">
                        <CalendarDays className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm font-semibold">
                          {formatDate(apt.startTime)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm">
                          {formatTime(apt.startTime)} - {formatTime(apt.endTime)}
                        </span>
                        {apt.serviceDuration && (
                          <span className="text-xs text-muted-foreground">
                            ({formatDuration(apt.serviceDuration)})
                          </span>
                        )}
                      </div>

                      {/* Service name */}
                      <div className="flex items-center gap-2 mb-1">
                        <Scissors className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm font-medium">{apt.serviceName}</span>
                        {apt.servicePrice && (
                          <Badge variant="secondary" className="text-xs">
                            {parseFloat(apt.servicePrice).toFixed(0)} PLN
                          </Badge>
                        )}
                      </div>

                      {/* Employee */}
                      <div className="flex items-center gap-2 mb-1">
                        <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <div className="flex items-center gap-1.5">
                          {apt.employeeColor && (
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: apt.employeeColor }}
                            />
                          )}
                          <span className="text-sm text-muted-foreground">
                            {apt.employeeName}
                          </span>
                        </div>
                      </div>

                      {/* Salon */}
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm text-muted-foreground truncate">
                          {apt.salonName}
                        </span>
                      </div>

                      {/* Deposit info */}
                      {apt.depositAmount && parseFloat(apt.depositAmount) > 0 && (
                        <div className="flex items-center gap-2 mt-1">
                          <Wallet className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <span className="text-xs text-muted-foreground">
                            Zadatek: {parseFloat(apt.depositAmount).toFixed(0)} PLN
                            {apt.depositPaid ? (
                              <span className="text-green-600 dark:text-green-400 ml-1">(oplacony)</span>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400 ml-1">(oczekujacy)</span>
                            )}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Right side: status + arrow */}
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      {getStatusBadge(apt.status)}
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
