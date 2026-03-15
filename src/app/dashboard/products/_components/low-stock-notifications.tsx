"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Bell } from "lucide-react";
import type { LowStockNotification } from "../_types";

interface LowStockNotificationsProps {
  notifications: LowStockNotification[];
}

export function LowStockNotifications({
  notifications,
}: LowStockNotificationsProps) {
  if (notifications.length === 0) return null;

  return (
    <Card className="mb-6" data-testid="low-stock-notifications">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Bell className="h-4 w-4 text-orange-500" />
          Ostatnie powiadomienia o niskim stanie
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {notifications.slice(0, 5).map((notif) => (
            <div
              key={notif.id}
              className="flex items-start gap-2 text-sm p-2 rounded-md bg-muted/50"
              data-testid={`notification-${notif.id}`}
            >
              <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm">
                  {notif.message.replace(/\[product:[^\]]+\]/, "").trim()}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(notif.sentAt || notif.createdAt).toLocaleString(
                    "pl-PL",
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
