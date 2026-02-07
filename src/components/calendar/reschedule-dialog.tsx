"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import type { CalendarEvent } from "@/types/calendar";

interface RescheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | null;
  newStartTime: Date | null;
  newEmployeeId: string | null;
  onConfirm: (notifyClient: boolean) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function RescheduleDialog({
  open,
  onOpenChange,
  event,
  newStartTime,
  newEmployeeId,
  onConfirm,
  onCancel,
  isLoading = false,
}: RescheduleDialogProps) {
  const [notifyClient, setNotifyClient] = useState(true);

  if (!event || !newStartTime) return null;

  const oldStart = new Date(event.start);
  const oldEnd = new Date(event.end);
  const duration = oldEnd.getTime() - oldStart.getTime();
  const newEnd = new Date(newStartTime.getTime() + duration);

  const formatDateTime = (date: Date) => {
    return date.toLocaleString("pl-PL", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString("pl-PL", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const hasEmployeeChanged = newEmployeeId && newEmployeeId !== event.employeeId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Potwierdz zmiane terminu</DialogTitle>
          <DialogDescription>
            Czy na pewno chcesz przesunac wizyte?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Appointment info */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="font-medium">{event.title}</div>
            {event.appointment.client && (
              <div className="text-sm text-muted-foreground">
                Klient: {event.appointment.client.firstName} {event.appointment.client.lastName}
              </div>
            )}
          </div>

          {/* Time change visualization */}
          <div className="grid grid-cols-[auto_1fr] gap-2 items-center text-sm">
            <span className="text-muted-foreground">Obecny termin:</span>
            <span className="font-medium line-through text-muted-foreground">
              {formatDateTime(oldStart)} - {formatTime(oldEnd)}
            </span>

            <span className="text-muted-foreground">Nowy termin:</span>
            <span className="font-medium text-primary">
              {formatDateTime(newStartTime)} - {formatTime(newEnd)}
            </span>
          </div>

          {hasEmployeeChanged && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 text-sm">
              <p className="text-amber-800 dark:text-amber-200">
                Wizyta zostanie przeniesiona do innego pracownika.
              </p>
            </div>
          )}

          {/* Notify client checkbox */}
          {event.appointment.client && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="notify-client"
                checked={notifyClient}
                onCheckedChange={(checked) => setNotifyClient(checked as boolean)}
              />
              <Label htmlFor="notify-client" className="text-sm cursor-pointer">
                Powiadom klienta o zmianie terminu (SMS)
              </Label>
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>
            Anuluj
          </Button>
          <Button onClick={() => onConfirm(notifyClient)} disabled={isLoading}>
            {isLoading ? "Zapisywanie..." : "Potwierdz zmiane"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
