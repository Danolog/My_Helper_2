"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Wallet } from "lucide-react";
import { useSalonRole } from "@/components/dashboard/role-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTabSync } from "@/hooks/use-tab-sync";
import type { SalonRole } from "@/lib/salon-context";
import { formatTime } from "./dashboard-types";

/** Role, ktore moga oznaczyc zadatek albo anulowac wizyte — tylko one widza liste. */
const DEPOSITS_PENDING_ROLES: readonly SalonRole[] = ["owner", "receptionist"];

const DEPOSITS_PENDING_ERROR = "Nie udalo sie pobrac wizyt czekajacych na zadatek";

/** Pola wiersza z GET /api/appointments, z ktorych korzysta karta. */
interface PendingDepositAppointment {
  id: string;
  startTime: string;
  status: string;
  depositAmount: string | null;
  depositPaid: boolean;
  guestName?: string | null;
  client: { firstName: string; lastName: string } | null;
  service: { name: string } | null;
}

interface AppointmentsResponse {
  success?: boolean;
  data?: unknown;
  error?: unknown;
}

/**
 * Karta pulpitu z nadchodzacymi wizytami, ktore czekaja na wplate zadatku.
 * Rezerwacja z zadatkiem bez wplaty trzyma termin bez konca, wiec wlasciciel
 * i recepcja musza widziec takie wizyty w jednym miejscu. Bez takich wizyt
 * karta nie renderuje sie wcale.
 */
export function DashboardDepositsPending() {
  const role = useSalonRole();
  const canSee = DEPOSITS_PENDING_ROLES.includes(role);
  const [appointments, setAppointments] = useState<PendingDepositAppointment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    // Nowe pobranie (np. ze zdarzenia kanalu) przerywa poprzednie, zeby starsza
    // odpowiedz nie nadpisala nowszej.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    // Stan ustawiamy dopiero w callbacku odpowiedzi, nie synchronicznie w efekcie.
    return fetchPendingDeposits(controller.signal).then((result) => {
      if (result === null || controller.signal.aborted) return;
      if (result.ok) {
        setError(null);
        setAppointments(result.appointments);
      } else {
        setError(result.error);
      }
    });
  }, []);

  useEffect(() => {
    if (!canSee) return;
    void load();
    return () => controllerRef.current?.abort();
  }, [canSee, load]);

  // Ten sam kanal, ktory powiadamia przycisk oznaczenia wplaty — oznaczona
  // wizyta znika z listy bez przeladowania strony.
  const refetch = useCallback(() => {
    if (canSee) void load();
  }, [canSee, load]);
  useTabSync("appointments", refetch);

  if (!canSee) return null;
  if (!error && appointments.length === 0) return null;

  return (
    <Card className="mb-6" data-testid="deposits-pending">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wallet className="h-5 w-5 text-primary" />
            Czekaja na zadatek
            {!error && (
              <Badge variant="secondary" className="text-xs" data-testid="deposits-pending-count">
                {appointments.length}
              </Badge>
            )}
          </CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/calendar">
              Otworz kalendarz
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive py-4">{error}</p>
        ) : (
          <div className="space-y-2">
            {appointments.map((appt) => (
              <div
                key={appt.id}
                className="flex items-center gap-3 p-3 rounded-lg border bg-card"
                data-testid="deposits-pending-row"
              >
                <div className="shrink-0 text-center min-w-[60px]">
                  <div className="text-sm font-semibold">{formatTime(appt.startTime)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatDate(appt.startTime)}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{clientLabel(appt)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {appt.service?.name ?? "Usluga"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold">
                    {parseFloat(appt.depositAmount ?? "0").toFixed(2)} PLN
                  </div>
                  <div className="text-[10px] text-muted-foreground">zadatek</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type LoadResult =
  | { ok: true; appointments: PendingDepositAppointment[] }
  | { ok: false; error: string };

/**
 * Pobiera wizyty od poczatku dzisiejszego dnia i zostawia te, ktore czekaja na
 * zadatek, posortowane po czasie. null = zapytanie przerwane (odmontowanie albo
 * nowsze pobranie) — wtedy stanu nie zmieniamy.
 */
async function fetchPendingDeposits(signal: AbortSignal): Promise<LoadResult | null> {
  try {
    const res = await fetch(
      `/api/appointments?startDate=${encodeURIComponent(startOfToday().toISOString())}`,
      { signal }
    );
    const body = await readJson(res);
    if (signal.aborted) return null;

    if (!res.ok || body?.success !== true || !Array.isArray(body.data)) {
      return { ok: false, error: errorMessage(body) };
    }

    return {
      ok: true,
      appointments: (body.data as PendingDepositAppointment[])
        .filter(isDepositPending)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    };
  } catch (e) {
    if (signal.aborted || (e instanceof Error && e.name === "AbortError")) return null;
    return { ok: false, error: DEPOSITS_PENDING_ERROR };
  }
}

/**
 * Wizyta czeka na zadatek. Kwota zadatku tym samym wyrazeniem co znacznik w
 * kalendarzu i karta zadatku w oknie wizyty, zeby trzy widoki sie nie rozjechaly.
 */
function isDepositPending(appt: PendingDepositAppointment): boolean {
  const hasDeposit = Boolean(appt.depositAmount && parseFloat(appt.depositAmount) > 0);
  return (
    hasDeposit &&
    appt.depositPaid === false &&
    (appt.status === "scheduled" || appt.status === "confirmed")
  );
}

/** Poczatek dzisiejszego dnia w strefie przegladarki — dzisiejsze wizyty tez sie licza. */
function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });
}

/** Rezerwacja goscia nie ma rekordu klienta — wtedy pokazujemy imie z rezerwacji. */
function clientLabel(appt: PendingDepositAppointment): string {
  if (appt.client) return `${appt.client.firstName} ${appt.client.lastName}`.trim();
  return appt.guestName?.trim() || "Klient";
}

/** Odpowiedz bledu (np. strona 500 z proxy) nie musi byc JSON-em. */
async function readJson(res: Response): Promise<AppointmentsResponse | null> {
  try {
    return (await res.json()) as AppointmentsResponse;
  } catch {
    return null;
  }
}

function errorMessage(body: AppointmentsResponse | null): string {
  if (typeof body?.error === "string" && body.error.trim() !== "") {
    return body.error;
  }
  return DEPOSITS_PENDING_ERROR;
}
