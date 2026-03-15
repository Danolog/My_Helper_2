"use client";

import Link from "next/link";
import { ArrowLeft, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppointmentActions } from "./_components/appointment-actions";
import { AppointmentDateCard } from "./_components/appointment-date-card";
import { AppointmentNotesCard } from "./_components/appointment-notes-card";
import { CancelAppointmentDialog } from "./_components/cancel-appointment-dialog";
import { ErrorState } from "./_components/error-state";
import { LoadingState } from "./_components/loading-state";
import { ReceiptCard } from "./_components/receipt-card";
import { ReviewSection } from "./_components/review-section";
import { SalonInfoCard } from "./_components/salon-info-card";
import { ServiceInfoCard } from "./_components/service-info-card";
import { StatusBadge } from "./_components/status-badge";
import { TreatmentNotesCard } from "./_components/treatment-notes-card";
import { useAppointmentDetail } from "./_hooks/use-appointment-detail";
import { isUpcoming } from "./_types";

export default function AppointmentDetailPage() {
  const {
    appointment,
    loading,
    error,
    isPending,
    cancelDialogOpen,
    setCancelDialogOpen,
    cancelInfo,
    cancelLoading,
    cancelling,
    cancelError,
    handleCancelAppointment,
    existingReview,
    reviewLoading,
    showReviewForm,
    setShowReviewForm,
    reviewRating,
    setReviewRating,
    reviewHoverRating,
    setReviewHoverRating,
    reviewComment,
    setReviewComment,
    submittingReview,
    handleSubmitReview,
    resetReviewForm,
  } = useAppointmentDetail();

  if (isPending || loading) {
    return <LoadingState />;
  }

  if (error || !appointment) {
    return <ErrorState error={error} />;
  }

  const canCancel = isUpcoming(appointment.startTime, appointment.status);

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      {/* Back navigation */}
      <div className="mb-6">
        <Button variant="ghost" asChild>
          <Link href="/appointments">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Powrot do moich wizyt
          </Link>
        </Button>
      </div>

      {/* Header with status */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <Receipt className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Szczegoly wizyty</h1>
            <p className="text-sm text-muted-foreground">
              Zarezerwowano{" "}
              {new Date(appointment.createdAt).toLocaleDateString("pl-PL")}
            </p>
          </div>
        </div>
        <StatusBadge status={appointment.status} />
      </div>

      <AppointmentDateCard appointment={appointment} />
      <ServiceInfoCard appointment={appointment} />
      <ReceiptCard appointment={appointment} />
      <SalonInfoCard appointment={appointment} />

      {appointment.treatment && (
        <TreatmentNotesCard treatment={appointment.treatment} />
      )}

      {appointment.notes && (
        <AppointmentNotesCard notes={appointment.notes} />
      )}

      {appointment.status === "completed" && (
        <ReviewSection
          existingReview={existingReview}
          reviewLoading={reviewLoading}
          showReviewForm={showReviewForm}
          reviewRating={reviewRating}
          reviewHoverRating={reviewHoverRating}
          reviewComment={reviewComment}
          submittingReview={submittingReview}
          onShowReviewForm={() => setShowReviewForm(true)}
          onResetReviewForm={resetReviewForm}
          onSetRating={setReviewRating}
          onSetHoverRating={setReviewHoverRating}
          onSetComment={setReviewComment}
          onSubmitReview={handleSubmitReview}
        />
      )}

      <AppointmentActions
        appointment={appointment}
        canCancel={canCancel}
        onOpenCancelDialog={() => setCancelDialogOpen(true)}
      />

      <CancelAppointmentDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        cancelInfo={cancelInfo}
        cancelLoading={cancelLoading}
        cancelling={cancelling}
        cancelError={cancelError}
        onConfirmCancel={handleCancelAppointment}
      />
    </div>
  );
}
