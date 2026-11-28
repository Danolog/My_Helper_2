import React from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EmployeePricingCard } from "@/app/dashboard/services/[id]/_components/employee-pricing-card";
import { useEmployeePricing } from "@/app/dashboard/services/[id]/_hooks/use-employee-pricing";
import type {
  Employee,
  EmployeePrice,
  ServiceDetail,
} from "@/app/dashboard/services/[id]/_types";
import { mutationFetch } from "@/lib/api-client";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(),
}));

// Radix Select nie daje się wygodnie obsłużyć w jsdom — atrapa na natywnym <select>
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <select
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <option value="">{placeholder ?? ""}</option>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({
    value,
    disabled,
    children,
  }: {
    value: string;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <option value={value} disabled={disabled}>
      {children}
    </option>
  ),
}));

const SERVICE_ID = "11111111-1111-4111-8111-111111111111";
const EMP_ANNA = "22222222-2222-4222-8222-222222222222";
const EMP_OLA = "33333333-3333-4333-8333-333333333333";
const EMP_EWA = "44444444-4444-4444-8444-444444444444";
const PRICE_ANNA = "55555555-5555-4555-8555-555555555555";
const PRICE_EWA_VARIANT = "66666666-6666-4666-8666-666666666666";
const VARIANT_ID = "77777777-7777-4777-8777-777777777777";

const service: ServiceDetail = {
  id: SERVICE_ID,
  salonId: "88888888-8888-4888-8888-888888888888",
  categoryId: null,
  name: "Strzyżenie",
  description: null,
  basePrice: "100.00",
  baseDuration: 60,
  isActive: true,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  category: null,
  variants: [],
};

const anna: Employee = {
  id: EMP_ANNA,
  firstName: "Anna",
  lastName: "Nowak",
  role: "owner",
  isActive: true,
  color: null,
};
const ola: Employee = {
  id: EMP_OLA,
  firstName: "Ola",
  lastName: "Pracownik",
  role: "owner",
  isActive: true,
  color: null,
};
const ewa: Employee = {
  id: EMP_EWA,
  firstName: "Ewa",
  lastName: "Wariant",
  role: "employee",
  isActive: true,
  color: null,
};

const annaPrice: EmployeePrice = {
  id: PRICE_ANNA,
  employeeId: EMP_ANNA,
  serviceId: SERVICE_ID,
  variantId: null,
  customPrice: "120.00",
  createdAt: "2026-11-01T00:00:00.000Z",
  employee: anna,
  variant: null,
};

const ewaVariantPrice: EmployeePrice = {
  id: PRICE_EWA_VARIANT,
  employeeId: EMP_EWA,
  serviceId: SERVICE_ID,
  variantId: VARIANT_ID,
  customPrice: "90.00",
  createdAt: "2026-11-01T00:00:00.000Z",
  employee: ewa,
  variant: null,
};

const ALL_EMPLOYEES = [anna, ola, ewa];

const mockedMutationFetch = vi.mocked(mutationFetch);
const mockedToast = vi.mocked(toast);

// Niezużyte mockResolvedValueOnce nie mogą przechodzić do kolejnego testu.
beforeEach(() => {
  mockedMutationFetch.mockReset();
});

function jsonResponse(data: unknown) {
  return { json: async () => data } as Response;
}

function Harness({
  employeePrices,
  onSuccess,
}: {
  employeePrices: EmployeePrice[];
  onSuccess: () => Promise<void>;
}) {
  const p = useEmployeePricing({
    serviceId: SERVICE_ID,
    allEmployees: ALL_EMPLOYEES,
    onSuccess,
  });
  return (
    <EmployeePricingCard
      service={service}
      employeePrices={employeePrices}
      allEmployees={ALL_EMPLOYEES}
      empPriceDialogOpen={p.empPriceDialogOpen}
      setEmpPriceDialogOpen={p.setEmpPriceDialogOpen}
      empPriceEmployeeId={p.empPriceEmployeeId}
      setEmpPriceEmployeeId={p.setEmpPriceEmployeeId}
      empPriceCustomPrice={p.empPriceCustomPrice}
      setEmpPriceCustomPrice={p.setEmpPriceCustomPrice}
      savingEmpPrice={p.savingEmpPrice}
      editingEmpPrice={p.editingEmpPrice}
      openEditEmployeePrice={p.openEditEmployeePrice}
      resetEmpPriceForm={p.resetEmpPriceForm}
      handleSaveEmployeePrice={p.handleSaveEmployeePrice}
      handleDeleteEmployeePrice={p.handleDeleteEmployeePrice}
    />
  );
}

function renderCard(employeePrices: EmployeePrice[] = [annaPrice, ewaVariantPrice]) {
  const onSuccess = vi.fn(async () => {});
  render(<Harness employeePrices={employeePrices} onSuccess={onSuccess} />);
  return { onSuccess };
}

function lastPost() {
  const call = mockedMutationFetch.mock.calls.at(-1)!;
  const init = call[1] as RequestInit;
  return { url: call[0], method: init.method, body: JSON.parse(String(init.body)) };
}

function optionNames(dialog: HTMLElement) {
  return within(dialog)
    .getAllByRole("option")
    .map((o) => o.textContent);
}

describe("EmployeePricingCard — zmiana istniejącej ceny", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("przycisk „Zmień cenę” otwiera dialog z zablokowanym pracownikiem i bieżącą ceną", async () => {
    const user = userEvent.setup();
    renderCard();

    const editBtn = screen.getByRole("button", { name: "Zmień cenę: Anna Nowak" });
    expect(editBtn.textContent).toEqual("Zmień cenę");
    await user.click(editBtn);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading").textContent).toEqual(
      "Zmień cenę indywidualną",
    );
    const select = within(dialog).getByRole("combobox");
    expect(select).toBeDisabled();
    expect((select as HTMLSelectElement).value).toEqual(EMP_ANNA);
    expect(optionNames(dialog)).toEqual(["Wybierz pracownika", "Anna Nowak(właściciel)"]);
    expect(within(dialog).getByTestId("employee-price-input")).toHaveValue(120);
  });

  it("zapis zmienionej ceny idzie POST-em z tym samym pracownikiem i nową ceną", async () => {
    const user = userEvent.setup();
    const { onSuccess } = renderCard();
    mockedMutationFetch.mockResolvedValueOnce(
      jsonResponse({ success: true, updated: true }),
    );

    await user.click(screen.getByRole("button", { name: "Zmień cenę: Anna Nowak" }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByTestId("employee-price-input");
    await user.clear(input);
    await user.type(input, "150");
    await user.click(within(dialog).getByRole("button", { name: "Zapisz cenę" }));

    expect(lastPost()).toEqual({
      url: `/api/services/${SERVICE_ID}/employee-prices`,
      method: "POST",
      body: { employeeId: EMP_ANNA, customPrice: "150" },
    });
    expect(mockedToast.success).toHaveBeenCalledWith("Cena dla Anna Nowak zaktualizowana");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pracownik spoza listy aktywnych: dialog bierze imię z wiersza ceny", async () => {
    const user = userEvent.setup();
    const outsider: Employee = { ...ewa, id: "99999999-9999-4999-8999-999999999999", firstName: "Iza", lastName: "Była" };
    renderCard([{ ...annaPrice, id: PRICE_EWA_VARIANT, employeeId: outsider.id, employee: outsider }]);

    await user.click(screen.getByRole("button", { name: "Zmień cenę: Iza Była" }));
    const dialog = await screen.findByRole("dialog");
    expect(optionNames(dialog)).toEqual(["Wybierz pracownika", "Iza Była"]);
  });

  it("wiersz bez danych pracownika: dialog pokazuje „Nieznany pracownik”", async () => {
    const user = userEvent.setup();
    const ghostId = "99999999-9999-4999-8999-999999999999";
    renderCard([{ ...annaPrice, employeeId: ghostId, employee: null }]);

    await user.click(screen.getByRole("button", { name: "Zmień cenę: Nieznany pracownik" }));
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByRole("combobox") as HTMLSelectElement;
    expect(optionNames(dialog)).toEqual(["Wybierz pracownika", "Nieznany pracownik"]);
    expect(select.value).toEqual(ghostId);
  });

  it("wiersz ceny wariantu nie ma przycisku zmiany", () => {
    renderCard();
    expect(screen.getByTestId(`edit-employee-price-${PRICE_ANNA}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`edit-employee-price-${PRICE_EWA_VARIANT}`)).toBeNull();
  });
});

describe("EmployeePricingCard — dodawanie ceny", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lista pracowników pomija tych, którzy mają już cenę bez wariantu", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Ustaw cenę" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading").textContent).toEqual(
      "Ustaw cenę indywidualną",
    );
    const select = within(dialog).getByRole("combobox");
    expect(select).not.toBeDisabled();
    expect(optionNames(dialog)).toEqual([
      "Wybierz pracownika",
      "Ola Pracownik(właściciel)",
      "Ewa Wariant",
    ]);
  });

  it("po anulowaniu zmiany ceny dialog dodawania jest pusty i odblokowany", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Zmień cenę: Anna Nowak" }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Anuluj" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Ustaw cenę" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading").textContent).toEqual(
      "Ustaw cenę indywidualną",
    );
    const select = within(dialog).getByRole("combobox") as HTMLSelectElement;
    expect(select).not.toBeDisabled();
    expect(select.value).toEqual("");
    expect(within(dialog).getByTestId("employee-price-input")).toHaveValue(null);
  });

  it("gdy wszyscy mają cenę, lista pokazuje komunikat", async () => {
    const user = userEvent.setup();
    const all = ALL_EMPLOYEES.map((emp, i) => ({
      ...annaPrice,
      id: `${i}0000000-0000-4000-8000-000000000000`,
      employeeId: emp.id,
      employee: emp,
    }));
    renderCard(all);

    await user.click(screen.getByRole("button", { name: "Ustaw cenę" }));
    const dialog = await screen.findByRole("dialog");
    expect(optionNames(dialog)).toEqual([
      "Wybierz pracownika",
      "Wszyscy pracownicy mają już ceny",
    ]);
  });

  it("teksty dialogu z polskimi znakami", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Ustaw cenę" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "Ustaw indywidualną cenę za tę usługę dla wybranego pracownika. Ta cena będzie wyświetlana zamiast ceny bazowej przy rezerwacji wizyty u tego pracownika.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Cena bazowa usługi: 100.00 PLN. Wprowadź cenę, która będzie stosowana zamiast niej dla tego pracownika.",
      ),
    ).toBeInTheDocument();
  });
});

describe("EmployeePricingCard — błędy zapisu i walidacja", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function saveEdited(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Zmień cenę: Anna Nowak" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Zapisz cenę" }));
    return dialog;
  }

  it("odpowiedź bez sukcesu i bez tekstu → toast „Nie udało się zapisać ceny”", async () => {
    const user = userEvent.setup();
    const { onSuccess } = renderCard();
    mockedMutationFetch.mockResolvedValueOnce(jsonResponse({ success: false }));

    await saveEdited(user);

    expect(mockedToast.error).toHaveBeenCalledWith("Nie udało się zapisać ceny");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("błąd sieci → toast „Błąd podczas zapisywania ceny pracownika”", async () => {
    const user = userEvent.setup();
    renderCard();
    mockedMutationFetch.mockRejectedValueOnce(new Error("offline"));

    await saveEdited(user);

    expect(mockedToast.error).toHaveBeenCalledWith(
      "Błąd podczas zapisywania ceny pracownika",
    );
  });

  it("cena ujemna → „Cena nie może być ujemna.” bez zapisu", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Zmień cenę: Anna Nowak" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByTestId("employee-price-input"), {
      target: { value: "-5" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Zapisz cenę" }));

    expect(mockedToast.error).toHaveBeenCalledWith("Cena nie może być ujemna.");
    expect(mockedMutationFetch).not.toHaveBeenCalled();
  });

  it("cena nieliczbowa → „Cena musi być liczbą.” bez zapisu", async () => {
    // Pole type=number w przeglądarce czyści tekst, więc gałąź sprawdzamy na hooku.
    const { result } = renderHook(() =>
      useEmployeePricing({
        serviceId: SERVICE_ID,
        allEmployees: ALL_EMPLOYEES,
        onSuccess: async () => {},
      }),
    );
    act(() => {
      result.current.setEmpPriceEmployeeId(EMP_OLA);
      result.current.setEmpPriceCustomPrice("abc");
    });
    await act(async () => {
      await result.current.handleSaveEmployeePrice();
    });

    expect(mockedToast.error).toHaveBeenCalledWith("Cena musi być liczbą.");
    expect(mockedMutationFetch).not.toHaveBeenCalled();
  });
});

describe("EmployeePricingCard — teksty karty i usuwania", () => {
  const confirmSpy = vi.fn(() => true);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("confirm", confirmSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pusta karta: komunikat i przycisk z polskimi znakami", () => {
    renderCard([]);
    expect(screen.getByTestId("no-employee-prices-message").textContent).toEqual(
      "Brak indywidualnych cen. Wszyscy pracownicy stosują cenę bazową (100.00 PLN).",
    );
    expect(
      screen.getByTestId("empty-state-add-employee-price-btn").textContent,
    ).toEqual("Ustaw pierwszą cenę indywidualną");
  });

  it("wiersz właściciela ma plakietkę „właściciel”", () => {
    renderCard();
    const row = screen.getByTestId(`employee-price-card-${PRICE_ANNA}`);
    expect(within(row).getByText("właściciel")).toBeInTheDocument();
  });

  it("usunięcie: pytanie i toast z polskimi znakami", async () => {
    const user = userEvent.setup();
    renderCard();
    mockedMutationFetch.mockResolvedValueOnce(jsonResponse({ success: true }));

    await user.click(screen.getByTestId(`delete-employee-price-${PRICE_ANNA}`));

    expect(confirmSpy).toHaveBeenCalledWith(
      "Czy na pewno chcesz usunąć indywidualną cenę dla Anna Nowak?",
    );
    expect(mockedToast.success).toHaveBeenCalledWith(
      "Indywidualna cena dla Anna Nowak usunięta",
    );
  });

  it("usunięcie bez sukcesu → „Nie udało się usunąć ceny”", async () => {
    const user = userEvent.setup();
    renderCard();
    mockedMutationFetch.mockResolvedValueOnce(jsonResponse({ success: false }));

    await user.click(screen.getByTestId(`delete-employee-price-${PRICE_ANNA}`));

    expect(mockedToast.error).toHaveBeenCalledWith("Nie udało się usunąć ceny");
  });

  it("usunięcie z błędem sieci → „Błąd podczas usuwania ceny pracownika”", async () => {
    const user = userEvent.setup();
    renderCard();
    mockedMutationFetch.mockRejectedValueOnce(new Error("offline"));

    await user.click(screen.getByTestId(`delete-employee-price-${PRICE_ANNA}`));

    expect(mockedToast.error).toHaveBeenCalledWith(
      "Błąd podczas usuwania ceny pracownika",
    );
  });
});
