/**
 * refund-fix RF3 — okno odwołania wizyty przez salon: teksty z
 * `cancel-appointment-texts.ts` faktycznie w oknie, toast nieudanego zwrotu
 * bez auto-zamknięcia. Odmowa serwera: wizyty nie ma / już odwołana zamyka
 * okno i odświeża kalendarz; 500 z opisem bez powtórzenia tytułu.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CancelAppointmentDialog } from "@/components/appointments/cancel-appointment-dialog";
import {
  CANCEL_DIALOG_BACK,
  CANCEL_DIALOG_BODY_NO_DEPOSIT,
  CANCEL_DIALOG_CONFIRM,
  CANCEL_DIALOG_TITLE,
  CANCELLED_TOAST_TITLE,
  REFUND_FAILED_TOAST_TITLE,
  cancelDialogBodyManual,
  cancelDialogBodyOnline,
  cancelledToastRefundDescription,
  refundFailedToastDescription,
} from "@/components/appointments/cancel-appointment-texts";

const { toastSuccess, toastError, toastInfo } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError, info: toastInfo } }));

function cancelInfo(deposit: { amount: number; paid: boolean; variant: "online" | "manual" | "none" }) {
  return {
    success: true,
    data: {
      appointmentId: "appt-1",
      status: "scheduled",
      startTime: "2026-11-20T10:00:00Z",
      endTime: "2026-11-20T11:00:00Z",
      hoursUntilAppointment: 2,
      isMoreThan24h: false,
      isPast: false,
      deposit: { ...deposit, action: deposit.paid ? "refund" : "none" },
      client: { id: "c-1", name: "Anna Test", phone: null, email: null },
      employee: null,
      service: { id: "s-1", name: "Strzyżenie", price: "100.00" },
    },
  };
}

function mockFetch(info: unknown, deleteBody?: unknown, deleteStatus = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const isDelete = init?.method === "DELETE";
      const body = isDelete ? deleteBody : String(url).includes("cancel-info") ? info : {};
      return new Response(JSON.stringify(body), {
        status: isDelete ? deleteStatus : 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
}

function renderDialog(onOpenChange: (open: boolean) => void = () => {}, onAppointmentCancelled: () => void = () => {}) {
  return render(
    <CancelAppointmentDialog
      open
      onOpenChange={onOpenChange}
      appointmentId="appt-1"
      onAppointmentCancelled={onAppointmentCancelled}
    />
  );
}

beforeEach(() => {
  toastSuccess.mockClear();
  toastError.mockClear();
  toastInfo.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("CancelAppointmentDialog (RF3)", () => {
  it("zadatek online: tytuł, treść 1, przyciski; brak tekstów o utracie zadatku", async () => {
    mockFetch(cancelInfo({ amount: 50, paid: true, variant: "online" }));
    renderDialog();

    expect(await screen.findByText(cancelDialogBodyOnline(50))).toBeTruthy();
    expect(screen.getByText(CANCEL_DIALOG_TITLE)).toBeTruthy();
    expect(screen.getByText(CANCEL_DIALOG_CONFIRM)).toBeTruthy();
    expect(screen.getByText(CANCEL_DIALOG_BACK)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/utrat|bez kosztow|Anulacja/i);
  });

  it("zadatek wpłacony do salonu: treść 1b; bez zadatku: treść 2", async () => {
    mockFetch(cancelInfo({ amount: 30, paid: true, variant: "manual" }));
    const { unmount } = renderDialog();
    expect(await screen.findByText(cancelDialogBodyManual(30))).toBeTruthy();
    unmount();

    mockFetch(cancelInfo({ amount: 0, paid: false, variant: "none" }));
    renderDialog();
    expect(await screen.findByText(CANCEL_DIALOG_BODY_NO_DEPOSIT)).toBeTruthy();
  });

  it("po odwołaniu ze zwrotem: toast 3", async () => {
    mockFetch(cancelInfo({ amount: 50, paid: true, variant: "online" }), {
      success: true,
      cancellationDetails: { depositAmount: 50, depositRefunded: true, depositVariant: "online", refundFailed: false, refund: { amount: 50 } },
    });
    renderDialog();
    fireEvent.click(await screen.findByText(CANCEL_DIALOG_CONFIRM));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(CANCELLED_TOAST_TITLE, { description: cancelledToastRefundDescription(50) })
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it("zwrot się nie udał: toast 4 bez auto-zamknięcia (duration Infinity)", async () => {
    mockFetch(cancelInfo({ amount: 50, paid: true, variant: "online" }), {
      success: true,
      cancellationDetails: { depositAmount: 50, depositRefunded: false, depositVariant: "online", refundFailed: true, refund: { amount: null } },
    });
    renderDialog();
    fireEvent.click(await screen.findByText(CANCEL_DIALOG_CONFIRM));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(REFUND_FAILED_TOAST_TITLE, {
        description: refundFailedToastDescription(50),
        duration: Infinity,
      })
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

const NO_DEPOSIT = { amount: 0, paid: false, variant: "none" as const };
const FAILED_TITLE = "Nie udało się odwołać wizyty";

async function confirmWith(deleteBody: unknown, deleteStatus: number) {
  const onOpenChange = vi.fn();
  const onAppointmentCancelled = vi.fn();
  mockFetch(cancelInfo(NO_DEPOSIT), deleteBody, deleteStatus);
  renderDialog(onOpenChange, onAppointmentCancelled);
  fireEvent.click(await screen.findByText(CANCEL_DIALOG_CONFIRM));
  return { onOpenChange, onAppointmentCancelled };
}

function deleteCalls() {
  const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
  return calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "DELETE").length;
}

describe("CancelAppointmentDialog — odmowa serwera", () => {
  describe("404 APPOINTMENT_NOT_FOUND", () => {
    it("zamyka okno, odświeża kalendarz, toast.info z własnym tekstem zamiast data.error", async () => {
      const { onOpenChange, onAppointmentCancelled } = await confirmWith(
        { success: false, code: "APPOINTMENT_NOT_FOUND", error: "Nie znaleziono wizyty. Odśwież kalendarz." },
        404
      );

      await waitFor(() =>
        expect(toastInfo).toHaveBeenCalledWith("Tej wizyty nie ma już w kalendarzu", {
          description: "Ktoś ją zmienił albo usunął w międzyczasie. Odświeżyliśmy kalendarz.",
        })
      );
      expect(toastInfo).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onAppointmentCancelled).toHaveBeenCalledTimes(1);
      expect(toastError).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
    });

    it("brzeg: body bez pola error — ten sam toast i zamknięcie", async () => {
      const { onOpenChange, onAppointmentCancelled } = await confirmWith(
        { success: false, code: "APPOINTMENT_NOT_FOUND" },
        404
      );

      await waitFor(() => expect(onAppointmentCancelled).toHaveBeenCalledTimes(1));
      expect(toastInfo).toHaveBeenCalledWith("Tej wizyty nie ma już w kalendarzu", {
        description: "Ktoś ją zmienił albo usunął w międzyczasie. Odświeżyliśmy kalendarz.",
      });
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(toastError).not.toHaveBeenCalled();
    });

    it("brzeg: 404 bez pola code — jak dotąd (błąd z data.error, okno otwarte, bez odświeżenia)", async () => {
      const { onOpenChange, onAppointmentCancelled } = await confirmWith(
        { success: false, error: "Not found" },
        404
      );

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(FAILED_TITLE, { description: "Not found" }));
      expect(toastInfo).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(onAppointmentCancelled).not.toHaveBeenCalled();
    });
  });

  describe("400 APPOINTMENT_CANCELLED", () => {
    it("zamyka okno, odświeża kalendarz, toast.info zamiast błędu i bez sukcesu", async () => {
      const { onOpenChange, onAppointmentCancelled } = await confirmWith(
        { success: false, code: "APPOINTMENT_CANCELLED", error: "Ta wizyta jest już odwołana." },
        400
      );

      await waitFor(() =>
        expect(toastInfo).toHaveBeenCalledWith("Ta wizyta jest już odwołana", {
          description: "Ktoś zrobił to wcześniej, nic więcej nie trzeba robić. Odświeżyliśmy kalendarz.",
        })
      );
      expect(toastInfo).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onAppointmentCancelled).toHaveBeenCalledTimes(1);
      expect(toastError).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
    });

    it("brzeg: inny kod 400 (wizyta „Nie przyszedł”) — jak dotąd, data.error, okno otwarte", async () => {
      const { onOpenChange, onAppointmentCancelled } = await confirmWith(
        { success: false, code: "NO_SHOW_DEDICATED_ROUTE", error: "Najpierw cofnij oznaczenie." },
        400
      );

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(FAILED_TITLE, { description: "Najpierw cofnij oznaczenie." })
      );
      expect(toastInfo).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(onAppointmentCancelled).not.toHaveBeenCalled();
    });
  });

  describe("500", () => {
    it("toast błędu z opisem bez powtórzenia tytułu, okno otwarte, bez odświeżenia", async () => {
      const { onOpenChange, onAppointmentCancelled } = await confirmWith(
        { success: false, error: "Nie udało się odwołać wizyty. Spróbuj ponownie." },
        500
      );

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(FAILED_TITLE, { description: "Spróbuj ponownie za chwilę." })
      );
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastInfo).not.toHaveBeenCalled();
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(onAppointmentCancelled).not.toHaveBeenCalled();
    });

    it("brzeg: po 500 przycisk dalej działa — druga próba wysyła drugi DELETE", async () => {
      await confirmWith({ success: false }, 500);
      await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));

      const confirm = await screen.findByText(CANCEL_DIALOG_CONFIRM);
      await waitFor(() => expect((confirm.closest("button") as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(confirm);

      await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));
      expect(deleteCalls()).toBe(2);
      expect(toastError).toHaveBeenLastCalledWith(FAILED_TITLE, { description: "Spróbuj ponownie za chwilę." });
    });
  });

  describe("ścieżki bez zmian", () => {
    it("404 SALON_NOT_FOUND — błąd z data.error, okno otwarte, bez odświeżenia", async () => {
      const { onOpenChange, onAppointmentCancelled } = await confirmWith(
        { success: false, code: "SALON_NOT_FOUND", error: "Nie znaleziono salonu." },
        404
      );

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(FAILED_TITLE, { description: "Nie znaleziono salonu." })
      );
      expect(toastInfo).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(onAppointmentCancelled).not.toHaveBeenCalled();
    });

    it("409 APPOINTMENT_COMPLETED — błąd z data.error, okno otwarte, bez odświeżenia", async () => {
      const { onOpenChange, onAppointmentCancelled } = await confirmWith(
        { success: false, code: "APPOINTMENT_COMPLETED", error: "Wizyta jest zakończona." },
        409
      );

      await waitFor(() =>
        expect(toastError).toHaveBeenCalledWith(FAILED_TITLE, { description: "Wizyta jest zakończona." })
      );
      expect(toastInfo).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(onAppointmentCancelled).not.toHaveBeenCalled();
    });

    it("błąd sieci — „Błąd podczas odwoływania wizyty”, okno otwarte, bez odświeżenia", async () => {
      const onOpenChange = vi.fn();
      const onAppointmentCancelled = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          if (init?.method === "DELETE") throw new TypeError("Failed to fetch");
          return new Response(JSON.stringify(cancelInfo(NO_DEPOSIT)), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        })
      );
      renderDialog(onOpenChange, onAppointmentCancelled);
      fireEvent.click(await screen.findByText(CANCEL_DIALOG_CONFIRM));

      await waitFor(() => expect(toastError).toHaveBeenCalledWith("Błąd podczas odwoływania wizyty"));
      expect(toastInfo).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(onAppointmentCancelled).not.toHaveBeenCalled();
    });

    it("sukces — toast sukcesu, zamknięcie i odświeżenie, bez toast.info", async () => {
      const { onOpenChange, onAppointmentCancelled } = await confirmWith(
        { success: true, cancellationDetails: { depositAmount: 0, depositRefunded: false, depositVariant: "none" } },
        200
      );

      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Wizyta odwołana", undefined));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onAppointmentCancelled).toHaveBeenCalledTimes(1);
      expect(toastInfo).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
    });
  });
});
