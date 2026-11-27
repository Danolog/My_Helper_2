// Blokada rezerwacji online klienta — reguły wspólne dla tras API i panelu.
//
// Zablokowany klient (clients.blocked_at niepuste) nie zarezerwuje wizyty
// w portalu ani jako gość. Personel salonu dodaje mu wizytę w panelu jak dotąd.
// Blokadę zakłada właściciel ręcznie albo serwer automatycznie, gdy licznik
// „Nie przyszedł” klienta dojdzie do progu z ustawień salonu. Zdejmuje ją tylko
// właściciel: cofnięcie oznaczenia „Nie przyszedł” blokady nie zdejmuje.
//
// Moduł bez importów serwerowych: czytają go komponenty klienckie.
import type { SalonRole } from "@/lib/salon-context";

/** Wartość `clients.blocked_by` dla blokady założonej przez próg nieobecności. */
export const CLIENT_BLOCKED_BY_AUTO = "auto";

/** Najdłuższa notatka do blokady (CHECK `clients_block_note_length` w migracji 0019). */
export const CLIENT_BLOCK_NOTE_MAX_LENGTH = 500;

/** Role, które zakładają i zdejmują blokadę. Recepcja i pracownik nie. */
export const CLIENT_BLOCK_ROLES: readonly SalonRole[] = ["owner"];

export function isClientBlockRole(role: SalonRole): boolean {
  return CLIENT_BLOCK_ROLES.includes(role);
}

/** Stan blokady w odpowiedzi `/api/clients/[id]/block` — panel odświeża nim baner. */
export type ClientBlockState = {
  clientId: string;
  blocked: boolean;
  /** ISO 8601 albo null. */
  blockedAt: string | null;
  /** `'auto'` albo konto właściciela; null bez blokady. */
  blockedBy: string | null;
  /** true = blokada z progu nieobecności (`blocked_by = 'auto'`). */
  automatic: boolean;
  note: string | null;
  /** false = stan już był docelowy (powtórne kliknięcie), bez zapisu. */
  changed: boolean;
};

/** Klucz w `salons.settingsJson` z progiem automatycznej blokady. */
export const NO_SHOW_AUTO_BLOCK_SETTING_KEY = "noShowAutoBlockThreshold";

/** Dozwolone progi: liczba nieobecności, po której rezerwacja online się blokuje. */
export const NO_SHOW_AUTO_BLOCK_THRESHOLDS = [1, 2, 3] as const;
export type NoShowAutoBlockThreshold = (typeof NO_SHOW_AUTO_BLOCK_THRESHOLDS)[number];

/**
 * Próg z `settingsJson` albo `null` (automatyczna blokada wyłączona). Ustawienia
 * mogą mieć dowolny kształt (stare wiersze, ręczny SQL), więc każda wartość
 * spoza listy znaczy „wyłączona”, a nie błąd.
 */
export function parseNoShowAutoBlockThreshold(raw: unknown): NoShowAutoBlockThreshold | null {
  return NO_SHOW_AUTO_BLOCK_THRESHOLDS.find((t) => t === raw) ?? null;
}

/** Czy licznik nieobecności klienta zakłada automatyczną blokadę. */
export function reachesNoShowAutoBlock(noShowCount: number, threshold: NoShowAutoBlockThreshold | null): boolean {
  return threshold !== null && noShowCount >= threshold;
}

/** Kod 403 rezerwacji online odrzuconej przez blokadę klienta. */
export const ONLINE_BOOKING_UNAVAILABLE_CODE = "ONLINE_BOOKING_UNAVAILABLE";

/**
 * Komunikat dla osoby rezerwującej. Celowo neutralny: bez słów „zablokowany”
 * i „nieobecność”, żeby nie zdradzał, że numer albo e-mail należy do klienta
 * z blokadą (każdy może wpisać cudzy numer).
 */
export function onlineBookingUnavailableMessage(salonPhone: string | null | undefined): string {
  const phone = salonPhone?.trim();
  return phone
    ? `Rezerwacja online jest niedostępna. Zadzwoń do salonu: ${phone}`
    : "Rezerwacja online jest niedostępna. Skontaktuj się z salonem.";
}
