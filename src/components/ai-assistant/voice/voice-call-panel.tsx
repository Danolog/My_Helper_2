"use client";

// ---------------------------------------------------------------------------
// VoiceCallPanel — orchestrates the voice AI call simulation tab.
//
// All state and async handlers live in the useVoiceCall hook. Each visual
// section is rendered by a dedicated sub-component:
//   - VoiceCallSimulator  — call input + AI response + escalation handling
//   - VoiceBookingForm    — booking form + booking result
//   - VoiceRescheduleForm — reschedule form + reschedule result
//   - VoiceCancelForm     — cancellation form + cancel result
// ---------------------------------------------------------------------------

import { VoiceBookingForm } from "./_components/VoiceBookingForm";
import { VoiceCallSimulator } from "./_components/VoiceCallSimulator";
import { VoiceCancelForm } from "./_components/VoiceCancelForm";
import { VoiceRescheduleForm } from "./_components/VoiceRescheduleForm";
import { useVoiceCall } from "./_hooks/use-voice-call";
import type { ServiceOption, VoiceAiConfig } from "./types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VoiceCallPanelProps {
  config: VoiceAiConfig;
  availableServices: ServiceOption[];
  /** Called after a successful action to refresh the call log */
  onCallLogRefresh: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoiceCallPanel({
  config,
  availableServices,
  onCallLogRefresh,
}: VoiceCallPanelProps) {
  const vc = useVoiceCall({ config, onCallLogRefresh });

  return (
    <div className="space-y-6">
      {/* Call Simulation — input textarea + AI response + escalation */}
      <VoiceCallSimulator
        config={config}
        callerMessage={vc.callerMessage}
        setCallerMessage={vc.setCallerMessage}
        simulating={vc.simulating}
        onSimulateCall={vc.simulateCall}
        callResult={vc.callResult}
        msgName={vc.msgName}
        setMsgName={vc.setMsgName}
        msgPhone={vc.msgPhone}
        setMsgPhone={vc.setMsgPhone}
        msgText={vc.msgText}
        setMsgText={vc.setMsgText}
        sendingMessage={vc.sendingMessage}
        messageResult={vc.messageResult}
        onSendMessage={vc.handleLeaveMessage}
      />

      {/* Voice Booking Flow */}
      <VoiceBookingForm
        availableServices={availableServices}
        selectedServiceId={vc.selectedServiceId}
        setSelectedServiceId={vc.setSelectedServiceId}
        bookingDate={vc.bookingDate}
        setBookingDate={vc.setBookingDate}
        bookingTime={vc.bookingTime}
        setBookingTime={vc.setBookingTime}
        bookingPhone={vc.bookingPhone}
        setBookingPhone={vc.setBookingPhone}
        bookingName={vc.bookingName}
        setBookingName={vc.setBookingName}
        bookingInProgress={vc.bookingInProgress}
        bookingResult={vc.bookingResult}
        showBookingForm={vc.showBookingForm}
        setShowBookingForm={vc.setShowBookingForm}
        setBookingResult={vc.setBookingResult}
        onBook={vc.handleVoiceBooking}
      />

      {/* Voice Reschedule Flow */}
      <VoiceRescheduleForm
        reschedulePhone={vc.reschedulePhone}
        setReschedulePhone={vc.setReschedulePhone}
        rescheduleDate={vc.rescheduleDate}
        setRescheduleDate={vc.setRescheduleDate}
        rescheduleTime={vc.rescheduleTime}
        setRescheduleTime={vc.setRescheduleTime}
        rescheduleAppointmentId={vc.rescheduleAppointmentId}
        setRescheduleAppointmentId={vc.setRescheduleAppointmentId}
        rescheduleInProgress={vc.rescheduleInProgress}
        rescheduleResult={vc.rescheduleResult}
        showRescheduleForm={vc.showRescheduleForm}
        setShowRescheduleForm={vc.setShowRescheduleForm}
        setRescheduleResult={vc.setRescheduleResult}
        onReschedule={vc.handleVoiceReschedule}
      />

      {/* Voice Cancel Flow */}
      <VoiceCancelForm
        cancelPhone={vc.cancelPhone}
        setCancelPhone={vc.setCancelPhone}
        cancelAppointmentId={vc.cancelAppointmentId}
        setCancelAppointmentId={vc.setCancelAppointmentId}
        cancelInProgress={vc.cancelInProgress}
        cancelResult={vc.cancelResult}
        showCancelForm={vc.showCancelForm}
        setShowCancelForm={vc.setShowCancelForm}
        setCancelResult={vc.setCancelResult}
        onCancel={vc.handleVoiceCancel}
      />
    </div>
  );
}
