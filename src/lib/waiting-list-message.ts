import { looksLikeAddress, SMS_TIME_ZONE } from "@/lib/sms";

/** Maksymalna długość nazwy salonu w treści push. */
const PUSH_SALON_NAME_MAX = 40;

/** Maksymalna długość nazwy usługi w treści push. */
const PUSH_SERVICE_NAME_MAX = 60;

/**
 * Znaki liczone w regule adresu jak kropka: kropka ASCII, separatory etykiet
 * domeny wg UTS #46 (U+3002, U+FF0E, U+FF61), znaki, które NFKD sprowadza do
 * kropki (U+2024, U+FE52), oraz kropki środkowe wyglądające jak kropka
 * (U+00B7, U+2027, U+2219, U+22C5, U+30FB, U+FF65).
 */
const DOT_LIKE = /[.。．｡․﹒·‧∙⋅・･]/gu;

/**
 * Postać tekstu do reguły adresu niezależna od alfabetu: każda litera → "a",
 * każda cyfra → "0", każdy znak „jak kropka” → ".". Wejście bez znaków
 * łączących i niewidocznych (postać po NFKD).
 */
function scriptNeutral(plain: string): string {
  return plain.replace(/\p{L}/gu, "a").replace(/\p{N}/gu, "0").replace(DOT_LIKE, ".");
}

/**
 * Tekst właściciela salonu przygotowany do treści push: znaki sterujące
 * i separatory linii → spacja, zwinięte spacje i trim; polskie znaki zostają.
 * Tekst wyglądający na adres — surowy, po oczyszczeniu, po sprowadzeniu
 * do postaci podstawowej (NFKD, bez znaków łączących i niewidocznych) albo
 * w postaci niezależnej od alfabetu (`scriptNeutral`) — jest pomijany
 * w całości. Tekst z kropką między literami (w dowolnym alfabecie, bez spacji
 * po kropce) traktujemy jak adres, np. „św.Anna”; „ul. Długa” przechodzi.
 * Wyświetlany jest tekst oczyszczony, bez zmian liter i kropek. Ponad `max`
 * znaków → `max - 1` znaków (bez spacji na końcu) + "…"; długość liczona
 * w punktach kodowych, emoji nie jest rozcinane.
 */
function ownerTextForPush(text: string, max: number): string {
  const cleaned = text
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";

  const plain = cleaned.normalize("NFKD").replace(/[\p{M}\p{Cf}]/gu, "");
  if (
    looksLikeAddress(text) ||
    looksLikeAddress(cleaned) ||
    looksLikeAddress(plain) ||
    looksLikeAddress(scriptNeutral(plain))
  ) {
    return "";
  }

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
