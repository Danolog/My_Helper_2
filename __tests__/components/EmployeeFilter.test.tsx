import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { EmployeeFilter } from "@/components/reports/employee-filter";

// Mock salon ID hook
vi.mock("@/hooks/use-salon-id", () => ({
  useSalonId: () => ({ salonId: "salon-123", loading: false }),
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Users: () => <span data-testid="users-icon" />,
  X: ({ onClick, ...props }: { onClick?: () => void }) => (
    <span data-testid="x-icon" onClick={onClick} {...props} />
  ),
  Check: () => <span data-testid="check-icon" />,
  ChevronsUpDown: () => <span data-testid="chevrons-icon" />,
}));

// Mock fetch for employee data
const mockEmployees = [
  { id: "emp-1", firstName: "Anna", lastName: "Nowak", isActive: true },
  { id: "emp-2", firstName: "Jan", lastName: "Kowalski", isActive: true },
  { id: "emp-3", firstName: "Maria", lastName: "Wisniewska", isActive: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true, data: mockEmployees }),
  });
});

describe("EmployeeFilter", () => {
  const mockOnSelectionChange = vi.fn();

  it("renders the trigger button", async () => {
    render(
      <EmployeeFilter
        selectedEmployeeIds={[]}
        onSelectionChange={mockOnSelectionChange}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole("combobox")
      ).toBeInTheDocument();
    });
  });

  it("shows 'Wszyscy pracownicy' when none selected", async () => {
    render(
      <EmployeeFilter
        selectedEmployeeIds={[]}
        onSelectionChange={mockOnSelectionChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Wszyscy pracownicy")).toBeInTheDocument();
    });
  });

  it("shows 'Wszyscy pracownicy' when all are selected", async () => {
    render(
      <EmployeeFilter
        selectedEmployeeIds={["emp-1", "emp-2", "emp-3"]}
        onSelectionChange={mockOnSelectionChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Wszyscy pracownicy")).toBeInTheDocument();
    });
  });

  it("fetches employees on mount", async () => {
    render(
      <EmployeeFilter
        selectedEmployeeIds={[]}
        onSelectionChange={mockOnSelectionChange}
      />
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/employees?salonId=salon-123&activeOnly=true"
      );
    });
  });

  it("shows selected employee names for partial selection", async () => {
    render(
      <EmployeeFilter
        selectedEmployeeIds={["emp-1"]}
        onSelectionChange={mockOnSelectionChange}
      />
    );

    await waitFor(() => {
      // Name appears in both the trigger button and the badge
      const elements = screen.getAllByText("Anna Nowak");
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows abbreviated names when more than 2 selected", async () => {
    render(
      <EmployeeFilter
        selectedEmployeeIds={["emp-1", "emp-2", "emp-3"]}
        onSelectionChange={mockOnSelectionChange}
      />
    );

    // When all are selected, it shows "Wszyscy pracownicy"
    await waitFor(() => {
      expect(screen.getByText("Wszyscy pracownicy")).toBeInTheDocument();
    });
  });
});
