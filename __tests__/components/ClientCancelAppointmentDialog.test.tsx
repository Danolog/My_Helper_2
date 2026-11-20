/**
 * Okno anulowania wizyty w portalu klienta: zadatek rozliczany poza MyHelper
 * (deposit.action "salon") nie może obiecywać zwrotu ani ogłaszać przepadku —
 * neutralna informacja, że zwrot ustala salon, plus telefon salonu.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CancelAppointmentDialog } from "@/app/(client)/appointments/[id]/_components/cancel-appointment-dialog";
import type { CancelInfo } from "@/app/(client)/appointments/[id]/_types";

const SALON_TEXT = "Zwrot zadatku ustala salon, poza MyHelper.";

function cancelInfo(
  deposit: Pick<CancelInfo["deposit"], "action" | "settledBySalon">,
  salonPhone: string | null = "+48 600 100 200",
  hoursUntilAppointment = deposit.action === "forfeit" ? 5 : 48,
): CancelInfo {
  return {
    appointmentId: "appt-1",
    status: "scheduled",
    startTime: "2026-12-01T10:00:00Z",
    endTime: "2026-12-01T11:00:00Z",
    hoursUntilAppointment,
    isMoreThan24h: hoursUntilAppointment > 24,
    isPast: false,
    canCancel: true,
    deposit: { amount: 50, paid: true, ...deposit },
    employee: null,
    service: { name: "Strzyzenie", price: "100.00" },
    salon: { name: "Salon Test", phone: salonPhone },
  };
}

function renderDialog(info: CancelInfo) {
  return render(
    <CancelAppointmentDialog
      open
      onOpenChange={() => {}}
      cancelInfo={info}
      cancelLoading={false}
      cancelling={false}
      cancelError={null}
      onConfirmCancel={() => {}}
    />,
  );
}

function depositMessage(): string {
  return screen.getByTestId("deposit-action-message").textContent ?? "";
}

describe("CancelAppointmentDialog (portal klienta) — zadatek", () => {
  it("salon z telefonem: zwrot ustala salon + telefon, neutralne kolory", () => {
    renderDialog(cancelInfo({ action: "salon", settledBySalon: true }));
    expect(depositMessage()).toBe(
      "Zwrot zadatku ustala salon, poza MyHelper. Skontaktuj sie z salonem: +48 600 100 200",
    );
    const box = screen.getByTestId("deposit-info");
    expect(box.className).not.toMatch(/blue|red|green|orange/);
    expect(box.innerHTML).not.toMatch(/text-(blue|red|green)-/);
    expect(document.body.textContent).not.toMatch(/zostanie zwrocony|nie podlega zwrotowi/);
  });

  it("salon bez telefonu: zwrot ustala salon, bez numeru", () => {
    renderDialog(cancelInfo({ action: "salon", settledBySalon: true }, null));
    expect(depositMessage()).toBe(`${SALON_TEXT} Skontaktuj sie z salonem.`);
  });

  it.each([
    [">=24 h", 48],
    ["<24 h", 5],
  ])("salon (%s): box polityki neutralny, bez \"bez kosztow\" i \"utrate zadatku\"", (_label, hours) => {
    renderDialog(cancelInfo({ action: "salon", settledBySalon: true }, "+48 600 100 200", hours));
    const policy = screen.getByTestId("cancellation-policy");
    expect(screen.getByTestId("cancellation-policy-title").textContent).toBe("Zadatek rozliczany przez salon");
    expect(policy.textContent).toContain(
      "Wplacony zadatek salon rozlicza poza MyHelper — zasady zwrotu ustala salon.",
    );
    expect(policy.className).not.toMatch(/green|orange|blue|red/);
    expect(policy.innerHTML).not.toMatch(/text-(green|orange|blue|red)-/);
    expect(document.body.textContent).not.toMatch(/bez kosztow|utrate zadatku|utrata zadatku/);
  });

  it("refund (płatność online): dotychczasowe teksty zwrotu i polityki", () => {
    renderDialog(cancelInfo({ action: "refund", settledBySalon: false }));
    expect(depositMessage()).toBe("Zadatek zostanie zwrocony na Twoje konto.");
    expect(screen.getByTestId("deposit-info").className).toMatch(/blue/);
    expect(screen.getByTestId("cancellation-policy-title").textContent).toBe("Anulacja bez kosztow");
    expect(screen.getByTestId("cancellation-policy").className).toMatch(/green/);
    expect(document.body.textContent).toContain(
      "Wizyta moze byc anulowana bez kosztow (wiecej niz 24h do wizyty).",
    );
    expect(document.body.textContent).not.toContain(SALON_TEXT);
    expect(document.body.textContent).not.toContain("Zadatek rozliczany przez salon");
  });

  it("forfeit (płatność online, <24 h): dotychczasowe teksty przepadku i polityki", () => {
    renderDialog(cancelInfo({ action: "forfeit", settledBySalon: false }));
    expect(depositMessage()).toBe("Zadatek nie podlega zwrotowi (anulacja < 24h).");
    expect(screen.getByTestId("deposit-info").className).toMatch(/red/);
    expect(screen.getByTestId("cancellation-policy-title").textContent).toBe("Anulacja z utrata zadatku");
    expect(screen.getByTestId("cancellation-policy").className).toMatch(/orange/);
    expect(document.body.textContent).toContain(
      "Uwaga: Anulacja mniej niz 24h przed wizyta oznacza utrate zadatku.",
    );
    expect(document.body.textContent).not.toContain(SALON_TEXT);
    expect(document.body.textContent).not.toContain("Zadatek rozliczany przez salon");
  });
});
