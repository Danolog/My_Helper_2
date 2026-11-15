/**
 * refund-fix RF3 — okno odwołania wizyty przez salon: teksty z
 * `cancel-appointment-texts.ts` faktycznie w oknie, toast nieudanego zwrotu
 * bez auto-zamknięcia.
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

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

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

function mockFetch(info: unknown, deleteBody?: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.method === "DELETE" ? deleteBody : String(url).includes("cancel-info") ? info : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    })
  );
}

function renderDialog() {
  return render(
    <CancelAppointmentDialog open onOpenChange={() => {}} appointmentId="appt-1" onAppointmentCancelled={() => {}} />
  );
}

beforeEach(() => {
  toastSuccess.mockClear();
  toastError.mockClear();
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
