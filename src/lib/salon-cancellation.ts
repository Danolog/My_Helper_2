/**
 * Odwołanie wizyty przez SALON (`DELETE /api/appointments/[id]`) —
 * refund-fix (RF1, RF2) i #70 pkt 1.
 *
 * - RF1: zadatek zwracany w 100%, niezależnie od reguły 24 h. Reguła 24 h
 *   zostaje tylko dla anulowania przez klienta (`client/appointments/[id]/cancel`).
 * - #70 pkt 1: w tej samej transakcji co `cancelled` płatność `pending`
 *   dostaje `failed`; po commicie otwarta sesja Checkout jest wygaszana
 *   (`checkout.sessions.expire`). Gdy klient zdążył zapłacić, webhook zapisze
 *   wpłatę i zwróci ją automatycznie (`confirmDepositPayment`, #70 pkt 2).
 * - RF2: jeden SMS do klienta (zamiast anulowania + osobnego SMS o zwrocie),
 *   tekst z §6 specyfikacji 1.1, bez polskich znaków (GSM-7), bez linku do
 *   rezerwacji.
 *
 * Kolejność blokad jak w `confirmDepositPayment`, cronie i webhooku
 * `expired`: najpierw płatność (UPDATE), potem wizyta (`FOR UPDATE`).
 * Decyzja o zwrocie zapada na stanie wizyty PO blokadzie — jeśli webhook
 * zdążył potwierdzić wpłatę, widzimy `depositPaid = true` i zwracamy.
 */
import { and, eq } from "drizzle-orm";
import { AppointmentCompletedError, COMPLETED_STATUS } from "@/lib/appointment-completion";
import { logger } from "@/lib/logger";
import { NO_SHOW_STATUS } from "@/lib/no-show";
import { toErrorIdentity } from "@/lib/safe-error";
import { appointments, depositPayments } from "@/lib/schema";
import type { DbTx } from "@/lib/server/repository";
import { getStripe } from "@/lib/stripe";

/** Wariant SMS i komunikatu (§6): zadatek online, wpłacony poza MyHelper, brak. */
export type CancellationDepositVariant = "online" | "manual" | "none";

type AppointmentRow = typeof appointments.$inferSelect;

/** Klient transakcyjny (`forSalon(salonId).raw`) — z kontekstem RLS salonu. */
type Tx = DbTx;

export type SalonCancelTxResult =
  | { alreadyCancelled: true }
  | { notFound: true }
  | {
      cancelled: AppointmentRow;
      /** depositPaid ze stanu po blokadzie (przed anulowaniem). */
      depositPaid: boolean;
      variant: CancellationDepositVariant;
      /** Płatności, które przeszły z `pending` w `failed` (do wygaszenia sesji). */
      failedPayments: Array<{ id: string; stripePaymentIntentId: string | null }>;
    };

/**
 * Wizyta oznaczona „Nie przyszedł” (stan po blokadzie wiersza). Rzucany
 * w transakcji, żeby wycofać wszystkie jej zapisy; trasa mapuje go na 400.
 */
export class AppointmentMarkedNoShowError extends Error {
  constructor() {
    super("Appointment is marked as no-show");
    this.name = "AppointmentMarkedNoShowError";
  }
}

/**
 * Transakcja anulowania. `tx` to klient z kontekstem RLS salonu
 * (`forSalon(salonId).raw`), stąd jawne `eq(salonId)` w każdym warunku.
 *
 * Wynik `alreadyCancelled` / `notFound` NIE wycofuje transakcji: krok 1
 * (`pending → failed`) zostaje zatwierdzony. Świadomie — anulowana wizyta
 * nie powinna mieć płatności `pending`; jeśli klient mimo to zapłaci,
 * webhook zapisze wpłatę i ją zwróci (#70). Dla obcej wizyty krok 1 nic
 * nie zmienia (warunek `salonId`). Wizyta `no_show` po blokadzie rzuca
 * `AppointmentMarkedNoShowError`, a `completed` — `AppointmentCompletedError`;
 * oba wycofują całą transakcję.
 */
export async function cancelAppointmentInTx(
  tx: Tx,
  salonId: string,
  appointmentId: string
): Promise<SalonCancelTxResult> {
  const failedPayments = await tx
    .update(depositPayments)
    .set({ status: "failed" })
    .where(
      and(
        eq(depositPayments.appointmentId, appointmentId),
        eq(depositPayments.salonId, salonId),
        eq(depositPayments.status, "pending")
      )
    )
    .returning({ id: depositPayments.id, stripePaymentIntentId: depositPayments.stripePaymentIntentId });

  const [current] = await tx
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, appointmentId), eq(appointments.salonId, salonId)))
    .for("update");
  if (!current) return { notFound: true };
  if (current.status === "cancelled") return { alreadyCancelled: true };
  // Trasa DELETE sprawdza `no_show` już na odczycie przed transakcją, ale
  // oznaczenie mogło wejść między tym odczytem a blokadą. Anulowanie
  // nadpisałoby nieobecność, więc decyzja zapada ponownie na stanie po blokadzie.
  // Błąd, a nie wynik: wizyta zostaje, więc krok 1 (`pending → failed`) też
  // musi zostać wycofany.
  if (current.status === NO_SHOW_STATUS) throw new AppointmentMarkedNoShowError();
  // Wizyta zakończona ma ostateczny wynik: anulowanie zwróciłoby zadatek za
  // wykonaną usługę i zatarło płatność. Błąd, nie wynik — krok 1 też wycofany.
  if (current.status === COMPLETED_STATUS) throw new AppointmentCompletedError();

  const paidMethods = await tx
    .select({ paymentMethod: depositPayments.paymentMethod })
    .from(depositPayments)
    .where(
      and(
        eq(depositPayments.appointmentId, appointmentId),
        eq(depositPayments.salonId, salonId),
        eq(depositPayments.status, "succeeded")
      )
    );

  const [cancelled] = await tx
    .update(appointments)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(appointments.id, appointmentId), eq(appointments.salonId, salonId)))
    .returning();
  if (!cancelled) return { notFound: true };

  const variant = depositVariantFor(current.depositAmount, current.depositPaid, paidMethods);

  return { cancelled, depositPaid: current.depositPaid === true, variant, failedPayments };
}

/**
 * Wariant zadatku wizyty: opłacony online (płatność Stripe `succeeded`),
 * opłacony poza MyHelper (`depositPaid` bez płatności Stripe) albo brak.
 * Wspólny dla DELETE (SMS, odpowiedź) i `cancel-info` (okno potwierdzenia).
 */
export function depositVariantFor(
  depositAmount: string | null,
  depositPaid: boolean | null,
  succeededPayments: Array<{ paymentMethod: string }>
): CancellationDepositVariant {
  const hasDeposit = !!depositAmount && parseFloat(depositAmount) > 0;
  if (!hasDeposit || !depositPaid) return "none";
  return succeededPayments.some((p) => p.paymentMethod === "stripe") ? "online" : "manual";
}

/** Prawdziwa sesja Checkout (nie dawna symulacja, nie `pi_`). */
export function isCheckoutSessionId(id: string | null | undefined): id is string {
  return !!id && id.startsWith("cs_");
}

/**
 * #70 pkt 1: po commicie wygaś otwarte sesje Checkout. Błąd (sesja już
 * wygasła / zakończona) = `warn`, bez cofania anulowania — jeśli klient
 * zapłacił, webhook zapisze wpłatę i ją zwróci.
 */
export async function expireCheckoutSessions(
  appointmentId: string,
  failedPayments: Array<{ id: string; stripePaymentIntentId: string | null }>
): Promise<void> {
  const sessions = failedPayments.filter((p) => isCheckoutSessionId(p.stripePaymentIntentId));
  if (sessions.length === 0) return;
  const stripe = getStripe();
  if (!stripe) {
    logger.warn("[Salon cancel] Stripe not configured — checkout session not expired", {
      appointmentId,
      depositPaymentIds: sessions.map((s) => s.id),
    });
    return;
  }
  for (const payment of sessions) {
    try {
      const session = await stripe.checkout.sessions.expire(payment.stripePaymentIntentId!);
      logger.info("[Salon cancel] Checkout session expired", {
        appointmentId,
        depositPaymentId: payment.id,
        sessionStatus: session.status,
      });
    } catch (error) {
      logger.warn("[Salon cancel] Checkout session expire failed — webhook will refund a late payment", {
        appointmentId,
        depositPaymentId: payment.id,
        // Tylko nazwa i kod — komunikat Stripe może nieść dane klienta (P2 #98).
        ...toErrorIdentity(error),
      });
    }
  }
}

// ---------------------------------------------------------------- SMS (RF2)

const PL_TO_ASCII: Record<string, string> = {
  ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z",
  Ą: "A", Ć: "C", Ę: "E", Ł: "L", Ń: "N", Ó: "O", Ś: "S", Ź: "Z", Ż: "Z",
};

/**
 * Tekst SMS bez polskich znaków. Znak spoza GSM-7 przełącza SMS na UCS-2
 * (70 zamiast 160 znaków na część) — spec 1.1 §6. Polskie litery →
 * odpowiedniki ASCII, inne znaki diakrytyczne → bez akcentu.
 */
export function toGsm7Text(text: string): string {
  return text
    .replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, (ch) => PL_TO_ASCII[ch] ?? ch)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const MONTHS_GENITIVE = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "wrzesnia", "pazdziernika", "listopada", "grudnia",
];

/** „17 listopada 2026” w strefie Europe/Warsaw (spec §6). */
export function formatSmsDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return `${get("day")} ${MONTHS_GENITIVE[get("month") - 1]} ${get("year")}`;
}

export interface SalonCancellationSmsInput {
  salonName: string;
  salonPhone?: string | null;
  serviceName: string;
  startTime: Date;
  variant: CancellationDepositVariant;
  depositAmount: number;
}

/** Jeden SMS o odwołaniu przez salon — 3 warianty z §6, bez linku do rezerwacji. */
export function buildSalonCancellationSms(input: SalonCancellationSmsInput): string {
  const phone = input.salonPhone?.trim() ? `: ${input.salonPhone.trim()}` : "";
  const amount = input.depositAmount.toFixed(2);
  const head = `${input.salonName}: Twoja wizyta ${input.serviceName} ${formatSmsDate(input.startTime)} zostala odwolana przez salon.`;
  const tail =
    input.variant === "online"
      ? ` Zadatek ${amount} PLN wroci w calosci w ciagu 5-10 dni roboczych.`
      : input.variant === "manual"
        ? ` W sprawie zwrotu zadatku ${amount} PLN skontaktuj sie z salonem${phone}.`
        : ` W sprawie nowego terminu skontaktuj sie z salonem${phone}.`;
  return toGsm7Text(head + tail);
}
