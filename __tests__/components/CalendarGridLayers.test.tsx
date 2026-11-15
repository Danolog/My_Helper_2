/**
 * #164 - a cancelled appointment must not cover an active one booked in the same slot.
 *
 * jsdom has no hit-testing (no layout, no elementFromPoint), so "the click lands on the
 * active event" is asserted through the stacking contract that decides it in a browser:
 * both layers are absolutely positioned siblings, so the one with the higher z-index wins.
 * The real pointer path is covered by the E2E specs from #163 once they switch back to click().
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TimeGrid } from "@/components/calendar/time-grid";
import { WeekTimeGrid } from "@/components/calendar/week-time-grid";
import type { CalendarEvent, Employee } from "@/types/calendar";

vi.mock("@/hooks/use-draggable", () => ({
  useDraggable: () => ({ isDragging: false, dragProps: {}, dragStartPos: null }),
}));

const DAY = new Date("2026-03-03T00:00:00"); // Tuesday

const employee: Employee = {
  id: "emp-1",
  salonId: "salon-1",
  firstName: "Ewa",
  lastName: "Kowalska",
  phone: null,
  email: null,
  photoUrl: null,
  role: "employee",
  isActive: true,
  color: "#3b82f6",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeEvent(
  id: string,
  status: CalendarEvent["appointment"]["status"],
  title: string
): CalendarEvent {
  const start = new Date("2026-03-03T10:00:00");
  const end = new Date("2026-03-03T11:00:00");
  return {
    id,
    title,
    start,
    end,
    employeeId: employee.id,
    employeeColor: "#3b82f6",
    appointment: {
      id: `apt-${id}`,
      salonId: "salon-1",
      clientId: "client-1",
      employeeId: employee.id,
      serviceId: "service-1",
      startTime: start,
      endTime: end,
      status,
      notes: null,
      depositAmount: null,
      depositPaid: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      client: null,
    },
  };
}

// Both orders are tested below: stacking must not depend on array/DOM order.
const cancelled = makeEvent("ev-cancelled", "cancelled", "Strzyzenie anulowane");
const active = makeEvent("ev-active", "scheduled", "Strzyzenie aktywne");

function zIndexOf(layer: HTMLElement): number {
  const match = layer.className.match(/\bz-\[(\d+)\]/);
  if (!match) throw new Error(`event layer without z-index class: "${layer.className}"`);
  return Number(match[1]);
}

function layerOf(eventId: string, container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-event-id="${eventId}"]`);
  if (!el) throw new Error(`event ${eventId} not rendered`);
  // The positioned wrapper rendered by the grid around CalendarEventComponent.
  const layer = el.parentElement;
  if (!layer) throw new Error(`event ${eventId} has no layer wrapper`);
  return layer;
}

const onEventClick = vi.fn();
const onEventCancel = vi.fn();
const onEventComplete = vi.fn();

function renderDay(events: CalendarEvent[]) {
  return render(
    <TimeGrid
      date={DAY}
      employees={[employee]}
      events={events}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      onDrop={vi.fn()}
      onEventClick={onEventClick}
      onEventCancel={onEventCancel}
      onEventComplete={onEventComplete}
      draggedEvent={null}
    />
  );
}

function renderWeek(events: CalendarEvent[]) {
  return render(
    <WeekTimeGrid
      weekStart={DAY}
      employees={[employee]}
      events={events}
      onEventClick={onEventClick}
      onEventCancel={onEventCancel}
      onEventComplete={onEventComplete}
      onDayClick={vi.fn()}
    />
  );
}

describe.each([
  ["day view (TimeGrid)", renderDay],
  ["week view (WeekTimeGrid)", renderWeek],
])("%s - cancelled vs active in the same slot (#164)", (_name, renderGrid) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["cancelled listed first", [cancelled, active]],
    ["cancelled listed last", [active, cancelled]],
  ])("active event is stacked above the cancelled one (%s)", (_order, events) => {
    const { container } = renderGrid(events);

    expect(zIndexOf(layerOf(active.id, container))).toBeGreaterThan(
      zIndexOf(layerOf(cancelled.id, container))
    );
  });

  it("cancelled event stays rendered and greyed out", () => {
    const { container } = renderGrid([cancelled, active]);

    const el = container.querySelector<HTMLElement>(`[data-event-id="${cancelled.id}"]`)!;
    expect(el).toBeInTheDocument();
    expect(el.getAttribute("data-status")).toBe("cancelled");
    expect(el.className).toMatch(/\bopacity-60\b/);
  });

  it("click on the active event opens its details", async () => {
    const user = userEvent.setup();
    renderGrid([cancelled, active]);

    await user.click(screen.getByText(active.title));

    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick).toHaveBeenCalledWith(active);
  });

  it("complete/cancel buttons of the active event reach their handlers", async () => {
    const user = userEvent.setup();
    const { container } = renderGrid([cancelled, active]);
    const activeEl = container.querySelector<HTMLElement>(`[data-event-id="${active.id}"]`)!;

    await user.click(within(activeEl).getByTestId("complete-event-btn"));
    await user.click(within(activeEl).getByTestId("cancel-event-btn"));

    expect(onEventComplete).toHaveBeenCalledWith(active);
    expect(onEventCancel).toHaveBeenCalledWith(active);
    expect(onEventClick).not.toHaveBeenCalled();
  });

  it("a lone cancelled event can still be opened", async () => {
    const user = userEvent.setup();
    renderGrid([cancelled]);

    await user.click(screen.getByText(cancelled.title));

    expect(onEventClick).toHaveBeenCalledWith(cancelled);
  });
});
