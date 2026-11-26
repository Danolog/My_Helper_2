/**
 * refund-fix RF3 — teksty okna odwołania i toastów (dosłownie)
 * oraz wybór wariantu. Wariant zadatku: `depositVariantFor` (wspólny dla
 * DELETE i cancel-info).
 */
import { describe, it, expect } from "vitest";
import {
  CANCEL_DIALOG_BACK,
  CANCEL_DIALOG_BODY_NO_DEPOSIT,
  CANCEL_DIALOG_CONFIRM,
  CANCEL_DIALOG_TITLE,
  CANCELLED_TOAST_TITLE,
  REFUND_FAILED_TOAST_TITLE,
  SUPPORT_CONTACT,
  cancelDialogBody,
  cancelDialogBodyManual,
  cancelDialogBodyOnline,
  cancelledToastRefundDescription,
  refundFailedToastDescription,
  salonCancelToast,
} from "@/components/appointments/cancel-appointment-texts";
import { depositVariantFor } from "@/lib/salon-cancellation";

describe("RF3 — teksty (dosłownie)", () => {
  it("okno: tytuł i przyciski", () => {
    expect(CANCEL_DIALOG_TITLE).toBe("Odwołać wizytę?");
    expect(CANCEL_DIALOG_CONFIRM).toBe("Odwołaj wizytę");
    expect(CANCEL_DIALOG_BACK).toBe("Wróć");
  });

  it("1: zadatek online", () => {
    expect(cancelDialogBodyOnline(50)).toBe(
      "Klient dostanie zwrot całego zadatku: 50.00 PLN. Pieniądze wrócą na kartę lub konto, z którego płacił, zwykle w ciągu 5–10 dni roboczych. Odwołania nie można cofnąć."
    );
  });

  it("1b: zadatek wpłacony bezpośrednio do salonu — bez obietnicy zwrotu na kartę", () => {
    const text = cancelDialogBodyManual(30);
    expect(text).toBe(
      "Klient wpłacił zadatek 30.00 PLN bezpośrednio do salonu, więc zwróć mu go w całości samodzielnie. Odwołania nie można cofnąć."
    );
    expect(text).not.toContain("wrócą na kartę lub konto");
  });

  it("2: brak opłaconego zadatku", () => {
    expect(CANCEL_DIALOG_BODY_NO_DEPOSIT).toBe(
      "Ta wizyta nie ma opłaconego zadatku, więc nie ma czego zwracać. Odwołania nie można cofnąć."
    );
  });

  it("3: toast po odwołaniu ze zwrotem", () => {
    expect(CANCELLED_TOAST_TITLE).toBe("Wizyta odwołana");
    expect(cancelledToastRefundDescription(50)).toBe(
      "Zlecony zwrot zadatku: 50.00 PLN. Klient dostanie pieniądze zwykle w ciągu 5–10 dni roboczych."
    );
  });

  it("4: toast nieudanego zwrotu z kontaktem do wsparcia (jedna stała)", () => {
    expect(REFUND_FAILED_TOAST_TITLE).toBe("Wizyta odwołana, ale zwrot zadatku się nie udał");
    expect(refundFailedToastDescription(50)).toBe(
      `Zadatek 50.00 PLN nie wrócił do klienta automatycznie. Napisz do nas: ${SUPPORT_CONTACT}, a zwrócimy go ręcznie. Nie oddawaj zadatku z kasy salonu, bo te pieniądze są na naszym koncie.`
    );
    expect(SUPPORT_CONTACT).toBe("kontakt@nordsignal.cc");
    expect(refundFailedToastDescription(50)).toContain("Napisz do nas: kontakt@nordsignal.cc, a zwrócimy");
  });

  it("żaden tekst salonu nie mówi o SMS ani o utracie zadatku", () => {
    const all = [
      cancelDialogBodyOnline(1), cancelDialogBodyManual(1), CANCEL_DIALOG_BODY_NO_DEPOSIT,
      cancelledToastRefundDescription(1), refundFailedToastDescription(1),
    ].join(" ");
    expect(all).not.toMatch(/SMS|utrat/i);
  });
});

describe("RF3 — wybór wariantu", () => {
  it("cancelDialogBody wg wariantu", () => {
    expect(cancelDialogBody("online", 50)).toBe(cancelDialogBodyOnline(50));
    expect(cancelDialogBody("manual", 50)).toBe(cancelDialogBodyManual(50));
    expect(cancelDialogBody("none", 0)).toBe(CANCEL_DIALOG_BODY_NO_DEPOSIT);
  });

  it("toast: refundFailed → błąd bez auto-zamknięcia; zwrot online → opis; inaczej sam tytuł", () => {
    expect(salonCancelToast({ depositAmount: 50, refundFailed: true, depositVariant: "online" })).toEqual({
      kind: "error",
      title: REFUND_FAILED_TOAST_TITLE,
      description: refundFailedToastDescription(50),
      duration: Infinity,
    });
    expect(
      salonCancelToast({ depositAmount: 50, depositRefunded: true, depositVariant: "online", refund: { amount: 50 } })
    ).toEqual({ kind: "success", title: CANCELLED_TOAST_TITLE, description: cancelledToastRefundDescription(50) });
    // zadatek ręczny „zwrócony” (oznaczenie do obsługi) — bez obietnicy przelewu
    expect(salonCancelToast({ depositAmount: 30, depositRefunded: true, depositVariant: "manual" })).toEqual({
      kind: "success",
      title: CANCELLED_TOAST_TITLE,
    });
    expect(salonCancelToast({ depositAmount: 0, depositVariant: "none" })).toEqual({
      kind: "success",
      title: CANCELLED_TOAST_TITLE,
    });
  });

  it("depositVariantFor: online / manual / none", () => {
    expect(depositVariantFor("50.00", true, [{ paymentMethod: "stripe" }])).toBe("online");
    expect(depositVariantFor("50.00", true, [])).toBe("manual");
    expect(depositVariantFor("50.00", true, [{ paymentMethod: "blik" }])).toBe("manual");
    expect(depositVariantFor("50.00", false, [{ paymentMethod: "stripe" }])).toBe("none");
    expect(depositVariantFor(null, true, [])).toBe("none");
    expect(depositVariantFor("0.00", true, [])).toBe("none");
  });
});
