import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CalendarLegend } from "@/components/calendar/calendar-legend";

// Mock the calendar-event module for STATUS_COLORS and STATUS_LABELS exports
vi.mock("@/components/calendar/calendar-event", () => ({
  STATUS_COLORS: {
    scheduled: { bg: "#f59e0b", border: "#d97706", text: "white" },
    confirmed: { bg: "#3b82f6", border: "#2563eb", text: "white" },
    completed: { bg: "#10b981", border: "#059669", text: "white" },
    cancelled: {
      bg: "#9ca3af",
      border: "#6b7280",
      text: "white",
      striped: true,
    },
    no_show: { bg: "#ef4444", border: "#dc2626", text: "white" },
  },
  STATUS_LABELS: {
    scheduled: "Zaplanowana",
    confirmed: "Potwierdzona",
    completed: "Zakonczona",
    cancelled: "Anulowana",
    no_show: "Niestawienie sie",
  },
}));

describe("CalendarLegend", () => {
  describe("status color mode", () => {
    it("renders legend heading for status mode", () => {
      render(<CalendarLegend colorMode="status" />);

      expect(screen.getByText("Legenda:")).toBeInTheDocument();
    });

    it("renders all status labels", () => {
      render(<CalendarLegend colorMode="status" />);

      expect(screen.getByText("Zaplanowana")).toBeInTheDocument();
      expect(screen.getByText("Potwierdzona")).toBeInTheDocument();
      expect(screen.getByText("Zakonczona")).toBeInTheDocument();
      expect(screen.getByText("Anulowana")).toBeInTheDocument();
      expect(screen.getByText("Niestawienie sie")).toBeInTheDocument();
    });

    it("renders color indicators for each status", () => {
      const { container } = render(<CalendarLegend colorMode="status" />);

      // There should be 5 color indicator divs (one per status)
      const colorIndicators = container.querySelectorAll(
        ".w-3.h-3.rounded-sm"
      );
      expect(colorIndicators).toHaveLength(5);
    });
  });

  describe("employee color mode", () => {
    const mockEmployees = [
      {
        id: "emp-1",
        firstName: "Anna",
        lastName: "Nowak",
        color: "#ff0000",
      },
      {
        id: "emp-2",
        firstName: "Jan",
        lastName: "Kowalski",
        color: "#00ff00",
      },
      { id: "emp-3", firstName: "Maria", lastName: "Wisniewska", color: null },
    ];

    it("renders employee heading for employee mode", () => {
      render(
        <CalendarLegend colorMode="employee" employees={mockEmployees} />
      );

      expect(screen.getByText("Pracownicy:")).toBeInTheDocument();
    });

    it("renders all employee names", () => {
      render(
        <CalendarLegend colorMode="employee" employees={mockEmployees} />
      );

      expect(screen.getByText("Anna Nowak")).toBeInTheDocument();
      expect(screen.getByText("Jan Kowalski")).toBeInTheDocument();
      expect(screen.getByText("Maria Wisniewska")).toBeInTheDocument();
    });

    it("renders correct employee colors", () => {
      const { container } = render(
        <CalendarLegend colorMode="employee" employees={mockEmployees} />
      );

      const colorDots = container.querySelectorAll(".w-3.h-3.rounded-sm");
      expect(colorDots).toHaveLength(3);

      // First employee: custom red
      expect((colorDots[0] as HTMLElement).style.backgroundColor).toBe(
        "#ff0000"
      );
      // Second employee: custom green
      expect((colorDots[1] as HTMLElement).style.backgroundColor).toBe(
        "#00ff00"
      );
      // Third employee: fallback blue
      expect((colorDots[2] as HTMLElement).style.backgroundColor).toBe(
        "#3b82f6"
      );
    });

    it("renders empty employee legend when no employees provided", () => {
      render(<CalendarLegend colorMode="employee" employees={[]} />);

      expect(screen.getByText("Pracownicy:")).toBeInTheDocument();
      // No employee names should be present
      expect(screen.queryByText("Anna Nowak")).not.toBeInTheDocument();
    });

    it("renders employee legend with default empty array", () => {
      render(<CalendarLegend colorMode="employee" />);

      expect(screen.getByText("Pracownicy:")).toBeInTheDocument();
    });
  });
});
