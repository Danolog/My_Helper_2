/**
 * AppointmentRefundStatus — karta zadatku w oknie wizyty.
 *
 * Zadatek bez płatności online (settledOutsideApp) nie może sugerować decyzji
 * o zwrocie ani ruchu pieniędzy w aplikacji.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AppointmentRefundStatus } from "@/components/appointments/detail/appointment-refund-status";
import type { AppointmentDetail, RefundStatus } from "@/components/appointments/detail/types";

const APPT_ID = "11111111-1111-4111-8111-111111111111";

function appointment(over: Partial<AppointmentDetail> = {}): AppointmentDetail {
  return {
    id: APPT_ID,
    salonId: "salon-a",
    clientId: null,
    employeeId: "emp-a",
    serviceId: null,
    startTime: "2026-11-25T10:00:00.000Z",
    endTime: "2026-11-25T11:00:00.000Z",
    status: "cancelled",
    notes: null,
    depositAmount: "50.00",
    depositPaid: false,
    createdAt: "2026-11-20T10:00:00.000Z",
    updatedAt: "2026-11-20T10:00:00.000Z",
    client: null,
    employee: null,
    service: null,
    ...over,
  };
}

function outsideApp(depositPaid: boolean): RefundStatus {
  return {
    appointmentId: APPT_ID,
    hasDeposit: true,
    depositAmount: 50,
    depositPaid,
    paymentMethod: null,
    paymentStatus: null,
    refundStatus: "none",
    refundAmount: 0,
    forfeitedAmount: 0,
    settledOutsideApp: true,
  };
}

const FORBIDDEN = ["Brak zwrotu", "BLIK P2P", "Zadatek zatrzymany", "Przepadek", "Zwrocono", "Status zwrotu"];

function expectNoRefundWording(container: HTMLElement) {
  for (const text of FORBIDDEN) {
    expect(container.textContent).not.toContain(text);
  }
}

describe("wizyta anulowana, zadatek poza MyHelper", () => {
  it("wpłacony → tekst „poza MyHelper”, kwota, bez statusów zwrotu/przepadku i metody płatności", () => {
    const { container } = render(
      <AppointmentRefundStatus appointment={appointment({ depositPaid: true })} refundStatus={outsideApp(true)} />
    );

    expect(screen.getByTestId("deposit-outside-app-label").textContent).toBe(
      "Zadatek rozliczany poza MyHelper — zwrot ustala salon"
    );
    expect(screen.getByTestId("deposit-outside-app-amount").textContent).toBe("50.00 PLN");
    expect(screen.queryByTestId("refund-status-card")).toBeNull();
    expectNoRefundWording(container);
  });

  it("nieoznaczony → „Zadatek nie zostal oznaczony jako wplacony”, bez słownictwa zwrotu", () => {
    const { container } = render(
      <AppointmentRefundStatus appointment={appointment()} refundStatus={outsideApp(false)} />
    );

    expect(screen.getByTestId("deposit-outside-app-label").textContent).toBe("Zadatek nie zostal oznaczony jako wplacony");
    expect(screen.queryByTestId("refund-status-card")).toBeNull();
    expect(container.textContent).not.toContain("poza MyHelper");
    expectNoRefundWording(container);
  });

  it("hasDeposit=false → żadnej karty", () => {
    const { container } = render(
      <AppointmentRefundStatus
        appointment={appointment({ depositAmount: null })}
        refundStatus={{
          appointmentId: APPT_ID,
          hasDeposit: false,
          depositPaid: false,
          paymentMethod: null,
          paymentStatus: null,
          refundStatus: "none",
          refundAmount: 0,
          forfeitedAmount: 0,
          settledOutsideApp: true,
        }}
      />
    );

    expect(container.textContent).toBe("");
  });
});

describe("wizyta anulowana z płatnością online", () => {
  it("Stripe, brak zwrotu → dawne teksty", () => {
    render(
      <AppointmentRefundStatus
        appointment={appointment({ depositPaid: true })}
        refundStatus={{
          appointmentId: APPT_ID,
          hasDeposit: true,
          depositAmount: 50,
          depositPaid: true,
          paymentMethod: "stripe",
          paymentStatus: "succeeded",
          refundStatus: "none",
          refundAmount: 0,
          forfeitedAmount: 0,
          settledOutsideApp: false,
        }}
      />
    );

    expect(screen.getByTestId("refund-status-card")).toBeTruthy();
    expect(screen.getByTestId("refund-status-label").textContent).toBe("Zadatek zatrzymany");
    expect(screen.getByTestId("refund-status-badge").textContent).toBe("Brak zwrotu");
    expect(screen.getByText("Karta (Stripe)")).toBeTruthy();
    expect(screen.queryByTestId("deposit-outside-app-card")).toBeNull();
  });

  it("Stripe, zwrot → „Zwrot zrealizowany”, także bez pola settledOutsideApp (starsza odpowiedź)", () => {
    render(
      <AppointmentRefundStatus
        appointment={appointment({ depositPaid: true })}
        refundStatus={{
          appointmentId: APPT_ID,
          hasDeposit: true,
          depositAmount: 50,
          depositPaid: true,
          paymentMethod: "stripe",
          paymentStatus: "refunded",
          refundStatus: "refunded",
          refundAmount: 50,
          stripeRefundId: "re_123",
        }}
      />
    );

    expect(screen.getByTestId("refund-status-label").textContent).toBe("Zwrot zrealizowany");
    expect(screen.getByTestId("refund-status-badge").textContent).toBe("Zwrocono");
    expect(screen.getByTestId("refund-id").textContent).toBe("re_123");
  });
});

describe("wizyta nieanulowana", () => {
  it.each([
    [true, "Oplacony"],
    [false, "Nieoplacony"],
  ])("karta „Zadatek” (depositPaid=%s → %s), bez karty zwrotu", (paid, badge) => {
    render(
      <AppointmentRefundStatus
        appointment={appointment({ status: "scheduled", depositPaid: paid })}
        refundStatus={outsideApp(paid)}
      />
    );

    expect(screen.getByTestId("deposit-info-card")).toBeTruthy();
    expect(screen.getByTestId("deposit-paid-badge").textContent).toBe(badge);
    expect(screen.queryByTestId("deposit-outside-app-card")).toBeNull();
    expect(screen.queryByTestId("refund-status-card")).toBeNull();
  });
});
