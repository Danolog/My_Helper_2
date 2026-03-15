"use client";

import { Lock } from "lucide-react";
import { CalendarDialogs } from "./_components/calendar-dialogs";
import { CalendarGrid } from "./_components/calendar-grid";
import { CalendarToolbar } from "./_components/calendar-toolbar";
import { useCalendarData } from "./_hooks/use-calendar-data";
import { useCalendarNavigation } from "./_hooks/use-calendar-navigation";

export default function CalendarPage() {
  const nav = useCalendarNavigation();

  const {
    session,
    isPending,
    employees,
    events,
    workSchedules,
    timeBlocks,
    loading,
    fetchAppointments,
    fetchTimeBlocks,
    handleConfirmReschedule,
  } = useCalendarData({
    currentDate: nav.currentDate,
    currentView: nav.currentView,
  });

  // Compute filtered data
  const { filteredEmployees, filteredEvents, filteredTimeBlocks } =
    nav.getFilteredData(employees, events, timeBlocks);

  // Wrap reschedule confirm to coordinate between data and navigation hooks
  const onConfirmReschedule = async (notifyClient: boolean) => {
    nav.setIsRescheduling(true);
    const success = await handleConfirmReschedule(nav.pendingReschedule, notifyClient);
    nav.setIsRescheduling(false);
    if (success !== false) {
      nav.setRescheduleDialogOpen(false);
      nav.setPendingReschedule(null);
      nav.setDraggedEvent(null);
    }
  };

  if (isPending) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto text-center">
          <Lock className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Wymagane logowanie</h1>
          <p className="text-muted-foreground mb-6">
            Musisz sie zalogowac, aby uzyskac dostep do kalendarza
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-full">
      <CalendarToolbar
        currentView={nav.currentView}
        colorMode={nav.colorMode}
        selectedEmployeeFilter={nav.selectedEmployeeFilter}
        employees={employees}
        onViewChange={nav.setCurrentView}
        onEmployeeFilterChange={nav.setSelectedEmployeeFilter}
        onToggleColorMode={nav.toggleColorMode}
        onNewAppointment={() => nav.setNewAppointmentDialogOpen(true)}
        onBlockTime={() => nav.setBlockTimeDialogOpen(true)}
        onGoToPrevious={nav.goToPrevious}
        onGoToToday={nav.goToToday}
        onGoToNext={nav.goToNext}
      />

      <CalendarGrid
        currentDate={nav.currentDate}
        currentView={nav.currentView}
        loading={loading}
        colorMode={nav.colorMode}
        employees={employees}
        filteredEmployees={filteredEmployees}
        filteredEvents={filteredEvents}
        filteredTimeBlocks={filteredTimeBlocks}
        workSchedules={workSchedules}
        draggedEvent={nav.draggedEvent}
        dateDisplay={nav.formatDateDisplay(nav.currentDate)}
        onDragStart={nav.handleDragStart}
        onDragEnd={nav.handleDragEnd}
        onDrop={nav.handleDrop}
        onEventClick={nav.handleEventClick}
        onEventCancel={nav.handleEventCancel}
        onEventComplete={nav.handleEventComplete}
        onDayClick={(date) => { nav.setCurrentDate(date); nav.setCurrentView("day"); }}
      />

      <CalendarDialogs
        rescheduleDialogOpen={nav.rescheduleDialogOpen}
        onRescheduleOpenChange={nav.setRescheduleDialogOpen}
        pendingReschedule={nav.pendingReschedule}
        onConfirmReschedule={onConfirmReschedule}
        onCancelReschedule={nav.handleCancelReschedule}
        isRescheduling={nav.isRescheduling}
        newAppointmentDialogOpen={nav.newAppointmentDialogOpen}
        onNewAppointmentOpenChange={(v) => {
          nav.setNewAppointmentDialogOpen(v);
          if (!v) nav.setScheduleNextData(null);
        }}
        onAppointmentCreated={() => {
          fetchAppointments();
          nav.setScheduleNextData(null);
        }}
        defaultDate={nav.currentDate}
        scheduleNextData={nav.scheduleNextData}
        cancelDialogOpen={nav.cancelDialogOpen}
        onCancelDialogOpenChange={nav.setCancelDialogOpen}
        cancelAppointmentId={nav.cancelAppointmentId}
        onAppointmentCancelled={fetchAppointments}
        blockTimeDialogOpen={nav.blockTimeDialogOpen}
        onBlockTimeOpenChange={nav.setBlockTimeDialogOpen}
        employees={employees}
        onBlockCreated={() => {
          fetchTimeBlocks();
        }}
        completeDialogOpen={nav.completeDialogOpen}
        onCompleteDialogOpenChange={nav.setCompleteDialogOpen}
        completeAppointment={nav.completeAppointment}
        completeMaterials={nav.completeMaterials}
        onCompleted={() => {
          fetchAppointments();
        }}
        onScheduleNext={(data) => {
          nav.setScheduleNextData({
            clientId: data.clientId,
            serviceId: data.serviceId,
            employeeId: data.employeeId,
            suggestedDate: data.suggestedDate,
          });
          nav.setCompleteAppointment(null);
          nav.setNewAppointmentDialogOpen(true);
        }}
      />
    </div>
  );
}
