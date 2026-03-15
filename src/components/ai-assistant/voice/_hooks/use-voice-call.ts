import { useState } from "react";
import { toast } from "sonner";
import type {
  VoiceAiConfig,
  CallSimulationResult,
  BookingResult,
  RescheduleResult,
  CancelResult,
  MessageResult,
  UseVoiceCallReturn,
} from "../types";

// ---------------------------------------------------------------------------
// Hook — manages all state and async handlers for the voice call panel.
// Extracted from the monolithic VoiceCallPanel component so that each
// sub-component can consume only the slice of state it needs.
// ---------------------------------------------------------------------------

interface UseVoiceCallOptions {
  config: VoiceAiConfig;
  onCallLogRefresh: () => void;
}

export function useVoiceCall({
  config,
  onCallLogRefresh,
}: UseVoiceCallOptions): UseVoiceCallReturn {
  // ---------------------------------------------------------------------------
  // Call simulation state
  // ---------------------------------------------------------------------------
  const [callerMessage, setCallerMessage] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [callResult, setCallResult] = useState<CallSimulationResult | null>(null);

  // ---------------------------------------------------------------------------
  // Voice booking flow state
  // ---------------------------------------------------------------------------
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [bookingPhone, setBookingPhone] = useState("");
  const [bookingName, setBookingName] = useState("");
  const [bookingInProgress, setBookingInProgress] = useState(false);
  const [bookingResult, setBookingResult] = useState<BookingResult | null>(null);
  const [showBookingForm, setShowBookingForm] = useState(false);

  // ---------------------------------------------------------------------------
  // Voice reschedule flow state
  // ---------------------------------------------------------------------------
  const [reschedulePhone, setReschedulePhone] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleAppointmentId, setRescheduleAppointmentId] = useState("");
  const [rescheduleInProgress, setRescheduleInProgress] = useState(false);
  const [rescheduleResult, setRescheduleResult] = useState<RescheduleResult | null>(null);
  const [showRescheduleForm, setShowRescheduleForm] = useState(false);

  // ---------------------------------------------------------------------------
  // Voice cancellation flow state
  // ---------------------------------------------------------------------------
  const [cancelPhone, setCancelPhone] = useState("");
  const [cancelAppointmentId, setCancelAppointmentId] = useState("");
  const [cancelInProgress, setCancelInProgress] = useState(false);
  const [cancelResult, setCancelResult] = useState<CancelResult | null>(null);
  const [showCancelForm, setShowCancelForm] = useState(false);

  // ---------------------------------------------------------------------------
  // Escalation message form state
  // ---------------------------------------------------------------------------
  const [msgName, setMsgName] = useState("");
  const [msgPhone, setMsgPhone] = useState("");
  const [msgText, setMsgText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageResult, setMessageResult] = useState<MessageResult | null>(null);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function simulateCall() {
    if (!callerMessage.trim()) return;
    if (!config.enabled) {
      toast.error("Asystent wylaczony", {
        description:
          "Wlacz asystenta glosowego AI w zakladce Konfiguracja, aby symulowac polaczenia.",
      });
      return;
    }

    setSimulating(true);
    setCallResult(null);
    setMessageResult(null);
    setMsgText("");
    try {
      const res = await fetch("/api/ai/voice/incoming", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerMessage: callerMessage.trim(),
          callerPhone: "+48 000 000 000",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setCallResult(data);
        setCallerMessage("");
        onCallLogRefresh();
        // Auto-show forms based on detected intent
        if (data.intent === "book_appointment") {
          setShowBookingForm(true);
          setBookingResult(null);
        }
        if (data.intent === "reschedule") {
          setShowRescheduleForm(true);
          setRescheduleResult(null);
        }
        if (data.intent === "cancel_appointment") {
          setShowCancelForm(true);
          setCancelResult(null);
        }
      } else {
        const data = await res.json();
        toast.error("Blad symulacji", {
          description: data.error || "Nie udalo sie przetworzyc polaczenia.",
        });
      }
    } catch {
      toast.error("Blad", {
        description: "Nie udalo sie polaczyc z serwerem.",
      });
    } finally {
      setSimulating(false);
    }
  }

  async function handleVoiceBooking() {
    if (!selectedServiceId) {
      toast.error("Wybierz usluge", {
        description: "Prosze wybrac usluge do rezerwacji.",
      });
      return;
    }

    if (!bookingPhone.trim()) {
      toast.error("Numer telefonu", {
        description: "Prosze podac numer telefonu dzwoniacego.",
      });
      return;
    }

    setBookingInProgress(true);
    setBookingResult(null);
    try {
      const res = await fetch("/api/ai/voice/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: selectedServiceId,
          preferredDate: bookingDate || undefined,
          preferredTime: bookingTime || undefined,
          callerPhone: bookingPhone.trim(),
          callerName: bookingName.trim() || undefined,
          notes: "Rezerwacja przez asystenta glosowego AI",
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setBookingResult(data);
        toast.success("Wizyta zarezerwowana!", {
          description: `${data.details.serviceName} u ${data.details.employeeName}, ${data.details.date} o ${data.details.time}`,
        });
        onCallLogRefresh();
      } else {
        toast.error("Nie udalo sie zarezerwowac", {
          description: data.error || "Prosze sprobowac inny termin.",
        });
      }
    } catch {
      toast.error("Blad", {
        description: "Nie udalo sie polaczyc z serwerem.",
      });
    } finally {
      setBookingInProgress(false);
    }
  }

  async function handleLeaveMessage() {
    if (!msgText.trim()) {
      toast.error("Wiadomosc wymagana", {
        description: "Prosze wpisac tresc wiadomosci.",
      });
      return;
    }
    if (!msgPhone.trim()) {
      toast.error("Numer telefonu wymagany", {
        description: "Prosze podac numer telefonu do kontaktu zwrotnego.",
      });
      return;
    }

    setSendingMessage(true);
    setMessageResult(null);
    try {
      const res = await fetch("/api/ai/voice/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerPhone: msgPhone.trim(),
          callerName: msgName.trim() || undefined,
          message: msgText.trim(),
          conversationId: callResult?.conversationId || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setMessageResult({
          success: true,
          referenceNumber: data.referenceNumber,
        });
        toast.success("Wiadomosc zapisana", {
          description: `Numer referencyjny: ${data.referenceNumber}`,
        });
        onCallLogRefresh();
      } else {
        toast.error("Blad", {
          description: data.error || "Nie udalo sie zapisac wiadomosci.",
        });
      }
    } catch {
      toast.error("Blad", {
        description: "Nie udalo sie polaczyc z serwerem.",
      });
    } finally {
      setSendingMessage(false);
    }
  }

  async function handleVoiceReschedule() {
    if (!reschedulePhone.trim()) {
      toast.error("Numer telefonu", {
        description: "Prosze podac numer telefonu klienta.",
      });
      return;
    }

    if (!rescheduleDate) {
      toast.error("Nowy termin", {
        description: "Prosze podac nowa preferowana date.",
      });
      return;
    }

    setRescheduleInProgress(true);
    setRescheduleResult(null);
    try {
      const res = await fetch("/api/ai/voice/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerPhone: reschedulePhone.trim(),
          appointmentId: rescheduleAppointmentId.trim() || undefined,
          preferredDate: rescheduleDate || undefined,
          preferredTime: rescheduleTime || undefined,
          notes: "Zmiana terminu przez asystenta glosowego AI",
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setRescheduleResult(data);
        toast.success("Termin zmieniony!", {
          description: `${data.details.serviceName}: ${data.details.oldDate} ${data.details.oldTime} → ${data.details.newDate} o ${data.details.newTime}`,
        });
        onCallLogRefresh();
      } else {
        toast.error("Nie udalo sie zmienic terminu", {
          description: data.error || "Prosze sprobowac inny termin.",
        });
      }
    } catch {
      toast.error("Blad", {
        description: "Nie udalo sie polaczyc z serwerem.",
      });
    } finally {
      setRescheduleInProgress(false);
    }
  }

  async function handleVoiceCancel() {
    if (!cancelPhone.trim()) {
      toast.error("Numer telefonu", {
        description: "Prosze podac numer telefonu klienta.",
      });
      return;
    }

    setCancelInProgress(true);
    setCancelResult(null);
    try {
      const res = await fetch("/api/ai/voice/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerPhone: cancelPhone.trim(),
          appointmentId: cancelAppointmentId.trim() || undefined,
          notes: "Anulacja wizyty przez asystenta glosowego AI",
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setCancelResult(data);
        toast.success("Wizyta anulowana!", {
          description: `${data.details.serviceName} u ${data.details.employeeName}, ${data.details.date} o ${data.details.time}`,
        });
        onCallLogRefresh();
      } else {
        toast.error("Nie udalo sie anulowac wizyty", {
          description: data.error || "Prosze sprobowac ponownie.",
        });
      }
    } catch {
      toast.error("Blad", {
        description: "Nie udalo sie polaczyc z serwerem.",
      });
    } finally {
      setCancelInProgress(false);
    }
  }

  return {
    // Call simulation
    callerMessage,
    setCallerMessage,
    simulating,
    callResult,
    simulateCall,

    // Booking flow
    selectedServiceId,
    setSelectedServiceId,
    bookingDate,
    setBookingDate,
    bookingTime,
    setBookingTime,
    bookingPhone,
    setBookingPhone,
    bookingName,
    setBookingName,
    bookingInProgress,
    bookingResult,
    setBookingResult,
    showBookingForm,
    setShowBookingForm,
    handleVoiceBooking,

    // Reschedule flow
    reschedulePhone,
    setReschedulePhone,
    rescheduleDate,
    setRescheduleDate,
    rescheduleTime,
    setRescheduleTime,
    rescheduleAppointmentId,
    setRescheduleAppointmentId,
    rescheduleInProgress,
    rescheduleResult,
    setRescheduleResult,
    showRescheduleForm,
    setShowRescheduleForm,
    handleVoiceReschedule,

    // Cancel flow
    cancelPhone,
    setCancelPhone,
    cancelAppointmentId,
    setCancelAppointmentId,
    cancelInProgress,
    cancelResult,
    setCancelResult,
    showCancelForm,
    setShowCancelForm,
    handleVoiceCancel,

    // Leave-message (escalation)
    msgName,
    setMsgName,
    msgPhone,
    setMsgPhone,
    msgText,
    setMsgText,
    sendingMessage,
    messageResult,
    handleLeaveMessage,
  };
}
