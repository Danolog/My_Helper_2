"use client";

import Link from "next/link";
import { ArrowLeft, Settings, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BirthdaySettings } from "./_components/BirthdaySettings";
import { NotificationTypeSettings } from "./_components/NotificationTypeSettings";
import { WeMissYouSettings } from "./_components/WeMissYouSettings";
import { useNotificationSettings } from "./_hooks/use-notification-settings";

export default function NotificationSettingsPage() {
  const {
    loading,
    birthdaySettings,
    savingBirthday,
    birthdaySavedSuccessfully,
    updateBirthdaySetting,
    handleSaveBirthday,
    weMissYouSettings,
    savingWeMissYou,
    weMissYouSavedSuccessfully,
    updateWeMissYouSetting,
    handleSaveWeMissYou,
    channelSettings,
    savingChannels,
    channelsSavedSuccessfully,
    setChannelSettings,
    handleSaveChannels,
  } = useNotificationSettings();

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex justify-center items-center py-12">
          <div className="text-muted-foreground">Ladowanie ustawien...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Dashboard
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <Settings className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Ustawienia powiadomien</h1>
      </div>

      {/* Notification Channels Section */}
      <NotificationTypeSettings
        channelSettings={channelSettings}
        savingChannels={savingChannels}
        channelsSavedSuccessfully={channelsSavedSuccessfully}
        onChannelChange={setChannelSettings}
        onSave={handleSaveChannels}
      />

      {/* Birthday Gift Configuration Section */}
      <BirthdaySettings
        settings={birthdaySettings}
        saving={savingBirthday}
        savedSuccessfully={birthdaySavedSuccessfully}
        onUpdateSetting={updateBirthdaySetting}
        onSave={handleSaveBirthday}
      />

      {/* We Miss You Re-engagement Configuration Section */}
      <WeMissYouSettings
        settings={weMissYouSettings}
        saving={savingWeMissYou}
        savedSuccessfully={weMissYouSavedSuccessfully}
        onUpdateSetting={updateWeMissYouSetting}
        onSave={handleSaveWeMissYou}
      />

      {/* Link to notifications page */}
      <div className="mt-6 p-4 border rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium">Powiadomienia</div>
            <div className="text-sm text-muted-foreground">
              Przejdz do strony powiadomien, aby wyslac lub sprawdzic
              powiadomienia urodzinowe i re-engagement
            </div>
          </div>
          <Button variant="outline" asChild>
            <Link href="/dashboard/notifications">
              <MessageSquare className="w-4 h-4 mr-1" />
              Powiadomienia
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
