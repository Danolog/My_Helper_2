"use client";

import Link from "next/link";
import { Cake, Gift, Send, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BirthdayClient } from "../_types";

interface BirthdaySectionProps {
  birthdayClients: BirthdayClient[];
  loadingBirthday: boolean;
  birthdayChecked: boolean;
  sendingBirthday: boolean;
  birthdayDiscount: string;
  onBirthdayDiscountChange: (discount: string) => void;
  birthdaySettingsLoaded: boolean;
  birthdayGiftType: string;
  birthdayProductName: string;
  birthdayEnabled: boolean;
  onCheckBirthdays: () => void;
  onSendBirthday: () => void;
}

export function BirthdaySection({
  birthdayClients,
  loadingBirthday,
  birthdayChecked,
  sendingBirthday,
  birthdayDiscount,
  onBirthdayDiscountChange,
  birthdaySettingsLoaded,
  birthdayGiftType,
  birthdayProductName,
  birthdayEnabled,
  onCheckBirthdays,
  onSendBirthday,
}: BirthdaySectionProps) {
  return (
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
                  onChange={(e) => onBirthdayDiscountChange(e.target.value)}
                  className="w-20 border rounded px-2 py-1 text-sm bg-background"
                  data-testid="birthday-discount-input"
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            )}
            <Button
              size="sm"
              onClick={onSendBirthday}
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
          onClick={onCheckBirthdays}
          disabled={loadingBirthday}
          data-testid="check-birthdays-btn"
        >
          <Cake className="h-4 w-4 mr-1" />
          Sprawdz urodziny
        </Button>
      )}
    </div>
  );
}
