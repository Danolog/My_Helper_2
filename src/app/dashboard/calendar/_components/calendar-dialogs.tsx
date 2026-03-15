"use client";

import dynamic from "next/dynamic";
import type { CalendarEvent, Employee } from "@/types/calendar";

// Lazy-load dialog components (only rendered when user triggers an action)
const RescheduleDialog = dynamic(
  () => import("@/components/calendar/reschedule-dialog").then((m) => ({ default: m.RescheduleDialog })),
  { ssr: false },
);

const NewAppointmentDialog = dynamic(
  () => import("@/components/appointments/new-appointment-dialog").then((m) => ({ default: m.NewAppointmentDialog })),
  { ssr: false },
);

const CancelAppointmentDialog = dynamic(
  () => import("@/components/appointments/cancel-appointment-dialog").then((m) => ({ default: m.CancelAppointmentDialog })),
  { ssr: false },
);

const CompleteAppointmentDialog = dynamic(
  () => import("@/components/appointments/complete-appointment-dialog").then((m) => ({ default: m.CompleteAppointmentDialog })),
  { ssr: false },
);

const BlockTimeDialog = dynamic(
  () => import("@/components/calendar/block-time-dialog").then((m) => ({ default: m.BlockTimeDialog })),
  { ssr: false },
);

interface CalendarDialogsProps {
  // Reschedule
  rescheduleDialogOpen: boolean;
  onRescheduleOpenChange: (open: boolean) => void;
  pendingReschedule: {
    event: CalendarEvent;
    newStartTime: Date;
    newEmployeeId: string;
  } | null;
  onConfirmReschedule: (notifyClient: boolean) => void;
  onCancelReschedule: () => void;
  isRescheduling: boolean;

  // New appointment
  newAppointmentDialogOpen: boolean;
  onNewAppointmentOpenChange: (open: boolean) => void;
  onAppointmentCreated: () => void;
  defaultDate: Date;
  scheduleNextData: {
    clientId: string;
    serviceId: string;
    employeeId: string;
    suggestedDate: string;
  } | null;

  // Cancel
  cancelDialogOpen: boolean;
  onCancelDialogOpenChange: (open: boolean) => void;
  cancelAppointmentId: string | null;
  onAppointmentCancelled: () => void;

  // Block time
  blockTimeDialogOpen: boolean;
  onBlockTimeOpenChange: (open: boolean) => void;
  employees: Employee[];
  onBlockCreated: () => void;

  // Complete
  completeDialogOpen: boolean;
  onCompleteDialogOpenChange: (open: boolean) => void;
  completeAppointment: CalendarEvent["appointment"] | null;
  completeMaterials: Array<{
    id: string;
    product: {
      name: string;
      pricePerUnit: string | null;
      unit: string | null;
    } | null;
    quantityUsed: string;
  }>;
  onCompleted: () => void;
  onScheduleNext: (data: {
    clientId: string;
    serviceId: string;
    employeeId: string;
    suggestedDate: string;
  }) => void;
}

export function CalendarDialogs({
  rescheduleDialogOpen,
  onRescheduleOpenChange,
  pendingReschedule,
  onConfirmReschedule,
  onCancelReschedule,
  isRescheduling,
  newAppointmentDialogOpen,
  onNewAppointmentOpenChange,
  onAppointmentCreated,
  defaultDate,
  scheduleNextData,
  cancelDialogOpen,
  onCancelDialogOpenChange,
  cancelAppointmentId,
  onAppointmentCancelled,
  blockTimeDialogOpen,
  onBlockTimeOpenChange,
  employees,
  onBlockCreated,
  completeDialogOpen,
  onCompleteDialogOpenChange,
  completeAppointment,
  completeMaterials,
  onCompleted,
  onScheduleNext,
}: CalendarDialogsProps) {
  return (
    <>
      {/* Reschedule confirmation dialog */}
      <RescheduleDialog
        open={rescheduleDialogOpen}
        onOpenChange={onRescheduleOpenChange}
        event={pendingReschedule?.event || null}
        newStartTime={pendingReschedule?.newStartTime || null}
        newEmployeeId={pendingReschedule?.newEmployeeId || null}
        onConfirm={onConfirmReschedule}
        onCancel={onCancelReschedule}
        isLoading={isRescheduling}
      />

      {/* New appointment dialog */}
      <NewAppointmentDialog
        open={newAppointmentDialogOpen}
        onOpenChange={onNewAppointmentOpenChange}
        onAppointmentCreated={onAppointmentCreated}
        defaultDate={defaultDate}
        defaultClientId={scheduleNextData?.clientId}
        defaultServiceId={scheduleNextData?.serviceId}
        defaultEmployeeId={scheduleNextData?.employeeId || undefined}
        defaultDateString={scheduleNextData?.suggestedDate}
        title={scheduleNextData ? "Nastepna wizyta" : undefined}
      />

      {/* Cancel appointment dialog */}
      <CancelAppointmentDialog
        open={cancelDialogOpen}
        onOpenChange={onCancelDialogOpenChange}
        appointmentId={cancelAppointmentId}
        onAppointmentCancelled={onAppointmentCancelled}
      />

      {/* Block time dialog (Feature #36) */}
      <BlockTimeDialog
        open={blockTimeDialogOpen}
        onOpenChange={onBlockTimeOpenChange}
        employees={employees}
        defaultDate={defaultDate}
        onBlockCreated={onBlockCreated}
      />

      {/* Complete appointment dialog */}
      {completeAppointment && (
        <CompleteAppointmentDialog
          open={completeDialogOpen}
          onOpenChange={onCompleteDialogOpenChange}
          appointment={{
            id: completeAppointment.id,
            employeeId: completeAppointment.employeeId,
            status: completeAppointment.status,
            service: completeAppointment.service ? {
              id: completeAppointment.service.id,
              name: completeAppointment.service.name,
              basePrice: completeAppointment.service.basePrice,
              baseDuration: completeAppointment.service.baseDuration,
              suggestedNextVisitDays: completeAppointment.service.suggestedNextVisitDays ?? null,
            } : null,
            employee: completeAppointment.employee ? {
              id: completeAppointment.employee.id,
              firstName: completeAppointment.employee.firstName,
              lastName: completeAppointment.employee.lastName,
            } : null,
            client: completeAppointment.client ? {
              id: completeAppointment.client.id,
              firstName: completeAppointment.client.firstName,
              lastName: completeAppointment.client.lastName,
            } : null,
          }}
          materials={completeMaterials}
          onCompleted={onCompleted}
          onScheduleNext={onScheduleNext}
        />
      )}
    </>
  );
}
