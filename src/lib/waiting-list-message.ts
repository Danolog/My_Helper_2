import { looksLikeAddress, SMS_TIME_ZONE } from "@/lib/sms";

/** Maksymalna długość nazwy salonu w treści push. */
const PUSH_SALON_NAME_MAX = 40;

/** Maksymalna długość nazwy usługi w treści push. */
const PUSH_SERVICE_NAME_MAX = 60;

/**
 * Tekst właściciela salonu przygotowany do treści push: znaki sterujące
 * i separatory linii → spacja, zwinięte spacje i trim; polskie znaki zostają.
 * Tekst wyglądający na adres — surowy, po oczyszczeniu albo po sprowadzeniu
 * do postaci podstawowej (NFKD, bez znaków łączących i niewidocznych) — jest
 * pomijany w całości. Ponad `max` znaków → `max - 1` znaków (bez spacji na
 * końcu) + "…"; długość liczona w punktach kodowych, emoji nie jest rozcinane.
 */
function ownerTextForPush(text: string, max: number): string {
  const cleaned = text
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";

  const plain = cleaned.normalize("NFKD").replace(/[\p{M}\p{Cf}]/gu, "");
  if (looksLikeAddress(text) || looksLikeAddress(cleaned) || looksLikeAddress(plain)) return "";

  const chars = [...cleaned];
  if (chars.length <= max) return cleaned;
  return `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/**
 * Parametry treści push o zwolnionym terminie z listy oczekujących. Celowo bez
 * danych klienta, pracownika i bez linku.
 */
export interface WaitingListPushParams {
  salonName: string | null | undefined;
  serviceName?: string | null | undefined;
  startTime: Date;
}

export interface WaitingListPushContent {
  title: string;
  body: string;
}

/**
 * Tytuł i treść push o zwolnionym terminie (czysta funkcja, bez wysyłki).
 * Nazwa salonu i usługi przez `ownerTextForPush` (z polskimi znakami; adres
 * pomijany; limity PUSH_SALON_NAME_MAX i PUSH_SERVICE_NAME_MAX); pusty
 * fragment jest pomijany. Data i godzina w strefie SMS_TIME_ZONE — tej samej
 * co w SMS.
 */
export function buildWaitingListPush(params: WaitingListPushParams): WaitingListPushContent {
  const formattedDate = params.startTime.toLocaleDateString("pl-PL", {
    timeZone: SMS_TIME_ZONE,
    day: "numeric",
    month: "long",
  });
  const formattedTime = params.startTime.toLocaleTimeString("pl-PL", {
    timeZone: SMS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });

  const salon = ownerTextForPush(params.salonName ?? "", PUSH_SALON_NAME_MAX);
  const service = ownerTextForPush(params.serviceName ?? "", PUSH_SERVICE_NAME_MAX);

  const salonPrefix = salon ? `${salon}: ` : "";
  const servicePrefix = service ? `${service}, ` : "";

  return {
    title: "Zwolnił się termin",
    body: `${salonPrefix}${servicePrefix}${formattedDate} o ${formattedTime}. Dotknij, aby przyjąć lub odrzucić.`,
  };
}
