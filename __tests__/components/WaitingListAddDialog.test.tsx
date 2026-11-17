import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WaitingListPage from "@/app/dashboard/waiting-list/page";
import { mutationFetch } from "@/lib/api-client";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(),
}));

// Bramka modułu sprawdzana osobno — tutaj renderuje treść strony
vi.mock("@/components/dashboard/module-gate", () => ({
  ModuleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Radix Select nie daje się wygodnie obsłużyć w jsdom — atrapa na natywnym <select>
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value ?? ""} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <option value="">{placeholder ?? ""}</option>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const CHECKBOX_LABEL =
  "Klient sam poprosił o zapis na listę oczekujących i zgadza się na wiadomość o zwolnionym terminie.";
const CONFIRM_MESSAGE = "Potwierdź, że klient sam poprosił o zapis na listę oczekujących.";
const DIALOG_DESCRIPTION = "Klient dostanie SMS lub powiadomienie, gdy zwolni się pasujący termin.";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "22222222-2222-4222-8222-222222222222";
const EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";

function jsonResponse(data: unknown) {
  return { json: async () => data } as Response;
}

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/waiting-list")) {
      return jsonResponse({ success: true, data: [] });
    }
    if (url.startsWith("/api/clients")) {
      return jsonResponse({
        success: true,
        data: [{ id: CLIENT_ID, firstName: "Ewa", lastName: "Testowa", phone: null, email: null }],
      });
    }
    if (url.startsWith("/api/services")) {
      return jsonResponse({ success: true, data: [{ id: SERVICE_ID, name: "Strzyżenie" }] });
    }
    if (url.startsWith("/api/employees")) {
      return jsonResponse({
        success: true,
        data: [{ id: EMPLOYEE_ID, firstName: "Ola", lastName: "Pracownik" }],
      });
    }
    throw new Error(`Nieoczekiwane żądanie: ${url}`);
  });
}

const mockedMutationFetch = vi.mocked(mutationFetch);

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Dodaj do listy/ }));
  const dialog = await screen.findByRole("dialog");
  // opcje ładowane asynchronicznie
  await within(dialog).findByRole("option", { name: /Ewa Testowa/ });
  return dialog;
}

function selects(dialog: HTMLElement) {
  const combos = within(dialog).getAllByRole("combobox");
  expect(combos).toHaveLength(3);
  return { client: combos[0]!, service: combos[1]!, employee: combos[2]! };
}

function lastPostBody() {
  const call = mockedMutationFetch.mock.calls.at(-1)!;
  return JSON.parse(String((call[1] as RequestInit).body));
}

describe("Lista oczekujących — okno dodawania wpisu", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
    mockedMutationFetch.mockResolvedValue(jsonResponse({ success: true, data: {} }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("pokazuje niezaznaczone pole potwierdzenia z dokładną etykietą i nowy opis okna", async () => {
    const user = userEvent.setup();
    render(<WaitingListPage />);
    const dialog = await openDialog(user);

    const checkbox = within(dialog).getByRole("checkbox", { name: CHECKBOX_LABEL });
    expect(checkbox).not.toBeChecked();
    expect(within(dialog).getByText(DIALOG_DESCRIPTION)).toBeInTheDocument();
  });

  it("bez zaznaczenia pola nie wysyła żądania i pokazuje komunikat powiązany z polem", async () => {
    const user = userEvent.setup();
    render(<WaitingListPage />);
    const dialog = await openDialog(user);

    await user.selectOptions(selects(dialog).client, CLIENT_ID);
    await user.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    expect(mockedMutationFetch).not.toHaveBeenCalled();
    const alert = within(dialog).getByRole("alert");
    expect(alert).toHaveTextContent(CONFIRM_MESSAGE);
    const checkbox = within(dialog).getByRole("checkbox", { name: CHECKBOX_LABEL });
    expect(checkbox.getAttribute("aria-describedby")).toBe(alert.id);
    expect(alert.id).not.toBe("");

    await user.click(checkbox);
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("bez wybranego klienta pierwsza działa kontrola klienta", async () => {
    const user = userEvent.setup();
    render(<WaitingListPage />);
    const dialog = await openDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    expect(mockedMutationFetch).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Wybierz klienta");
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("z zaznaczonym polem wysyła jedno żądanie z clientRequestConfirmed: true i bez innych pól", async () => {
    const user = userEvent.setup();
    render(<WaitingListPage />);
    const dialog = await openDialog(user);

    await user.selectOptions(selects(dialog).client, CLIENT_ID);
    await user.click(within(dialog).getByRole("checkbox", { name: CHECKBOX_LABEL }));
    await user.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    await waitFor(() => expect(mockedMutationFetch).toHaveBeenCalledTimes(1));
    const [url, init] = mockedMutationFetch.mock.calls[0]!;
    expect(url).toBe("/api/waiting-list");
    expect((init as RequestInit).method).toBe("POST");
    expect(lastPostBody()).toEqual({ clientId: CLIENT_ID, clientRequestConfirmed: true });
  });

  it("pozycje „Dowolna usługa” i „Dowolny pracownik” nie trafiają do treści żądania", async () => {
    const user = userEvent.setup();
    render(<WaitingListPage />);
    const dialog = await openDialog(user);
    const { client, service, employee } = selects(dialog);

    await user.selectOptions(client, CLIENT_ID);
    await user.selectOptions(service, SERVICE_ID);
    await user.selectOptions(service, "any");
    await user.selectOptions(employee, EMPLOYEE_ID);
    await user.selectOptions(employee, "any");
    await user.click(within(dialog).getByRole("checkbox", { name: CHECKBOX_LABEL }));
    await user.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    await waitFor(() => expect(mockedMutationFetch).toHaveBeenCalledTimes(1));
    const body = lastPostBody();
    expect(body).toEqual({ clientId: CLIENT_ID, clientRequestConfirmed: true });
    expect(body).not.toHaveProperty("serviceId");
    expect(body).not.toHaveProperty("preferredEmployeeId");
  });

  it("konkretna usługa i pracownik trafiają do treści żądania", async () => {
    const user = userEvent.setup();
    render(<WaitingListPage />);
    const dialog = await openDialog(user);
    const { client, service, employee } = selects(dialog);

    await user.selectOptions(client, CLIENT_ID);
    await user.selectOptions(service, SERVICE_ID);
    await user.selectOptions(employee, EMPLOYEE_ID);
    await user.click(within(dialog).getByRole("checkbox", { name: CHECKBOX_LABEL }));
    await user.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    await waitFor(() => expect(mockedMutationFetch).toHaveBeenCalledTimes(1));
    expect(lastPostBody()).toEqual({
      clientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      preferredEmployeeId: EMPLOYEE_ID,
      clientRequestConfirmed: true,
    });
  });

  it("po udanym dodaniu ponownie otwarte okno ma niezaznaczone pole", async () => {
    const user = userEvent.setup();
    render(<WaitingListPage />);
    let dialog = await openDialog(user);

    await user.selectOptions(selects(dialog).client, CLIENT_ID);
    await user.click(within(dialog).getByRole("checkbox", { name: CHECKBOX_LABEL }));
    await user.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalled();

    dialog = await openDialog(user);
    expect(within(dialog).getByRole("checkbox", { name: CHECKBOX_LABEL })).not.toBeChecked();
    expect(selects(dialog).client).toHaveValue("");
  });

  it("po „Anuluj” ponownie otwarte okno ma niezaznaczone pole i nie pokazuje komunikatu", async () => {
    const user = userEvent.setup();
    render(<WaitingListPage />);
    let dialog = await openDialog(user);

    await user.selectOptions(selects(dialog).client, CLIENT_ID);
    await user.click(within(dialog).getByRole("button", { name: "Dodaj" }));
    expect(within(dialog).getByRole("alert")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("checkbox", { name: CHECKBOX_LABEL }));
    await user.click(within(dialog).getByRole("button", { name: "Anuluj" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockedMutationFetch).not.toHaveBeenCalled();

    dialog = await openDialog(user);
    expect(within(dialog).getByRole("checkbox", { name: CHECKBOX_LABEL })).not.toBeChecked();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("odpowiedź 400 z details.clientRequestConfirmed pokazuje komunikat serwera", async () => {
    const serverMessage = "Komunikat serwera o braku potwierdzenia.";
    mockedMutationFetch.mockResolvedValue(
      jsonResponse({
        success: false,
        error: "Validation failed",
        details: { clientRequestConfirmed: serverMessage },
      })
    );
    const user = userEvent.setup();
    render(<WaitingListPage />);
    const dialog = await openDialog(user);

    await user.selectOptions(selects(dialog).client, CLIENT_ID);
    await user.click(within(dialog).getByRole("checkbox", { name: CHECKBOX_LABEL }));
    await user.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(serverMessage);
    expect(toast.error).not.toHaveBeenCalledWith("Validation failed");
  });

  it("inna odpowiedź błędu pokazuje data.error jak dotąd", async () => {
    mockedMutationFetch.mockResolvedValue(
      jsonResponse({ success: false, error: "Klient nie zostal znaleziony w tym salonie" })
    );
    const user = userEvent.setup();
    render(<WaitingListPage />);
    const dialog = await openDialog(user);

    await user.selectOptions(selects(dialog).client, CLIENT_ID);
    await user.click(within(dialog).getByRole("checkbox", { name: CHECKBOX_LABEL }));
    await user.click(within(dialog).getByRole("button", { name: "Dodaj" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Klient nie zostal znaleziony w tym salonie")
    );
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });
});
