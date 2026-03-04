import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  AlertTriangle: () => <span data-testid="alert-triangle-icon" />,
}));

describe("UnsavedChangesDialog", () => {
  const mockOnConfirm = vi.fn();
  const mockOnCancel = vi.fn();
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders dialog content when open", () => {
    render(
      <UnsavedChangesDialog
        open={true}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText("Niezapisane zmiany")).toBeInTheDocument();
    expect(
      screen.getByText(/Masz niezapisane zmiany w formularzu/)
    ).toBeInTheDocument();
  });

  it("does not render dialog content when closed", () => {
    render(
      <UnsavedChangesDialog
        open={false}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.queryByText("Niezapisane zmiany")).not.toBeInTheDocument();
  });

  it("renders stay and leave buttons", () => {
    render(
      <UnsavedChangesDialog
        open={true}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByTestId("unsaved-stay-btn")).toBeInTheDocument();
    expect(screen.getByTestId("unsaved-leave-btn")).toBeInTheDocument();
  });

  it("renders correct button labels", () => {
    render(
      <UnsavedChangesDialog
        open={true}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByText("Zostac na stronie")).toBeInTheDocument();
    expect(screen.getByText("Opusc strone")).toBeInTheDocument();
  });

  it("calls onCancel when stay button is clicked", async () => {
    render(
      <UnsavedChangesDialog
        open={true}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    await user.click(screen.getByTestId("unsaved-stay-btn"));

    expect(mockOnCancel).toHaveBeenCalled();
  });

  it("calls onConfirm when leave button is clicked", async () => {
    render(
      <UnsavedChangesDialog
        open={true}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    await user.click(screen.getByTestId("unsaved-leave-btn"));

    expect(mockOnConfirm).toHaveBeenCalled();
  });

  it("renders warning icon", () => {
    render(
      <UnsavedChangesDialog
        open={true}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByTestId("alert-triangle-icon")).toBeInTheDocument();
  });

  it("has correct test-id on dialog container", () => {
    render(
      <UnsavedChangesDialog
        open={true}
        onConfirm={mockOnConfirm}
        onCancel={mockOnCancel}
      />
    );

    expect(screen.getByTestId("unsaved-changes-dialog")).toBeInTheDocument();
  });
});
