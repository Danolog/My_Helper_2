"use client";

import Link from "next/link";
import { UserX, Settings, Calendar, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InactiveClient } from "../_types";

interface WeMissYouSectionProps {
  inactiveClients: InactiveClient[];
  loadingInactive: boolean;
  inactiveChecked: boolean;
  sendingWeMissYou: boolean;
  inactiveDays: number;
  weMissYouEnabled: boolean;
  onCheckInactive: () => void;
  onSendWeMissYou: () => void;
}

export function WeMissYouSection({
  inactiveClients,
  loadingInactive,
  inactiveChecked,
  sendingWeMissYou,
  inactiveDays,
  weMissYouEnabled,
  onCheckInactive,
  onSendWeMissYou,
}: WeMissYouSectionProps) {
  return (
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
              onClick={onSendWeMissYou}
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
          onClick={onCheckInactive}
          disabled={loadingInactive}
          data-testid="check-inactive-btn"
        >
          <UserX className="h-4 w-4 mr-1" />
          Sprawdz nieaktywnych
        </Button>
      )}
    </div>
  );
}
