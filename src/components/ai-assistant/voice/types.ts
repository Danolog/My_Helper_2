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
