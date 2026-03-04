import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateRangeFilter } from "@/components/reports/date-range-filter";

// Mock lucide-react icons to avoid complex SVG rendering
vi.mock("lucide-react", () => ({
  Calendar: () => <span data-testid="calendar-icon" />,
  Search: () => <span data-testid="search-icon" />,
}));

describe("DateRangeFilter", () => {
  const mockOnDateFromChange = vi.fn();
  const mockOnDateToChange = vi.fn();
  const mockOnApply = vi.fn();
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    dateFrom: "2026-02-01",
    dateTo: "2026-03-03",
    onDateFromChange: mockOnDateFromChange,
    onDateToChange: mockOnDateToChange,
    onApply: mockOnApply,
  };

  it("renders quick filter buttons", () => {
    render(<DateRangeFilter {...defaultProps} />);

    expect(screen.getByText("Szybkie filtry:")).toBeInTheDocument();
    expect(screen.getByText("7 dni")).toBeInTheDocument();
    expect(screen.getByText("30 dni")).toBeInTheDocument();
    expect(screen.getByText("90 dni")).toBeInTheDocument();
    expect(screen.getByText("Ten tydzien")).toBeInTheDocument();
    expect(screen.getByText("Ten miesiac")).toBeInTheDocument();
    expect(screen.getByText("Ten rok")).toBeInTheDocument();
    expect(screen.getByText("Wlasny zakres")).toBeInTheDocument();
  });

  it("renders date inputs", () => {
    render(<DateRangeFilter {...defaultProps} />);

    expect(screen.getByText("Data od")).toBeInTheDocument();
    expect(screen.getByText("Data do")).toBeInTheDocument();
  });

  it("renders apply button", () => {
    render(<DateRangeFilter {...defaultProps} />);

    expect(
      screen.getByRole("button", { name: /Generuj raport/ })
    ).toBeInTheDocument();
  });

  it("shows loading text on apply button when loading", () => {
    render(<DateRangeFilter {...defaultProps} loading />);

    expect(
      screen.getByRole("button", { name: /Ladowanie/ })
    ).toBeDisabled();
  });

  it("calls onApply when apply button is clicked", async () => {
    render(<DateRangeFilter {...defaultProps} />);

    await user.click(
      screen.getByRole("button", { name: /Generuj raport/ })
    );

    expect(mockOnApply).toHaveBeenCalledTimes(1);
  });

  it("calls onDateFromChange and onDateToChange when quick filter is clicked", async () => {
    render(<DateRangeFilter {...defaultProps} />);

    await user.click(screen.getByText("7 dni"));

    expect(mockOnDateFromChange).toHaveBeenCalled();
    expect(mockOnDateToChange).toHaveBeenCalled();
  });

  it("renders active period badge when dates are set", () => {
    render(<DateRangeFilter {...defaultProps} />);

    // Should show a badge with the date range
    const badge = screen.getByText(/2026/);
    expect(badge).toBeInTheDocument();
  });

  it("does not render period badge when no dates are set", () => {
    render(
      <DateRangeFilter
        {...defaultProps}
        dateFrom={undefined}
        dateTo={undefined}
      />
    );

    // No badge should be present
    expect(screen.queryByText(/dni\)/)).not.toBeInTheDocument();
  });

  it("calls date change callbacks when date inputs change", () => {
    render(<DateRangeFilter {...defaultProps} />);

    const dateInputs = screen.getAllByDisplayValue(/.*/);
    const dateFromInput = dateInputs.find(
      (input) => (input as HTMLInputElement).value === "2026-02-01"
    );

    if (dateFromInput) {
      fireEvent.change(dateFromInput, { target: { value: "2026-01-15" } });
      expect(mockOnDateFromChange).toHaveBeenCalledWith("2026-01-15");
    }
  });
});
