export interface BirthdaySettings {
  enabled: boolean;
  giftType: "discount" | "product";
  discountPercentage: number;
  productName: string;
  customMessage: string;
  autoSend: boolean;
}

export interface WeMissYouSettings {
  enabled: boolean;
  inactiveDays: number;
  customMessage: string;
  includeBookingLink: boolean;
  autoSend: boolean;
}

export interface NotificationChannelSettings {
  smsReminders: boolean;
  pushReminders: boolean;
  paymentConfirmations: boolean;
}

/** Default values for birthday notification settings */
export const DEFAULT_BIRTHDAY_SETTINGS: BirthdaySettings = {
  enabled: false,
  giftType: "discount",
  discountPercentage: 10,
  productName: "",
  customMessage:
    "Wszystkiego najlepszego z okazji urodzin, {imie}! {salon} zyczy Ci wspanialego dnia!",
  autoSend: false,
};

/** Default values for we-miss-you notification settings */
export const DEFAULT_WE_MISS_YOU_SETTINGS: WeMissYouSettings = {
  enabled: false,
  inactiveDays: 30,
  customMessage:
    "Czesc {imie}! Dawno Cie u nas nie widzielismy w {salon}. Minelo juz {dni} dni od Twojej ostatniej wizyty. Tesknimy! Zarezerwuj wizyte i wroc do nas.",
  includeBookingLink: true,
  autoSend: false,
};

/** Default values for notification channel settings */
export const DEFAULT_CHANNEL_SETTINGS: NotificationChannelSettings = {
  smsReminders: true,
  pushReminders: false,
  paymentConfirmations: true,
};
