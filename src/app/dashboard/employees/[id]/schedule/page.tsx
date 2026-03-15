"use client";

import { use } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ScheduleGrid } from "./_components/schedule-grid";
import { ScheduleHeader } from "./_components/schedule-header";
import { ScheduleTimeBlocks } from "./_components/schedule-time-blocks";
import { useScheduleData } from "./_hooks/use-schedule-data";

export default function EmployeeSchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: employeeId } = use(params);

  const {
    session,
    isPending,
    employee,
    loading,
    saving,
    saved,
    timeBlocksList,
    loadingBlocks,
    showAddVacation,
    newVacation,
    savingVacation,
    deletingBlockId,
    orderedSchedule,
    workingDays,
    upcomingBlocks,
    pastBlocks,
    setShowAddVacation,
    setNewVacation,
    handleTimeChange,
    handleDayOffToggle,
    handleSave,
    handleAddVacation,
    handleDeleteBlock,
    formatBlockDateRange,
  } = useScheduleData(employeeId);

  // Show loading/auth/not-found states via ScheduleHeader
  if (isPending || loading || !session || !employee) {
    return (
      <ScheduleHeader
        employee={employee}
        workingDays={workingDays}
        isPending={isPending}
        loading={loading}
        session={session}
      />
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-3xl">
      <ScheduleHeader
        employee={employee}
        workingDays={workingDays}
        isPending={isPending}
        loading={loading}
        session={session}
      />

      <ScheduleGrid
        orderedSchedule={orderedSchedule}
        saving={saving}
        saved={saved}
        onTimeChange={handleTimeChange}
        onDayOffToggle={handleDayOffToggle}
        onSave={handleSave}
      />

      <ScheduleTimeBlocks
        timeBlocksList={timeBlocksList}
        loadingBlocks={loadingBlocks}
        showAddVacation={showAddVacation}
        newVacation={newVacation}
        savingVacation={savingVacation}
        deletingBlockId={deletingBlockId}
        upcomingBlocks={upcomingBlocks}
        pastBlocks={pastBlocks}
        onShowAddVacation={setShowAddVacation}
        onNewVacationChange={setNewVacation}
        onAddVacation={handleAddVacation}
        onDeleteBlock={handleDeleteBlock}
        formatBlockDateRange={formatBlockDateRange}
      />

      {/* Quick actions */}
      <div className="mt-6 flex gap-4">
        <Button variant="outline" asChild>
          <Link href="/dashboard/calendar">Otworz kalendarz</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard/employees">Lista pracownikow</Link>
        </Button>
      </div>
    </div>
  );
}
