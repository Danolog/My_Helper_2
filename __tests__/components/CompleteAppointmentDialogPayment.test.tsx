/**
 * Okno zakończenia wizyty: kwota i metoda płatności dla każdej roli,
 * sprawdzenie pól przed wysłaniem, teksty błędów z serwera pod polami,
 * a prowizja, jej stawka i materiały z kosztem tylko dla właściciela.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CompleteAppointmentDialog,
  PAID_AMOUNT_MESSAGES,
  PAYMENT_METHOD_OPTIONS,
  checkPaidAmount,
  defaultPaidAmount,
} from "@/components/appointments/complete-appointment-dialog";
import { RoleProvider } from "@/components/dashboard/role-provider";
import { APPOINTMENT_PAYMENT_METHODS, completeAppointmentSchema } from "@/lib/api-validation";
import { COMPLETE_MESSAGES } from "@/lib/appointment-completion";
import type { SalonRole } from "@/lib/salon-context";

const mutationFetch = vi.fn();
vi.mock("@/lib/api-client", () => ({ mutationFetch: (...a: unknown[]) => mutationFetch(...a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ROLES: SalonRole[] = ["owner", "receptionist", "employee"];
const RECEIPT_NOTICE =
  "Kwota trafi tylko do raportu w MyHelper. To nie jest paragon. Paragon wystaw jak zwykle w kasie fiskalnej.";

type ServiceOverride = { basePrice: string } | null;

function appointment(service: ServiceOverride = { basePrice: "120.00" }) {
  return {
    id: "appt-1",
    employeeId: "emp-1",
    status: "scheduled",
    service: service
      ? { id: "svc-1", name: "Strzyżenie", basePrice: service.basePrice, baseDuration: 60 }
      : null,
    employee: { id: "emp-1", firstName: "Anna", lastName: "Nowak" },
    client: { id: "cli-1", firstName: "Ewa", lastName: "Kowalska" },
  };
}

const materials = [
  {
    id: "mat-1",
    product: { name: "Farba", pricePerUnit: "10.00", unit: "ml" },
    quantityUsed: "3",
  },
];

function renderDialog(role: SalonRole, service?: ServiceOverride) {
  const onOpenChange = vi.fn();
  const onCompleted = vi.fn();
  render(
    <RoleProvider role={role}>
      <CompleteAppointmentDialog
        open
        onOpenChange={onOpenChange}
        appointment={appointment(service)}
        materials={materials}
        onCompleted={onCompleted}
      />
    </RoleProvider>
  );
  return { onOpenChange, onCompleted };
}

function amountInput() {
  return screen.getByTestId("paid-amount-input") as HTMLInputElement;
}

function setAmount(value: string) {
  fireEvent.change(amountInput(), { target: { value } });
}

function chooseMethod(method: string) {
  fireEvent.click(screen.getByTestId(`payment-method-${method}`));
}

function submit() {
  fireEvent.click(screen.getByTestId("confirm-complete-btn"));
}

function sentBody(): Record<string, unknown> {
  const [url, init] = mutationFetch.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/api/appointments/appt-1/complete");
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

beforeEach(() => {
  mutationFetch.mockReset();
  mutationFetch.mockResolvedValue(jsonResponse(200, { success: true }));
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe.each(ROLES)("CompleteAppointmentDialog — rola %s", (role) => {
  const isOwner = role === "owner";

  it("pola kwoty i metody są widoczne i wymagane, żadna metoda nie jest zaznaczona", async () => {
    renderDialog(role);
    expect(await screen.findByText("Kwota zapłacona przez klienta (zł)")).toBeInTheDocument();
    expect(screen.getByText("Metoda płatności")).toBeInTheDocument();
    expect(amountInput()).toHaveAttribute("inputmode", "decimal");
    expect(amountInput()).toHaveAttribute("aria-required", "true");
    expect(screen.getByTestId("payment-method-group")).toHaveAttribute("aria-required", "true");
    for (const option of PAYMENT_METHOD_OPTIONS) {
      expect(screen.getByLabelText(option.label)).not.toBeChecked();
    }
    expect(screen.getByText("Gotówka")).toBeInTheDocument();
    expect(screen.getByText("Karta")).toBeInTheDocument();
    expect(screen.getByText("BLIK")).toBeInTheDocument();
  });

  it("zdanie o paragonie stoi pod polami płatności", async () => {
    renderDialog(role);
    const notice = await screen.findByTestId("receipt-notice");
    expect(notice).toHaveTextContent(RECEIPT_NOTICE);
    expect(screen.getByTestId("payment-section").lastElementChild).toBe(notice);
  });

  it(`sekcja prowizji i koszt materiałów ${isOwner ? "widoczne" : "ukryte"}`, async () => {
    renderDialog(role);
    await screen.findByTestId("payment-section");
    const expectVisibility = (testId: string) =>
      isOwner
        ? expect(screen.getByTestId(testId)).toBeInTheDocument()
        : expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    expectVisibility("commission-section");
    expectVisibility("commission-percentage-input");
    expectVisibility("commission-amount-display");
    expectVisibility("materials-section");
    if (isOwner) {
      expect(screen.getByText("Prowizja pracownika")).toBeInTheDocument();
      expect(screen.getByText("Laczny koszt materialow:")).toBeInTheDocument();
    } else {
      expect(screen.queryByText("Prowizja pracownika")).not.toBeInTheDocument();
      expect(screen.queryByText("Laczny koszt materialow:")).not.toBeInTheDocument();
      expect(screen.queryByText("30.00 PLN")).not.toBeInTheDocument();
    }
  });

  it("pusta kwota i brak metody: bez żądania, teksty pod polami", async () => {
    renderDialog(role);
    setAmount("");
    submit();
    expect(await screen.findByTestId("paid-amount-error")).toHaveTextContent(
      COMPLETE_MESSAGES.paidAmountRequired
    );
    expect(screen.getByTestId("payment-method-error")).toHaveTextContent(
      COMPLETE_MESSAGES.paymentMethodRequired
    );
    expect(mutationFetch).not.toHaveBeenCalled();
  });

  it("same spacje w kwocie liczą się jak puste pole, nigdy nie idzie pusty tekst", async () => {
    renderDialog(role);
    setAmount("   ");
    chooseMethod("cash");
    submit();
    expect(await screen.findByTestId("paid-amount-error")).toHaveTextContent(
      COMPLETE_MESSAGES.paidAmountRequired
    );
    expect(screen.queryByTestId("payment-method-error")).not.toBeInTheDocument();
    expect(mutationFetch).not.toHaveBeenCalled();
  });

  it("brak samej metody: bez żądania, tekst pod metodą", async () => {
    renderDialog(role);
    submit();
    expect(await screen.findByTestId("payment-method-error")).toHaveTextContent(
      COMPLETE_MESSAGES.paymentMethodRequired
    );
    expect(screen.queryByTestId("paid-amount-error")).not.toBeInTheDocument();
    expect(mutationFetch).not.toHaveBeenCalled();
  });

  it(`„ 120,50 ” idzie jako "120.50"; commissionPercentage ${isOwner ? "w body" : "poza body"}`, async () => {
    const { onCompleted } = renderDialog(role);
    setAmount(" 120,50 ");
    chooseMethod("card");
    submit();
    await waitFor(() => expect(mutationFetch).toHaveBeenCalledTimes(1));
    const body = sentBody();
    expect(body.paidAmount).toBe("120.50");
    expect(body.paymentMethod).toBe("card");
    if (isOwner) {
      expect(body.commissionPercentage).toBe(50);
    } else {
      expect(body).not.toHaveProperty("commissionPercentage");
    }
    await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith("Wizyta zakończona.");
  });

  it("domyślna kwota to cena usługi z przecinkiem i dwoma miejscami", async () => {
    renderDialog(role, { basePrice: "120" });
    await screen.findByTestId("payment-section");
    expect(amountInput().value).toBe("120,00");
  });

  it("bez ceny usługi pole kwoty jest puste, nie 0,00", async () => {
    renderDialog(role, null);
    await screen.findByTestId("payment-section");
    expect(amountInput().value).toBe("");
  });

  it("kwota 0 jest dozwolona (wizyta gratis)", async () => {
    renderDialog(role);
    setAmount("0");
    chooseMethod("blik");
    submit();
    await waitFor(() => expect(mutationFetch).toHaveBeenCalledTimes(1));
    expect(sentBody()).toMatchObject({ paidAmount: "0", paymentMethod: "blik" });
  });

  it("400 z details: teksty pod polami, error w toaście, okno otwarte z danymi", async () => {
    mutationFetch.mockResolvedValue(
      jsonResponse(400, {
        success: false,
        code: "VALIDATION_FAILED",
        error: COMPLETE_MESSAGES.validationFailed,
        details: {
          paidAmount: "Kwota musi być liczbą od 0 do 99 999 999,99.",
          paymentMethod: "Wybierz metodę płatności: gotówka, karta albo BLIK.",
        },
      })
    );
    const { onOpenChange, onCompleted } = renderDialog(role);
    setAmount("99,99");
    chooseMethod("cash");
    submit();
    expect(await screen.findByTestId("paid-amount-error")).toHaveTextContent(
      "Kwota musi być liczbą od 0 do 99 999 999,99."
    );
    expect(screen.getByTestId("payment-method-error")).toHaveTextContent(
      "Wybierz metodę płatności: gotówka, karta albo BLIK."
    );
    expect(toast.error).toHaveBeenCalledWith(COMPLETE_MESSAGES.validationFailed);
    expect(screen.getByTestId("complete-appointment-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("confirm-complete-btn")).toBeInTheDocument();
    expect(amountInput().value).toBe("99,99");
    expect(screen.getByTestId("payment-method-cash")).toBeChecked();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onCompleted).not.toHaveBeenCalled();
  });
});

describe("CompleteAppointmentDialog — sprawdzanie kwoty w oknie", () => {
  it.each([
    ["abc", PAID_AMOUNT_MESSAGES.notNumber],
    ["12,3,4", PAID_AMOUNT_MESSAGES.notNumber],
    ["-5", PAID_AMOUNT_MESSAGES.negative],
    ["-5,00", PAID_AMOUNT_MESSAGES.negative],
    ["1,234", PAID_AMOUNT_MESSAGES.tooManyDecimals],
    ["123456789", PAID_AMOUNT_MESSAGES.outOfRange],
  ])("„%s” => „%s” pod polem, bez żądania", async (input, message) => {
    renderDialog("owner");
    setAmount(input);
    chooseMethod("cash");
    submit();
    expect(await screen.findByTestId("paid-amount-error")).toHaveTextContent(message);
    expect(mutationFetch).not.toHaveBeenCalled();
  });

  it("teksty mają polskie znaki", () => {
    expect(PAID_AMOUNT_MESSAGES).toEqual({
      required: "Podaj kwotę zapłaconą przez klienta.",
      notNumber: "Kwota musi być liczbą.",
      negative: "Kwota nie może być ujemna.",
      tooManyDecimals: "Kwota może mieć najwyżej 2 miejsca po przecinku.",
      outOfRange: "Kwota musi być liczbą od 0 do 99 999 999,99.",
    });
  });

  it("poprawka wpisu czyści tekst błędu pod polem", async () => {
    renderDialog("receptionist");
    setAmount("");
    submit();
    await screen.findByTestId("paid-amount-error");
    setAmount("10");
    chooseMethod("cash");
    expect(screen.queryByTestId("paid-amount-error")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-method-error")).not.toBeInTheDocument();
  });
});

describe("CompleteAppointmentDialog — teksty i listy zgodne z serwerem", () => {
  const messageFor = (input: Record<string, unknown>, field: string) => {
    const result = completeAppointmentSchema.safeParse({ paymentMethod: "cash", paidAmount: "1", ...input });
    expect(result.success).toBe(false);
    return result.error?.issues.find((issue) => issue.path[0] === field)?.message;
  };

  it("teksty kwoty są tymi samymi tekstami co w schemacie", () => {
    expect(messageFor({ paidAmount: undefined }, "paidAmount")).toBe(PAID_AMOUNT_MESSAGES.required);
    expect(messageFor({ paidAmount: true }, "paidAmount")).toBe(PAID_AMOUNT_MESSAGES.notNumber);
    expect(messageFor({ paidAmount: "-1" }, "paidAmount")).toBe(PAID_AMOUNT_MESSAGES.negative);
    expect(messageFor({ paidAmount: "1.234" }, "paidAmount")).toBe(PAID_AMOUNT_MESSAGES.tooManyDecimals);
    expect(messageFor({ paidAmount: "123456789" }, "paidAmount")).toBe(PAID_AMOUNT_MESSAGES.outOfRange);
    expect(messageFor({ paymentMethod: undefined }, "paymentMethod")).toBe(
      COMPLETE_MESSAGES.paymentMethodRequired
    );
  });

  it("lista metod okna = lista metod serwera", () => {
    expect(PAYMENT_METHOD_OPTIONS.map((o) => o.value)).toEqual([...APPOINTMENT_PAYMENT_METHODS]);
  });

  it("każda kwota przepuszczona przez okno przechodzi schemat serwera bez zmian", () => {
    for (const raw of ["0", "120,50", " 7,5 ", "99999999,99"]) {
      const check = checkPaidAmount(raw);
      expect(check.ok).toBe(true);
      if (!check.ok) continue;
      const parsed = completeAppointmentSchema.safeParse({ paymentMethod: "cash", paidAmount: check.value });
      expect(parsed.success).toBe(true);
      expect(parsed.data?.paidAmount).toBe(check.value);
    }
  });
});

describe("CompleteAppointmentDialog — domyślna kwota", () => {
  it.each([
    ["120.00", "120,00"],
    ["120", "120,00"],
    ["0", "0,00"],
    ["-10", "0,00"],
    ["abc", ""],
    ["", ""],
    [null, ""],
    [undefined, ""],
  ])("cena %s => „%s”", (price, expected) => {
    expect(defaultPaidAmount(price)).toBe(expected);
  });
});

describe("CompleteAppointmentDialog — inne błędy serwera i zamknięcie", () => {
  it.each([404, 409, 500])("%i: toast z error serwera, okno otwarte", async (status) => {
    mutationFetch.mockResolvedValue(jsonResponse(status, { success: false, error: `Błąd ${status}` }));
    const { onOpenChange, onCompleted } = renderDialog("employee");
    chooseMethod("cash");
    submit();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(`Błąd ${status}`));
    expect(screen.getByTestId("confirm-complete-btn")).toBeInTheDocument();
    expect(amountInput().value).toBe("120,00");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it("błąd sieci: toast z polskimi znakami, okno otwarte", async () => {
    mutationFetch.mockRejectedValue(new Error("offline"));
    renderDialog("owner");
    chooseMethod("card");
    submit();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Nie udało się zakończyć wizyty. Spróbuj ponownie.")
    );
    expect(screen.getByTestId("confirm-complete-btn")).toBeInTheDocument();
  });

  it("odpowiedź bez error: ogólny toast z polskimi znakami", async () => {
    mutationFetch.mockResolvedValue(jsonResponse(500, { success: false }));
    renderDialog("owner");
    chooseMethod("card");
    submit();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Nie udało się zakończyć wizyty. Spróbuj ponownie.")
    );
  });

  it("Anuluj zamyka okno i przywraca pola do stanu początkowego", async () => {
    const { onOpenChange } = renderDialog("receptionist");
    setAmount("55,00");
    chooseMethod("blik");
    fireEvent.click(screen.getByText("Anuluj"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(amountInput().value).toBe("120,00"));
    expect(screen.getByTestId("payment-method-blik")).not.toBeChecked();
  });
});
