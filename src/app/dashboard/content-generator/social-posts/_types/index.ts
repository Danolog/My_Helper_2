import type React from "react";

export type Platform = "instagram" | "facebook" | "tiktok";

export type PostType =
  | "promotion"
  | "service_highlight"
  | "tips_and_tricks"
  | "behind_the_scenes"
  | "client_transformation"
  | "seasonal"
  | "engagement";

export type Tone = "professional" | "casual" | "fun" | "luxurious" | "educational";

export type PlatformOption = {
  value: Platform;
  label: string;
  icon: React.ReactNode;
};

export type PostTypeOption = {
  value: PostType;
  label: string;
  description: string;
};

export type ToneOption = {
  value: Tone;
  label: string;
};

export type GeneratedPost = {
  post: string;
  platform: Platform;
  postType: PostType;
  hashtags: string[];
  characterCount: number;
  maxLength: number;
};

export const POST_TYPES: PostTypeOption[] = [
  {
    value: "promotion",
    label: "Promocja",
    description: "Oferta specjalna lub rabat",
  },
  {
    value: "service_highlight",
    label: "Prezentacja uslugi",
    description: "Wyroznienie wybranej uslugi",
  },
  {
    value: "tips_and_tricks",
    label: "Porady",
    description: "Wskazowki i triki dla klientow",
  },
  {
    value: "behind_the_scenes",
    label: "Za kulisami",
    description: "Codziennosc w salonie",
  },
  {
    value: "client_transformation",
    label: "Metamorfoza",
    description: "Efekty pracy - przed i po",
  },
  {
    value: "seasonal",
    label: "Sezonowy",
    description: "Post okolicznosciowy lub swiateczny",
  },
  {
    value: "engagement",
    label: "Angazujacy",
    description: "Pytanie lub ankieta dla obserwujacych",
  },
];

export const TONES: ToneOption[] = [
  { value: "professional", label: "Profesjonalny" },
  { value: "casual", label: "Swobodny" },
  { value: "fun", label: "Zabawny" },
  { value: "luxurious", label: "Luksusowy" },
  { value: "educational", label: "Edukacyjny" },
];

/** Helper to validate whether a raw string is a recognised Platform value. */
export function isValidPlatform(v: string): v is Platform {
  return (["instagram", "facebook", "tiktok"] as string[]).includes(v);
}

/** Helper to validate whether a raw string is a recognised PostType value. */
export function isValidPostType(v: string): v is PostType {
  return POST_TYPES.some((pt) => pt.value === v);
}

/** Helper to validate whether a raw string is a recognised Tone value. */
export function isValidTone(v: string): v is Tone {
  return TONES.some((t) => t.value === v);
}

/** Get a default date string for the schedule picker (tomorrow at 10:00). */
export function getDefaultScheduleDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`;
}
