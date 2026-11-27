import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CalendarEventComponent } from "@/components/calendar/calendar-event";
import type { CalendarEvent } from "@/types/calendar";

// Mock the useDraggable hook
vi.mock("@/hooks/use-draggable", () => ({
  useDraggable: () => ({
    isDragging: false,
    dragProps: {
      draggable: true,
      onDragStart: vi.fn(),
      onDragEnd: vi.fn(),
      onTouchStart: vi.fn(),
      onTouchEnd: vi.fn(),
    },
    dragStartPos: null,
  }),
}));

function createMockEvent(
  overrides: Partial<CalendarEvent> & {
    appointmentOverrides?: Partial<CalendarEvent["appointment"]>;
  } = {}
): CalendarEvent {
  const { appointmentOverrides, ...eventOverrides } = overrides;
  return {
    id: "event-1",
    title: "Strzyzenie damskie",
    start: new Date("2026-03-03T10:00:00"),
    end: new Date("2026-03-03T11:00:00"),
    employeeId: "emp-1",
    employeeColor: "#3b82f6",
    appointment: {
      id: "apt-1",
      salonId: "salon-1",
      clientId: "client-1",
      employeeId: "emp-1",
      serviceId: "service-1",
      startTime: new Date("2026-03-03T10:00:00"),
      endTime: new Date("2026-03-03T11:00:00"),
      status: "scheduled",
      notes: null,
      depositAmount: null,
      depositPaid: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      client: {
        id: "client-1",
        salonId: "salon-1",
        firstName: "Anna",
        lastName: "Nowak",
        phone: null,
        email: null,
        notes: null,
        preferences: null,
        allergies: null,
        favoriteEmployeeId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      ...appointmentOverrides,
    },
    ...eventOverrides,
  };
}

describe("CalendarEventComponent", () => {
  const mockOnDragStart = vi.fn();
  const mockOnDragEnd = vi.fn();
  const mockOnClick = vi.fn();
  const mockOnCancel = vi.fn();
  const mockOnComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders event title", () => {
    const event = createMockEvent();

    render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
      />
    );

    expect(screen.getByText("Strzyzenie damskie")).toBeInTheDocument();
  });

  it("renders time range", () => {
    const event = createMockEvent();

    render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
      />
    );

    // Should display formatted time (10:00 - 11:00)
    expect(screen.getByText(/10:00/)).toBeInTheDocument();
    expect(screen.getByText(/11:00/)).toBeInTheDocument();
  });

  it("renders client name when available", () => {
    const event = createMockEvent();

    render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
      />
    );

    expect(screen.getByText("Anna Nowak")).toBeInTheDocument();
  });

  it("does not render client name when client is null", () => {
    const event = createMockEvent({
      appointmentOverrides: { client: null },
    });

    render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
      />
    );

    expect(screen.queryByText("Anna Nowak")).not.toBeInTheDocument();
  });

  it("calls onClick when event is clicked", () => {
    const event = createMockEvent();

    render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
      />
    );

    fireEvent.click(screen.getByText("Strzyzenie damskie"));

    expect(mockOnClick).toHaveBeenCalledWith(event);
  });

  it("renders cancel button for scheduled events", () => {
    const event = createMockEvent();

    render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
        onCancel={mockOnCancel}
      />
    );

    const cancelBtn = screen.getByTestId("cancel-event-btn");
    expect(cancelBtn).toBeInTheDocument();
  });

  it("calls onCancel when cancel button is clicked", () => {
    const event = createMockEvent();

    render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
        onCancel={mockOnCancel}
      />
    );

    const cancelBtn = screen.getByTestId("cancel-event-btn");
    fireEvent.click(cancelBtn);

    expect(mockOnCancel).toHaveBeenCalledWith(event);
    // Should not also trigger onClick
    expect(mockOnClick).not.toHaveBeenCalled();
  });

  it("renders complete button for scheduled events", () => {
    const event = createMockEvent();

    render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
        onComplete={mockOnComplete}
      />
    );

    const completeBtn = screen.getByTestId("complete-event-btn");
    expect(completeBtn).toBeInTheDocument();
  });

  it("calls onComplete when complete button is clicked", () => {
    const event = createMockEvent();

    render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
        onComplete={mockOnComplete}
      />
    );

    const completeBtn = screen.getByTestId("complete-event-btn");
    fireEvent.click(completeBtn);

    expect(mockOnComplete).toHaveBeenCalledWith(event);
    expect(mockOnClick).not.toHaveBeenCalled();
  });

  it("does not render cancel/complete buttons for cancelled events", () => {
    const event = createMockEvent({
      appointmentOverrides: { status: "cancelled" },
    });

    render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
        onCancel={mockOnCancel}
        onComplete={mockOnComplete}
      />
    );

    expect(screen.queryByTestId("cancel-event-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("complete-event-btn")).not.toBeInTheDocument();
  });

  it("does not render cancel/complete buttons for completed events", () => {
    const event = createMockEvent({
      appointmentOverrides: { status: "completed" },
    });

    render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
        onCancel={mockOnCancel}
        onComplete={mockOnComplete}
      />
    );

    expect(screen.queryByTestId("cancel-event-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("complete-event-btn")).not.toBeInTheDocument();
  });

  it("shows status label for cancelled events", () => {
    const event = createMockEvent({
      appointmentOverrides: { status: "cancelled" },
    });

    render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
      />
    );

    expect(screen.getByText("Anulowana")).toBeInTheDocument();
  });

  it("shows status label for completed events", () => {
    const event = createMockEvent({
      appointmentOverrides: { status: "completed" },
    });

    render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
      />
    );

    expect(screen.getByText("Zakonczona")).toBeInTheDocument();
  });

  it("shows status label for no_show events", () => {
    const event = createMockEvent({
      appointmentOverrides: { status: "no_show" },
    });

    render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
      />
    );

    expect(screen.getByText("Nie przyszedł")).toBeInTheDocument();
  });

  it("sets data-event-id and data-status attributes", () => {
    const event = createMockEvent();

    const { container } = render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
      />
    );

    const element = container.querySelector('[data-event-id="event-1"]');
    expect(element).not.toBeNull();
    expect(element?.getAttribute("data-status")).toBe("scheduled");
  });

  it("applies status-based colors by default", () => {
    const event = createMockEvent({
      appointmentOverrides: { status: "confirmed" },
    });

    const { container } = render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
      />
    );

    const element = container.firstChild as HTMLElement;
    // Confirmed status should use blue (#3b82f6)
    expect(element.style.backgroundColor).toBe("#3b82f6");
  });

  it("applies employee color when colorMode is 'employee'", () => {
    const event = createMockEvent({ employeeColor: "#ff0000" });

    const { container } = render(
      <CalendarEventComponent
        event={event}
        onDragStart={mockOnDragStart}
        onDragEnd={mockOnDragEnd}
        onClick={mockOnClick}
        colorMode="employee"
      />
    );

    const element = container.firstChild as HTMLElement;
    expect(element.style.backgroundColor).toBe("#ff0000");
  });

  // #164 - keyboard on the inner complete/cancel buttons must not open details
  describe("keyboard (#164)", () => {
    function renderWithActions(status: CalendarEvent["appointment"]["status"] = "scheduled") {
      const event = createMockEvent({ appointmentOverrides: { status } });
      render(
        <CalendarEventComponent
          event={event}
          onDragStart={mockOnDragStart}
          onDragEnd={mockOnDragEnd}
          onClick={mockOnClick}
          onCancel={mockOnCancel}
          onComplete={mockOnComplete}
        />
      );
      return event;
    }

    it.each([
      ["Enter", "{Enter}"],
      ["Space", " "],
    ])("%s on the complete button opens the complete dialog, not details", async (_name, key) => {
      const user = userEvent.setup();
      const event = renderWithActions();

      screen.getByTestId("complete-event-btn").focus();
      await user.keyboard(key);

      expect(mockOnComplete).toHaveBeenCalledTimes(1);
      expect(mockOnComplete).toHaveBeenCalledWith(event);
      expect(mockOnCancel).not.toHaveBeenCalled();
      expect(mockOnClick).not.toHaveBeenCalled();
    });

    it.each([
      ["Enter", "{Enter}"],
      ["Space", " "],
    ])("%s on the cancel button opens the cancel dialog, not details", async (_name, key) => {
      const user = userEvent.setup();
      const event = renderWithActions();

      screen.getByTestId("cancel-event-btn").focus();
      await user.keyboard(key);

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
      expect(mockOnCancel).toHaveBeenCalledWith(event);
      expect(mockOnComplete).not.toHaveBeenCalled();
      expect(mockOnClick).not.toHaveBeenCalled();
    });

    it.each([
      ["Enter", "{Enter}"],
      ["Space", " "],
    ])("%s on the event itself still opens details", async (_name, key) => {
      const user = userEvent.setup();
      const event = renderWithActions();

      screen.getByRole("button", { name: /Strzyzenie damskie, 10:00-11:00/ }).focus();
      await user.keyboard(key);

      expect(mockOnClick).toHaveBeenCalledTimes(1);
      expect(mockOnClick).toHaveBeenCalledWith(event);
      expect(mockOnCancel).not.toHaveBeenCalled();
      expect(mockOnComplete).not.toHaveBeenCalled();
    });

    it("other keys on the event do nothing", async () => {
      const user = userEvent.setup();
      renderWithActions();

      screen.getByRole("button", { name: /Strzyzenie damskie, 10:00-11:00/ }).focus();
      await user.keyboard("{Escape}a");

      expect(mockOnClick).not.toHaveBeenCalled();
    });

    it("Enter on a cancelled event (no action buttons) opens details", async () => {
      const user = userEvent.setup();
      const event = renderWithActions("cancelled");

      screen.getByRole("button", { name: /Anulowana/ }).focus();
      await user.keyboard("{Enter}");

      expect(mockOnClick).toHaveBeenCalledWith(event);
    });
  });

  describe("deposit pending marker", () => {
    function renderEvent(appointmentOverrides: Partial<CalendarEvent["appointment"]>) {
      const event = createMockEvent({ appointmentOverrides });
      return render(
        <CalendarEventComponent
          event={event}
          onDragStart={mockOnDragStart}
          onDragEnd={mockOnDragEnd}
          onClick={mockOnClick}
        />
      );
    }

    function eventLabel(): string {
      return screen.getByRole("button", { name: /Strzyzenie damskie/ }).getAttribute("aria-label") ?? "";
    }

    it.each(["scheduled", "confirmed"] as const)(
      "shows the marker for an unpaid deposit on a %s visit",
      (status) => {
        renderEvent({ status, depositAmount: "50.00", depositPaid: false });

        const marker = screen.getByTestId("deposit-pending-marker");
        expect(marker).toHaveAttribute("title", "Czeka na zadatek");
        expect(marker).toHaveTextContent("Czeka na zadatek");
        expect(eventLabel()).toContain(", czeka na zadatek");
      }
    );

    it("removes the marker after the deposit is marked as paid (rerender)", () => {
      const pending = createMockEvent({
        appointmentOverrides: { depositAmount: "50.00", depositPaid: false },
      });
      const { rerender } = render(
        <CalendarEventComponent
          event={pending}
          onDragStart={mockOnDragStart}
          onDragEnd={mockOnDragEnd}
          onClick={mockOnClick}
        />
      );
      expect(screen.getByTestId("deposit-pending-marker")).toBeInTheDocument();

      const paid = createMockEvent({
        appointmentOverrides: { depositAmount: "50.00", depositPaid: true },
      });
      rerender(
        <CalendarEventComponent
          event={paid}
          onDragStart={mockOnDragStart}
          onDragEnd={mockOnDragEnd}
          onClick={mockOnClick}
        />
      );

      expect(screen.queryByTestId("deposit-pending-marker")).not.toBeInTheDocument();
      expect(eventLabel()).not.toContain("czeka na zadatek");
    });

    it.each<[string, Partial<CalendarEvent["appointment"]>]>([
      ["paid deposit", { depositAmount: "50.00", depositPaid: true }],
      ["zero deposit", { depositAmount: "0.00", depositPaid: false }],
      ["no deposit", { depositAmount: null, depositPaid: false }],
      ["cancelled visit", { status: "cancelled", depositAmount: "50.00", depositPaid: false }],
      ["completed visit", { status: "completed", depositAmount: "50.00", depositPaid: false }],
      ["no_show visit", { status: "no_show", depositAmount: "50.00", depositPaid: false }],
    ])("does not show the marker for %s", (_name, overrides) => {
      renderEvent(overrides);

      expect(screen.queryByTestId("deposit-pending-marker")).not.toBeInTheDocument();
      expect(eventLabel()).not.toContain("czeka na zadatek");
    });
  });
});
