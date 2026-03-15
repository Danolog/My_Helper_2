"use client";

import dynamic from "next/dynamic";
import { PushNotificationManager } from "@/components/push-notification-manager";
import { NotificationsFilters } from "./_components/NotificationsFilters";
import { NotificationsHeader } from "./_components/NotificationsHeader";
import { NotificationsList } from "./_components/NotificationsList";
import { useNotificationsData } from "./_hooks/use-notifications-data";

const BirthdaySection = dynamic(
  () => import("./_components/BirthdaySection").then((m) => m.BirthdaySection),
);
const WeMissYouSection = dynamic(
  () => import("./_components/WeMissYouSection").then((m) => m.WeMissYouSection),
);

export default function NotificationsPage() {
  const {
    notifications,
    loading,
    error,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    total,
    birthdayClients,
    loadingBirthday,
    birthdayChecked,
    sendingBirthday,
    birthdayDiscount,
    setBirthdayDiscount,
    birthdaySettingsLoaded,
    birthdayGiftType,
    birthdayProductName,
    birthdayEnabled,
    inactiveClients,
    loadingInactive,
    inactiveChecked,
    sendingWeMissYou,
    inactiveDays,
    weMissYouEnabled,
    fetchNotifications,
    checkBirthdayClients,
    sendBirthdayNotifications,
    checkInactiveClients,
    sendWeMissYouNotifications,
  } = useNotificationsData();

  return (
    <div className="container mx-auto p-6">
      <NotificationsHeader
        total={total}
        onRefresh={fetchNotifications}
      />

      {/* Push Notification Settings */}
      <div className="mb-6">
        <PushNotificationManager />
      </div>

      <BirthdaySection
        birthdayClients={birthdayClients}
        loadingBirthday={loadingBirthday}
        birthdayChecked={birthdayChecked}
        sendingBirthday={sendingBirthday}
        birthdayDiscount={birthdayDiscount}
        onBirthdayDiscountChange={setBirthdayDiscount}
        birthdaySettingsLoaded={birthdaySettingsLoaded}
        birthdayGiftType={birthdayGiftType}
        birthdayProductName={birthdayProductName}
        birthdayEnabled={birthdayEnabled}
        onCheckBirthdays={checkBirthdayClients}
        onSendBirthday={sendBirthdayNotifications}
      />

      <WeMissYouSection
        inactiveClients={inactiveClients}
        loadingInactive={loadingInactive}
        inactiveChecked={inactiveChecked}
        sendingWeMissYou={sendingWeMissYou}
        inactiveDays={inactiveDays}
        weMissYouEnabled={weMissYouEnabled}
        onCheckInactive={checkInactiveClients}
        onSendWeMissYou={sendWeMissYouNotifications}
      />

      <NotificationsFilters
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />

      <NotificationsList
        notifications={notifications}
        loading={loading}
        error={error}
      />
    </div>
  );
}
