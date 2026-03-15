export type GoalType =
  | "promotion"
  | "seasonal"
  | "loyalty"
  | "reactivation"
  | "news"
  | "tips";

export type Tone = "professional" | "casual" | "fun" | "luxurious" | "educational";

export type Length = "short" | "medium" | "long";

export type GoalOption = {
  value: GoalType;
  label: string;
  description: string;
};

export type ToneOption = {
  value: Tone;
  label: string;
};

export type LengthOption = {
  value: Length;
  label: string;
  description: string;
};

export type GeneratedNewsletter = {
  subject: string;
  content: string;
  wordCount: number;
  goal: GoalType;
  tone: Tone;
  savedId: string | null;
};

export type SavedNewsletter = {
  id: string;
  subject: string;
  content: string;
  createdAt: string;
  sentAt: string | null;
  recipientsCount: number;
};

export type Recipient = {
  clientId: string;
  firstName: string;
  lastName: string;
  email: string;
  consentGrantedAt: string;
};

export type RecipientsData = {
  newsletterId: string;
  newsletterSubject: string;
  alreadySent: boolean;
  recipients: Recipient[];
  consentedCount: number;
  totalClientsWithEmail: number;
};

export const GOALS: GoalOption[] = [
  {
    value: "promotion",
    label: "Promocja",
    description: "Promocja uslugi, produktu lub oferty specjalnej",
  },
  {
    value: "seasonal",
    label: "Sezonowy",
    description: "Oferta sezonowa lub swiateczna",
  },
  {
    value: "loyalty",
    label: "Lojalnosc",
    description: "Budowanie relacji z obecnymi klientami",
  },
  {
    value: "reactivation",
    label: "Reaktywacja",
    description: "Zachecenie nieaktywnych klientow do powrotu",
  },
  {
    value: "news",
    label: "Nowosci",
    description: "Informacje o nowosciach w salonie",
  },
  {
    value: "tips",
    label: "Porady",
    description: "Wskazowki i porady pielegnacyjne",
  },
];

export const TONES: ToneOption[] = [
  { value: "professional", label: "Profesjonalny" },
  { value: "casual", label: "Swobodny" },
  { value: "fun", label: "Zabawny" },
  { value: "luxurious", label: "Luksusowy" },
  { value: "educational", label: "Edukacyjny" },
];

export const LENGTHS: LengthOption[] = [
  { value: "short", label: "Krotki", description: "150-250 slow" },
  { value: "medium", label: "Sredni", description: "250-400 slow" },
  { value: "long", label: "Dlugi", description: "400-600 slow" },
];

/** Helper to validate whether a raw string is a recognised GoalType value. */
export function isValidGoal(v: string): v is GoalType {
  return GOALS.some((g) => g.value === v);
}

/** Helper to validate whether a raw string is a recognised Tone value. */
export function isValidTone(v: string): v is Tone {
  return TONES.some((t) => t.value === v);
}

/** Helper to validate whether a raw string is a recognised Length value. */
export function isValidLength(v: string): v is Length {
  return LENGTHS.some((l) => l.value === v);
}
