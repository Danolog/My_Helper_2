// Kwota wizyty w raporcie przychodu i podział na metody płatności.
//
// Od zakończenia wizyty z kwotą i metodą (`paid_amount`, `payment_method`)
// przychód wizyty to kwota wpisana przez salon, a nie cena usługi. Wizyty
// zakończone wcześniej nie mają zapisu płatności: liczą się dawnym wzorem
// (cena usługi minus rabat, nie mniej niż 0) i trafiają do osobnej grupy,
// żeby stare okresy pokazywały te same sumy co przed zmianą.
//
// Wszystko w groszach (liczby całkowite): suma grup równa się sumie
// całkowitej co do grosza, a format z dwoma miejscami dopiero na wyjściu.
// Moduł bez importów serwerowych, więc korzysta z niego także interfejs.

/** Kolejność grup w podziale na metody (JSON, CSV, XLSX, ekran, PDF). */
export const REVENUE_METHOD_ORDER = ["cash", "card", "blik", "none"] as const;

/** Grupa podziału: metoda zapisana przy zakończeniu albo `none` (brak zapisu). */
export type RevenueMethod = (typeof REVENUE_METHOD_ORDER)[number];

export const REVENUE_METHOD_LABELS: Record<RevenueMethod, string> = {
  cash: "Gotówka",
  card: "Karta",
  blik: "BLIK",
  none: "Bez zapisu płatności",
};

/** Zdanie o źródle kwot — zawsze przy podziale na metody i w eksportach. */
export const REVENUE_SOURCE_NOTE =
  "Przychód to kwoty wpisane przy zakończeniu wizyty. Nie pochodzi z kasy fiskalnej ani z terminala płatniczego.";

/** Zdanie o grupie „Bez zapisu płatności” — tylko gdy ma co najmniej jedną wizytę. */
export const REVENUE_NO_RECORD_NOTE =
  "Bez zapisu płatności: wizyty zakończone, zanim aplikacja zaczęła pytać o kwotę i metodę. Ich kwota to cena usługi minus rabat.";

/** Pola wizyty potrzebne do jej kwoty (kolumny `numeric` przychodzą jako napisy). */
export interface RevenueAppointmentRow {
  paidAmount: string | null;
  paymentMethod: string | null;
  /** Cena podstawowa usługi; `null` przy usuniętej usłudze (LEFT JOIN). */
  basePrice: string | null;
  discountAmount: string | null;
}

export interface AppointmentRevenue {
  /** Kwota wizyty w groszach, liczba całkowita ≥ 0 przy poprawnych danych. */
  cents: number;
  method: RevenueMethod;
}

type RecordedMethod = Exclude<RevenueMethod, "none">;

function isRecordedMethod(value: string | null): value is RecordedMethod {
  return value === "cash" || value === "card" || value === "blik";
}

/** Napis kwoty → grosze. Pusty albo nieczytelny napis daje 0, jak dawne `parseFloat(x || "0")`. */
function amountToCents(value: string | null): number {
  const parsed = parseFloat(value || "0");
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

/**
 * Kwota wizyty i grupa, do której należy.
 *
 * - Kwota wpisana (`paidAmount !== null`): liczy się ona, w swojej metodzie.
 *   Rabat jest już w niej, więc cena usługi i rabat nie mają znaczenia.
 *   `"0.00"` to prawdziwe 0 zł — dlatego sprawdzenie `=== null`, nie prawdziwość.
 * - Brak zapisu: dawny wzór `max(0, cena − rabat)` w grupie `none`.
 * - Metoda spoza listy przy kwocie (baza na to nie pozwala): kwota wpisana
 *   w grupie `none`, bez wyjątku — raport ma się policzyć.
 */
export function appointmentRevenueCents(row: RevenueAppointmentRow): AppointmentRevenue {
  if (row.paidAmount !== null) {
    const cents = Math.round(Number(row.paidAmount) * 100);
    return {
      cents: Number.isFinite(cents) ? cents : 0,
      method: isRecordedMethod(row.paymentMethod) ? row.paymentMethod : "none",
    };
  }
  const fallbackCents = Math.max(0, amountToCents(row.basePrice) - amountToCents(row.discountAmount));
  return { cents: fallbackCents, method: "none" };
}

/** Rabat wizyty w groszach (pole „Zniżki”); brak rabatu = 0. */
export function discountCents(discountAmount: string | null): number {
  return amountToCents(discountAmount);
}

/** Grosze → napis z dwoma miejscami po przecinku, np. 12345 → "123.45". */
export function centsToAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Udział części w całości w procentach, jedno miejsce po przecinku; przy
 * całości 0 → "0.0". Mnożenie przed dzieleniem: na groszach wynik jest
 * dokładny tam, gdzie to możliwe (np. 80 z 32000 to równo 0.25, więc "0.3").
 */
export function revenueShare(partCents: number, totalCents: number): string {
  return totalCents > 0 ? ((partCents * 100) / totalCents).toFixed(1) : "0.0";
}
