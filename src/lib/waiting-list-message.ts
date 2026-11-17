import { SMS_TIME_ZONE } from "@/lib/sms";

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
 * Nazwa salonu i usługi bez zmian (z polskimi znakami), tylko obcięte spacje;
 * pusty fragment jest pomijany. Data i godzina w strefie SMS_TIME_ZONE —
 * tej samej co w SMS.
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

  const salon = (params.salonName ?? "").trim();
  const service = (params.serviceName ?? "").trim();

  const salonPrefix = salon ? `${salon}: ` : "";
  const servicePrefix = service ? `${service}, ` : "";

  return {
    title: "Zwolnił się termin",
    body: `${salonPrefix}${servicePrefix}${formattedDate} o ${formattedTime}. Dotknij, aby przyjąć lub odrzucić.`,
  };
}
