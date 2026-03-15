"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { toast } from "sonner";
import { mutationFetch } from "@/lib/api-client";
import { useSession } from "@/lib/auth-client";
import type { AppointmentDetail, CancelInfo, ReviewInfo } from "../_types";

export function useAppointmentDetail() {
  const params = useParams();
  const appointmentId = params.id as string;
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const [appointment, setAppointment] = useState<AppointmentDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cancel dialog state
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelInfo, setCancelInfo] = useState<CancelInfo | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Review state
  const [existingReview, setExistingReview] = useState<ReviewInfo | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewHoverRating, setReviewHoverRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  // -----------------------------------------------------------------------
  // Fetch appointment data
  // -----------------------------------------------------------------------

  const fetchAppointment = useCallback(async () => {
    try {
      const res = await fetch(`/api/client/appointments/${appointmentId}`);
      const json = await res.json();
      if (json.success) {
        setAppointment(json.data);
      } else {
        setError(json.error || "Nie znaleziono wizyty");
      }
    } catch {
      setError("Blad ladowania danych wizyty");
    } finally {
      setLoading(false);
    }
  }, [appointmentId]);

  // -----------------------------------------------------------------------
  // Fetch existing review for this appointment
  // -----------------------------------------------------------------------

  const fetchReview = useCallback(async () => {
    setReviewLoading(true);
    try {
      const res = await fetch(
        `/api/client/appointments/${appointmentId}/review`,
      );
      const json = await res.json();
      if (json.success && json.data) {
        setExistingReview(json.data);
      }
    } catch {
      // Non-critical - silently fail
    } finally {
      setReviewLoading(false);
    }
  }, [appointmentId]);

  // -----------------------------------------------------------------------
  // Submit review
  // -----------------------------------------------------------------------

  const handleSubmitReview = async () => {
    if (reviewRating === 0) {
      toast.error("Wybierz ocene od 1 do 5 gwiazdek");
      return;
    }
    setSubmittingReview(true);
    try {
      const res = await mutationFetch(
        `/api/client/appointments/${appointmentId}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rating: reviewRating,
            comment: reviewComment.trim() || null,
          }),
        },
      );
      const json = await res.json();
      if (json.success) {
        toast.success("Opinia zostala dodana!", {
          description:
            "Dziekujemy za Twoja opinie. Opinia oczekuje na moderacje.",
        });
        setExistingReview(json.data);
        setShowReviewForm(false);
        setReviewRating(0);
        setReviewComment("");
      } else {
        toast.error("Nie udalo sie dodac opinii", {
          description: json.error,
        });
      }
    } catch {
      toast.error("Blad podczas dodawania opinii");
    } finally {
      setSubmittingReview(false);
    }
  };

  // -----------------------------------------------------------------------
  // Fetch cancellation info when dialog opens
  // -----------------------------------------------------------------------

  const fetchCancelInfo = useCallback(async () => {
    setCancelLoading(true);
    setCancelError(null);
    try {
      const res = await fetch(
        `/api/client/appointments/${appointmentId}/cancel`,
      );
      const data = await res.json();
      if (data.success) {
        setCancelInfo(data.data);
      } else {
        setCancelError(
          data.error || "Nie udalo sie pobrac informacji o anulowaniu",
        );
      }
    } catch {
      setCancelError("Blad polaczenia z serwerem");
    } finally {
      setCancelLoading(false);
    }
  }, [appointmentId]);

  // -----------------------------------------------------------------------
  // Handle the actual cancellation
  // -----------------------------------------------------------------------

  const handleCancelAppointment = async () => {
    setCancelling(true);
    try {
      const res = await mutationFetch(
        `/api/client/appointments/${appointmentId}/cancel`,
        {
          method: "POST",
        },
      );
      const data = await res.json();

      if (data.success) {
        const details = data.cancellationDetails;
        let description = "Twoja wizyta zostala pomyslnie anulowana.";

        if (details?.depositRefunded) {
          description += ` Zadatek ${details.depositAmount.toFixed(2)} PLN zostanie zwrocony.`;
        } else if (details?.depositForfeited) {
          description += ` Zadatek ${details.depositAmount.toFixed(2)} PLN nie podlega zwrotowi.`;
        }

        toast.success("Wizyta anulowana", { description });
        setCancelDialogOpen(false);
        // Refresh appointment data to show updated status
        fetchAppointment();
      } else {
        toast.error("Nie udalo sie anulowac wizyty", {
          description: data.error,
        });
      }
    } catch {
      toast.error("Blad podczas anulowania wizyty");
    } finally {
      setCancelling(false);
    }
  };

  // -----------------------------------------------------------------------
  // Effects
  // -----------------------------------------------------------------------

  // Redirect unauthenticated users and fetch appointment data
  useEffect(() => {
    if (!isPending && !session) {
      router.push("/login");
      return;
    }
    if (session) {
      fetchAppointment();
    }
  }, [session, isPending, router, fetchAppointment]);

  // Fetch review once appointment is loaded and is completed
  useEffect(() => {
    if (appointment?.status === "completed") {
      fetchReview();
    }
  }, [appointment?.status, fetchReview]);

  // Fetch cancellation info when dialog opens, reset when closed
  useEffect(() => {
    if (cancelDialogOpen) {
      fetchCancelInfo();
    } else {
      setCancelInfo(null);
      setCancelError(null);
    }
  }, [cancelDialogOpen, fetchCancelInfo]);

  // -----------------------------------------------------------------------
  // Reset review form helper
  // -----------------------------------------------------------------------

  const resetReviewForm = () => {
    setShowReviewForm(false);
    setReviewRating(0);
    setReviewComment("");
  };

  return {
    // Core data
    appointment,
    loading,
    error,
    isPending,

    // Cancel dialog
    cancelDialogOpen,
    setCancelDialogOpen,
    cancelInfo,
    cancelLoading,
    cancelling,
    cancelError,
    handleCancelAppointment,

    // Review
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
  };
}
