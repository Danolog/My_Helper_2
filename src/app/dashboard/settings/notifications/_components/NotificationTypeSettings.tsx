"use client";

import { Bell, CreditCard, Smartphone, Save, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { NotificationChannelSettings } from "../_types";

interface NotificationTypeSettingsProps {
  channelSettings: NotificationChannelSettings;
  savingChannels: boolean;
  channelsSavedSuccessfully: boolean;
  onChannelChange: React.Dispatch<
    React.SetStateAction<NotificationChannelSettings>
  >;
  onSave: () => Promise<void>;
}

export function NotificationTypeSettings({
  channelSettings,
  savingChannels,
  channelsSavedSuccessfully,
  onChannelChange,
  onSave,
}: NotificationTypeSettingsProps) {
  return (
    <div
      className="mb-6 border rounded-lg p-6 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800"
      data-testid="notification-channels-settings"
    >
      <div className="flex items-center gap-2 mb-4">
        <Bell className="w-5 h-5 text-blue-600" />
        <h2 className="text-xl font-semibold text-blue-800 dark:text-blue-300">
          Kanaly powiadomien
        </h2>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Wybierz jakie kanaly powiadomien maja byc aktywne dla Twojego salonu.
      </p>
      <div className="space-y-4">
        {/* SMS Reminders */}
        <div className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-lg border">
          <div className="flex items-center gap-3">
            <Smartphone className="w-5 h-5 text-blue-600" />
            <div>
              <div className="font-medium">Przypomnienia SMS</div>
              <div className="text-sm text-muted-foreground">
                Wysylaj SMS z przypomnieniem 1h przed wizyta
              </div>
            </div>
          </div>
          <Switch
            checked={channelSettings.smsReminders}
            onCheckedChange={(checked) =>
              onChannelChange((prev) => ({ ...prev, smsReminders: checked }))
            }
          />
        </div>
        {/* Push Reminders */}
        <div className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-lg border">
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-blue-600" />
            <div>
              <div className="font-medium">Powiadomienia Push</div>
              <div className="text-sm text-muted-foreground">
                Wysylaj push 1h i 24h przed wizyta
              </div>
            </div>
          </div>
          <Switch
            checked={channelSettings.pushReminders}
            onCheckedChange={(checked) =>
              onChannelChange((prev) => ({ ...prev, pushReminders: checked }))
            }
          />
        </div>
        {/* Payment Confirmations */}
        <div className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-lg border">
          <div className="flex items-center gap-3">
            <CreditCard className="w-5 h-5 text-blue-600" />
            <div>
              <div className="font-medium">Potwierdzenia platnosci</div>
              <div className="text-sm text-muted-foreground">
                Wysylaj potwierdzenia po oplaceniu zadatku
              </div>
            </div>
          </div>
          <Switch
            checked={channelSettings.paymentConfirmations}
            onCheckedChange={(checked) =>
              onChannelChange((prev) => ({
                ...prev,
                paymentConfirmations: checked,
              }))
            }
          />
        </div>
      </div>
      <div className="flex items-center gap-3 pt-4">
        <Button
          onClick={onSave}
          disabled={savingChannels}
          className="bg-blue-600 hover:bg-blue-700 text-white"
          data-testid="save-channels-settings-btn"
        >
          {savingChannels ? (
            "Zapisywanie..."
          ) : channelsSavedSuccessfully ? (
            <>
              <CheckCircle className="w-4 h-4 mr-1" />
              Zapisano!
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-1" />
              Zapisz ustawienia
            </>
          )}
        </Button>
        {channelsSavedSuccessfully && (
          <span
            className="text-sm text-green-600 font-medium"
            data-testid="channels-save-success-message"
          >
            Ustawienia zostaly zapisane pomyslnie
          </span>
        )}
      </div>
    </div>
  );
}
