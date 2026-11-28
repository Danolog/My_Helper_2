import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ClientProfilePage from "@/app/dashboard/clients/[id]/page";
import {
  buildHealthDataPatch,
  describeConsentAuthor,
} from "@/components/clients/health-data-consent-form";
import { ModulesProvider } from "@/components/dashboard/modules-provider";
import { mutationFetch } from "@/lib/api-client";
import { DEFAULT_MODULES } from "@/lib/features";
import {
  HEALTH_DATA_CONSENT_REQUIRED,
  HEALTH_DATA_CONSENT_REQUIRED_MESSAGE,
} from "@/lib/health-data-consent";

const router = vi.hoisted(() => ({ push: () => {}, replace: () => {}, back: () => {} }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "client-1" }),
  useRouter: () => router,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } }, isPending: false }),
}));

vi.mock("@/hooks/use-salon-id", () => ({
  useSalonId: () => ({ salonId: "salon-1", loading: false }),
}));

vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(),
}));

// Nagłówek z przyciskiem zapisu — reszta nagłówka nie jest tu badana.
vi.mock("@/components/clients/client-profile-header", () => ({
  ClientProfileHeader: ({ onSave }: { onSave: () => void }) => (
    <button type="button" onClick={onSave} data-testid="save-btn">
      Zapisz
    </button>
  ),
}));
vi.mock("@/components/clients/client-consents-card", () => ({
  ClientConsentsCard: () => <div data-testid="stub-consents" />,
}));
vi.mock("@/components/clients/client-history-tab", () => ({
  ClientHistoryTab: () => null,
}));
vi.mock("@/components/clients/client-loyalty-tab", () => ({
  ClientLoyaltyTab: () => null,
}));

const BASE_CLIENT = {
  id: "client-1",
  salonId: "salon-1",
  firstName: "Anna",
  lastName: "Nowak",
  phone: null,
  email: null,
  notes: null,
  preferences: null,
  allergies: null as string | null,
  healthDataConsentAt: null as string | null,
  healthDataConsentBy: null as string | null,
  favoriteEmployeeId: null,
  birthday: null,
  requireDeposit: false,
  depositType: null,
  depositValue: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const CONSENTED_CLIENT = {
  ...BASE_CLIENT,
  allergies: "Lateks, PPD",
  healthDataConsentAt: "2026-11-20T09:30:00.000Z",
  healthDataConsentBy: "user-1",
};

const EMPLOYEES = [
  { id: "emp-1", firstName: "Ewa", lastName: "Kowalska", role: "employee", isActive: true, color: null, userId: "user-2" },
];

function mockFetch(client: typeof BASE_CLIENT) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/clients/client-1")) {
      return { ok: true, json: async () => ({ success: true, data: client }) } as Response;
    }
    if (url.includes("/api/employees")) {
      return { ok: true, json: async () => ({ success: true, data: EMPLOYEES }) } as Response;
    }
    return { ok: true, json: async () => ({ success: true, data: [] }) } as Response;
  });
}

const mutationFetchMock = vi.mocked(mutationFetch);

function respondWith(body: unknown) {
  mutationFetchMock.mockResolvedValueOnce({ json: async () => body } as Response);
}

/** Treść ostatniego PUT wysłanego przez stronę. */
function lastPutBody(): Record<string, unknown> {
  const call = mutationFetchMock.mock.calls.at(-1);
  expect(call).toBeDefined();
  const init = call![1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

async function renderPage(client: typeof BASE_CLIENT) {
  vi.stubGlobal("fetch", mockFetch(client));
  render(
    <ModulesProvider modules={DEFAULT_MODULES}>
      <ClientProfilePage />
    </ModulesProvider>
  );
  await waitFor(() => {
    expect(screen.getByTestId("health-consent-checkbox")).toBeInTheDocument();
  });
}

describe("Kartoteka klienta — zgoda na zapis informacji o zdrowiu", () => {
  beforeEach(() => {
    mutationFetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("bez zgody pole alergii jest zablokowane", async () => {
    await renderPage(BASE_CLIENT);

    expect(screen.getByTestId("health-consent-checkbox")).not.toBeChecked();
    expect(screen.getByTestId("new-allergy-input")).toBeDisabled();
    expect(screen.getByTestId("add-allergy-btn")).toBeDisabled();
    expect(screen.getByTestId("health-consent-status")).toHaveTextContent(/Brak zgody/);
  });

  it("zaznaczenie zgody odblokowuje alergie i wysyła healthDataConsent: true z nową alergią", async () => {
    const user = userEvent.setup();
    await renderPage(BASE_CLIENT);

    await user.click(screen.getByTestId("health-consent-checkbox"));
    expect(screen.getByTestId("new-allergy-input")).toBeEnabled();

    await user.type(screen.getByTestId("new-allergy-input"), "Lateks");
    await user.click(screen.getByTestId("add-allergy-btn"));

    respondWith({ success: true, data: { ...BASE_CLIENT, allergies: "Lateks", healthDataConsentAt: "2026-11-24T10:00:00.000Z", healthDataConsentBy: "user-1" } });
    await user.click(screen.getByTestId("save-btn"));

    const body = lastPutBody();
    expect(body.healthDataConsent).toBe(true);
    expect(body.allergies).toBe("Lateks");

    // Po zapisie zgoda jest zapisana: data i autor widoczne.
    await waitFor(() => {
      expect(screen.getByTestId("health-consent-status")).toHaveTextContent(/Zgoda zapisana .*Ty\./);
    });
  });

  it("stara karta: zapis innych pól przy zapisanej zgodzie nie wysyła ani zgody, ani alergii", async () => {
    const user = userEvent.setup();
    await renderPage(CONSENTED_CLIENT);

    await user.type(screen.getByTestId("client-notes-input"), "Nowa notatka");
    respondWith({ success: true, data: { ...CONSENTED_CLIENT, notes: "Nowa notatka" } });
    await user.click(screen.getByTestId("save-btn"));

    const body = lastPutBody();
    expect(body).not.toHaveProperty("healthDataConsent");
    expect(body).not.toHaveProperty("allergies");
    expect(body.notes).toBe("Nowa notatka");
  });

  it("stara karta: nieaktualna karta (zgodę cofnięto gdzie indziej) nie nadaje zgody, a 400 jest widoczne", async () => {
    const user = userEvent.setup();
    // Karta wczytana, gdy zgoda była zapisana; w międzyczasie cofnięta w innej karcie.
    await renderPage(CONSENTED_CLIENT);

    await user.type(screen.getByTestId("new-allergy-input"), "Nikiel");
    await user.click(screen.getByTestId("add-allergy-btn"));

    respondWith({
      success: false,
      error: HEALTH_DATA_CONSENT_REQUIRED_MESSAGE,
      code: HEALTH_DATA_CONSENT_REQUIRED,
    });
    await user.click(screen.getByTestId("save-btn"));

    const body = lastPutBody();
    // Zgody nie wysyłamy — serwer sprawdza zgodę zapisaną i odrzuca zapis.
    expect(body).not.toHaveProperty("healthDataConsent");
    expect(body.allergies).toBe("Lateks, PPD, Nikiel");

    const error = await screen.findByTestId("health-consent-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveTextContent(HEALTH_DATA_CONSENT_REQUIRED_MESSAGE);
    expect(error).toHaveTextContent(/odśwież stronę/);
  });

  it("zgoda zapisana: data i autor (Ty / pracownik / inne konto)", async () => {
    await renderPage({ ...CONSENTED_CLIENT, healthDataConsentBy: "user-2" });

    expect(screen.getByTestId("health-consent-checkbox")).toBeChecked();
    await waitFor(() => {
      expect(screen.getByTestId("health-consent-status")).toHaveTextContent(/Zgoda zapisana .*2026.*Ewa Kowalska\./);
    });
  });

  it("odznaczenie przy alergiach wymaga potwierdzenia; Anuluj niczego nie zmienia", async () => {
    const user = userEvent.setup();
    await renderPage(CONSENTED_CLIENT);

    await user.click(screen.getByTestId("health-consent-checkbox"));

    const dialog = await screen.findByTestId("health-consent-withdraw-dialog");
    expect(dialog).toHaveTextContent(/alergie klienta zostaną trwale usunięte/);
    await user.click(within(dialog).getByTestId("health-consent-withdraw-cancel"));

    await waitFor(() => {
      expect(screen.queryByTestId("health-consent-withdraw-dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("health-consent-checkbox")).toBeChecked();
    expect(screen.getByTestId("allergies-list")).toHaveTextContent("Lateks");
  });

  it("potwierdzone odznaczenie usuwa alergie z formularza i wysyła tylko healthDataConsent: false", async () => {
    const user = userEvent.setup();
    await renderPage(CONSENTED_CLIENT);

    await user.click(screen.getByTestId("health-consent-checkbox"));
    const dialog = await screen.findByTestId("health-consent-withdraw-dialog");
    await user.click(within(dialog).getByTestId("health-consent-withdraw-confirm"));

    expect(screen.getByTestId("health-consent-checkbox")).not.toBeChecked();
    expect(screen.queryByTestId("allergies-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("new-allergy-input")).toBeDisabled();
    expect(screen.queryByTestId("allergy-warning-banner")).not.toBeInTheDocument();

    respondWith({ success: true, data: { ...CONSENTED_CLIENT, allergies: null, healthDataConsentAt: null, healthDataConsentBy: null } });
    await user.click(screen.getByTestId("save-btn"));

    const body = lastPutBody();
    expect(body.healthDataConsent).toBe(false);
    expect(body).not.toHaveProperty("allergies");
  });

  it("odznaczenie bez alergii nie pokazuje dialogu", async () => {
    const user = userEvent.setup();
    await renderPage({ ...CONSENTED_CLIENT, allergies: null });

    await user.click(screen.getByTestId("health-consent-checkbox"));

    expect(screen.queryByTestId("health-consent-withdraw-dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("health-consent-checkbox")).not.toBeChecked();
  });

  it("zaznaczenie i odznaczenie przed zapisem nie wysyła zgody", async () => {
    const user = userEvent.setup();
    await renderPage(BASE_CLIENT);

    await user.click(screen.getByTestId("health-consent-checkbox"));
    await user.click(screen.getByTestId("health-consent-checkbox"));

    respondWith({ success: true, data: BASE_CLIENT });
    await user.click(screen.getByTestId("save-btn"));

    const body = lastPutBody();
    expect(body).not.toHaveProperty("healthDataConsent");
    expect(body).not.toHaveProperty("allergies");
  });
});

describe("buildHealthDataPatch", () => {
  const base = { storedConsent: false, consentChecked: false, storedAllergies: null, allergies: null };

  it("bez zmian: pusty patch", () => {
    expect(buildHealthDataPatch(base)).toEqual({});
    expect(
      buildHealthDataPatch({ storedConsent: true, consentChecked: true, storedAllergies: "A", allergies: "A" })
    ).toEqual({});
  });

  it("nowa zgoda: true, alergie tylko gdy zmienione", () => {
    expect(buildHealthDataPatch({ ...base, consentChecked: true })).toEqual({ healthDataConsent: true });
    expect(buildHealthDataPatch({ ...base, consentChecked: true, allergies: "A" })).toEqual({
      healthDataConsent: true,
      allergies: "A",
    });
  });

  it("cofnięcie: tylko false, bez alergii", () => {
    expect(
      buildHealthDataPatch({ storedConsent: true, consentChecked: false, storedAllergies: "A", allergies: null })
    ).toEqual({ healthDataConsent: false });
  });

  it("zapisana zgoda i zmiana alergii: same alergie (także usunięcie wszystkich)", () => {
    expect(
      buildHealthDataPatch({ storedConsent: true, consentChecked: true, storedAllergies: "A", allergies: "A, B" })
    ).toEqual({ allergies: "A, B" });
    expect(
      buildHealthDataPatch({ storedConsent: true, consentChecked: true, storedAllergies: "A", allergies: null })
    ).toEqual({ allergies: null });
  });
});

describe("describeConsentAuthor", () => {
  it("rozpoznaje bieżące konto, pracownika i inne konto", () => {
    expect(describeConsentAuthor("user-1", "user-1", EMPLOYEES)).toBe("Ty");
    expect(describeConsentAuthor("user-2", "user-1", EMPLOYEES)).toBe("Ewa Kowalska");
    expect(describeConsentAuthor("user-9", "user-1", EMPLOYEES)).toBe("inne konto personelu salonu");
    expect(describeConsentAuthor(null, "user-1", EMPLOYEES)).toBe("nieznane konto");
  });
});
