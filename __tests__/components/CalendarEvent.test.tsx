import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

    expect(screen.getByText("Niestawienie sie")).toBeInTheDocument();
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
});
