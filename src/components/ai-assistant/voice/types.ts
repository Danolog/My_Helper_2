// ---------------------------------------------------------------------------
// Shared types for Voice AI Assistant components
// ---------------------------------------------------------------------------

export type VoiceAiConfig = {
  enabled: boolean;
  greeting: string;
  businessHoursOnly: boolean;
  language: "pl" | "en";
  voiceStyle: "professional" | "friendly" | "warm";
  maxCallDuration: number;
  transferToHumanEnabled: boolean;
  transferPhoneNumber: string;
  capabilities: {
    bookAppointments: boolean;
    checkAvailability: boolean;
    cancelAppointments: boolean;
    rescheduleAppointments: boolean;
    answerFaq: boolean;
  };
};

export type AvailabilitySlot = {
  time: string;
  available: boolean;
};

export type AvailabilityData = {
  date: string;
  dateFormatted: string;
  employeeId: string;
  employeeName: string;
  serviceName: string | null;
  duration: number;
  dayOff: boolean;
  workStart: string | null;
  workEnd: string | null;
  availableSlots: AvailabilitySlot[];
  requestedTime: string | null;
  requestedTimeAvailable: boolean | null;
  alternativeTimes: string[];
};

export type CallSimulationResult = {
  conversationId: string;
  greeting: string;
  response: string;
  intent: string;
  intentLabel: string;
  suggestedAction: string | null;
  voiceStyle: string;
  language: string;
  transferToHuman: boolean;
  availabilityData: AvailabilityData | null;
  escalationReason: string | null;
  messageTaken: boolean;
};

export type CallLogEntry = {
  id: string;
  callerPhone: string;
  callerMessage: string;
  aiResponse: string;
  intent: string;
  timestamp: string;
};

export type ServiceOption = {
  id: string;
  name: string;
  price: string;
  duration: number;
};

export type BookingResult = {
  success: boolean;
  appointment: {
    id: string;
    startTime: string;
    endTime: string;
    status: string;
  };
  details: {
    serviceName: string;
    employeeName: string;
    date: string;
    time: string;
    duration: number;
    price: string;
  };
  smsConfirmation: {
    sent: boolean;
    phone: string;
  };
  conversationId: string | null;
};

export type RescheduleResult = {
  success: boolean;
  appointment: {
    id: string;
    startTime: string;
    endTime: string;
    status: string;
  };
  details: {
    appointmentId: string;
    serviceName: string;
    employeeName: string;
    oldDate: string;
    oldTime: string;
    newDate: string;
    newTime: string;
    duration: number;
    availableSlots: string[];
  };
  smsConfirmation: {
    sent: boolean;
    phone: string;
  };
  conversationId: string | null;
};

export type CancelResult = {
  success: boolean;
  appointment: {
    id: string;
    startTime: string;
    endTime: string;
    status: string;
  };
  details: {
    appointmentId: string;
    serviceName: string;
    employeeName: string;
    date: string;
    time: string;
    clientName: string | null;
  };
  depositInfo: {
    hasDeposit: boolean;
    depositPaid: boolean;
    depositAmount: number;
    depositPolicy: string;
    depositRefunded: boolean;
    depositForfeited: boolean;
    hoursUntilAppointment: number;
    isMoreThan24h: boolean;
    refund: {
      processed: boolean;
      refundId: string;
      amount: number;
      message: string;
    } | null;
  };
  smsConfirmation: {
    sent: boolean;
    phone: string;
  };
  conversationId: string | null;
};

export type MessageResult = {
  success: boolean;
  referenceNumber: string;
};

// ---------------------------------------------------------------------------
// Return type for the useVoiceCall hook — every piece of state and handler
// that the decomposed sub-components consume.
// ---------------------------------------------------------------------------

export type UseVoiceCallReturn = {
  // Call simulation
  callerMessage: string;
  setCallerMessage: (value: string) => void;
  simulating: boolean;
  callResult: CallSimulationResult | null;
  simulateCall: () => Promise<void>;

  // Booking flow
  selectedServiceId: string;
  setSelectedServiceId: (value: string) => void;
  bookingDate: string;
  setBookingDate: (value: string) => void;
  bookingTime: string;
  setBookingTime: (value: string) => void;
  bookingPhone: string;
  setBookingPhone: (value: string) => void;
  bookingName: string;
  setBookingName: (value: string) => void;
  bookingInProgress: boolean;
  bookingResult: BookingResult | null;
  setBookingResult: (value: BookingResult | null) => void;
  showBookingForm: boolean;
  setShowBookingForm: (value: boolean) => void;
  handleVoiceBooking: () => Promise<void>;

  // Reschedule flow
  reschedulePhone: string;
  setReschedulePhone: (value: string) => void;
  rescheduleDate: string;
  setRescheduleDate: (value: string) => void;
  rescheduleTime: string;
  setRescheduleTime: (value: string) => void;
  rescheduleAppointmentId: string;
  setRescheduleAppointmentId: (value: string) => void;
  rescheduleInProgress: boolean;
  rescheduleResult: RescheduleResult | null;
  setRescheduleResult: (value: RescheduleResult | null) => void;
  showRescheduleForm: boolean;
  setShowRescheduleForm: (value: boolean) => void;
  handleVoiceReschedule: () => Promise<void>;

  // Cancel flow
  cancelPhone: string;
  setCancelPhone: (value: string) => void;
  cancelAppointmentId: string;
  setCancelAppointmentId: (value: string) => void;
  cancelInProgress: boolean;
  cancelResult: CancelResult | null;
  setCancelResult: (value: CancelResult | null) => void;
  showCancelForm: boolean;
  setShowCancelForm: (value: boolean) => void;
  handleVoiceCancel: () => Promise<void>;

  // Leave-message (escalation)
  msgName: string;
  setMsgName: (value: string) => void;
  msgPhone: string;
  setMsgPhone: (value: string) => void;
  msgText: string;
  setMsgText: (value: string) => void;
  sendingMessage: boolean;
  messageResult: MessageResult | null;
  handleLeaveMessage: () => Promise<void>;
};

export const DEFAULT_CONFIG: VoiceAiConfig = {
  enabled: false,
  greeting:
    "Dzien dobry! Dzwonisz do naszego salonu. Jestem asystentem AI. W czym moge pomoc?",
  businessHoursOnly: true,
  language: "pl",
  voiceStyle: "friendly",
  maxCallDuration: 300,
  transferToHumanEnabled: true,
  transferPhoneNumber: "",
  capabilities: {
    bookAppointments: true,
    checkAvailability: true,
    cancelAppointments: true,
    rescheduleAppointments: true,
    answerFaq: true,
  },
};
