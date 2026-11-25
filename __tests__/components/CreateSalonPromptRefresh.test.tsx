/**
 * Zakładanie salonu z layoutu panelu: domyślne `onCreated` odświeża trasę.
 *
 * Layout panelu (komponent serwerowy) renderuje `CreateSalonPrompt` bez
 * `onCreated` — funkcji nie da się przekazać z serwera. Po założeniu salonu
 * komponent sam wywołuje `router.refresh()`, żeby layout policzył dostęp na
 * nowo i pokazał panel. Przy błędzie: komunikat i brak odświeżenia.
 * Atrapy: `mutationFetch` i `next/navigation`.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateSalonPrompt } from "@/components/dashboard/create-salon-prompt";
import { mutationFetch } from "@/lib/api-client";

const router = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/api-client", () => ({
  mutationFetch: vi.fn(async () => ({ json: async () => ({ success: true }) })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CREATE_BUTTON = /Utworz salon z/;
const SESSION = { user: { name: "Anna", email: "anna@example.com" } };

async function clickCreate() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: CREATE_BUTTON }));
}

describe("CreateSalonPrompt bez onCreated", () => {
  it("po założeniu salonu: router.refresh() raz", async () => {
    render(<CreateSalonPrompt session={SESSION} legalForm={null} />);

    await clickCreate();

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("błąd z API: komunikat, bez odświeżenia, przycisk znów aktywny", async () => {
    vi.mocked(mutationFetch).mockResolvedValueOnce({
      json: async () => ({ success: false, error: "Plan not found" }),
    } as unknown as Response);
    render(<CreateSalonPrompt session={SESSION} legalForm={null} />);

    await clickCreate();

    expect(await screen.findByText("Plan not found")).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: CREATE_BUTTON })).toBeEnabled();
  });

  it("błąd bez treści (np. 409 już założony): komunikat domyślny, bez odświeżenia", async () => {
    vi.mocked(mutationFetch).mockResolvedValueOnce({
      json: async () => ({ success: false }),
    } as unknown as Response);
    render(<CreateSalonPrompt session={SESSION} legalForm={null} />);

    await clickCreate();

    expect(await screen.findByText("Nie udalo sie utworzyc salonu")).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("błąd sieci: komunikat o połączeniu, bez odświeżenia", async () => {
    vi.mocked(mutationFetch).mockRejectedValueOnce(new Error("offline"));
    render(<CreateSalonPrompt session={SESSION} legalForm={null} />);

    await clickCreate();

    expect(await screen.findByText("Wystapil blad polaczenia")).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("CreateSalonPrompt z własnym onCreated", () => {
  it("wywołuje przekazane onCreated zamiast router.refresh()", async () => {
    const onCreated = vi.fn();
    render(<CreateSalonPrompt session={SESSION} legalForm={null} onCreated={onCreated} />);

    await clickCreate();

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
