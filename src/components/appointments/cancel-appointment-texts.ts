/**
 * Teksty okna odwołania wizyty przez salon i toastów po odwołaniu
 * (refund-fix RF3; brzmienie z decyzji produktowej, 2026-11-15 — dosłownie).
 *
 * Bez zdania o SMS i bez wariantu „utrata zadatku”: odwołanie przez salon
 * zawsze zwraca zadatek w całości (RF1, `depositForfeited` zawsze false).
 */
import type { CancellationDepositVariant } from "@/lib/salon-cancellation";
import { SUPPORT_CONTACT } from "@/lib/support-contact";

export { SUPPORT_CONTACT };

export const CANCEL_DIALOG_TITLE = "Odwołać wizytę?";
export const CANCEL_DIALOG_CONFIRM = "Odwołaj wizytę";
export const CANCEL_DIALOG_BACK = "Wróć";

function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

/** 1: zadatek opłacony online (Stripe) — zwrot automatyczny. */
export function cancelDialogBodyOnline(amount: number): string {
  return `Klient dostanie zwrot całego zadatku: ${formatAmount(amount)} PLN. Pieniądze wrócą na kartę lub konto, z którego płacił, zwykle w ciągu 5–10 dni roboczych. Odwołania nie można cofnąć.`;
}

/** 1b: zadatek wpłacony bezpośrednio do salonu — salon zwraca sam. */
export function cancelDialogBodyManual(amount: number): string {
  return `Klient wpłacił zadatek ${formatAmount(amount)} PLN bezpośrednio do salonu, więc zwróć mu go w całości samodzielnie. Odwołania nie można cofnąć.`;
}

/** 2: brak zadatku albo zadatek nieopłacony. */
export const CANCEL_DIALOG_BODY_NO_DEPOSIT =
  "Ta wizyta nie ma opłaconego zadatku, więc nie ma czego zwracać. Odwołania nie można cofnąć.";

export function cancelDialogBody(variant: CancellationDepositVariant, amount: number): string {
  if (variant === "online") return cancelDialogBodyOnline(amount);
  if (variant === "manual") return cancelDialogBodyManual(amount);
  return CANCEL_DIALOG_BODY_NO_DEPOSIT;
}

/** 3: toast po odwołaniu. */
export const CANCELLED_TOAST_TITLE = "Wizyta odwołana";
export function cancelledToastRefundDescription(amount: number): string {
  return `Zlecony zwrot zadatku: ${formatAmount(amount)} PLN. Klient dostanie pieniądze zwykle w ciągu 5–10 dni roboczych.`;
}

/** 4: toast nieudanego zwrotu — bez auto-zamknięcia. */
export const REFUND_FAILED_TOAST_TITLE = "Wizyta odwołana, ale zwrot zadatku się nie udał";
export function refundFailedToastDescription(amount: number): string {
  return `Zadatek ${formatAmount(amount)} PLN nie wrócił do klienta automatycznie. Napisz do nas: ${SUPPORT_CONTACT}, a zwrócimy go ręcznie. Nie oddawaj zadatku z kasy salonu, bo te pieniądze są na naszym koncie.`;
}

export interface SalonCancellationDetails {
  depositAmount: number;
  depositRefunded?: boolean;
  depositVariant?: CancellationDepositVariant;
  refundFailed?: boolean;
  refund?: { amount?: number | null; failedAmount?: number | null } | null;
}

export type CancelToast =
  | { kind: "error"; title: string; description: string; duration: number }
  | { kind: "success"; title: string; description?: string };

/** Który toast pokazać po udanym DELETE (RF3). */
export function salonCancelToast(details: SalonCancellationDetails | undefined): CancelToast {
  const amount = details?.refund?.amount ?? details?.depositAmount ?? 0;
  if (details?.refundFailed) {
    // Kwota, która NIE wróciła — nie suma udanych zwrotów (recenzja, #98).
    const failedAmount = details?.refund?.failedAmount ?? details?.depositAmount ?? 0;
    return {
      kind: "error",
      title: REFUND_FAILED_TOAST_TITLE,
      description: refundFailedToastDescription(failedAmount),
      duration: Infinity,
    };
  }
  if (details?.depositVariant === "online" && details.depositRefunded) {
    return { kind: "success", title: CANCELLED_TOAST_TITLE, description: cancelledToastRefundDescription(amount) };
  }
  return { kind: "success", title: CANCELLED_TOAST_TITLE };
}
