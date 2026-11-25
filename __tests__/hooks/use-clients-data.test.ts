import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Szkic formularza "Dodaj klienta". Notatka nie trafia do szkicu
 * (NEVER_PERSIST_KEYS), wiec sama notatka nie moze go tworzyc: po
 * odswiezeniu dialog otwieralby sie z banerem, ktorego "Przywroc" nic nie
 * przywraca. Ostrzezenie przy zamykaniu strony nadal obejmuje notatke.
 */

const recovery = {
  wasRecovered: false,
  isDirty: false,
  saveFormState: vi.fn(),
  getRecoveredState: vi.fn(() => null),
  clearSavedForm: vi.fn(),
  setDirty: vi.fn(),
};

vi.mock("@/hooks/use-form-recovery", () => ({
  useFormRecovery: () => recovery,
}));

vi.mock("@/hooks/use-tab-sync", () => ({
  useTabSync: () => ({ notifyChange: vi.fn() }),
}));

const routerReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: routerReplace }),
  usePathname: () => "/dashboard/clients",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { useClientsData } from "@/app/dashboard/clients/_hooks/use-clients-data";

describe("useClientsData — form draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderClientsData() {
    // salonId = null: hook nie pobiera listy klientow, testujemy sam formularz.
    return renderHook(() => useClientsData(null));
  }

  it("does not save a draft when only the notes field is filled", () => {
    const { result } = renderClientsData();

    act(() => result.current.setFormNotes("Prefers morning visits"));

    expect(recovery.saveFormState).not.toHaveBeenCalled();
  });

  it("still marks the form dirty for the unload warning when only notes are filled", () => {
    const { result } = renderClientsData();

    act(() => result.current.setFormNotes("Prefers morning visits"));

    expect(recovery.setDirty).toHaveBeenLastCalledWith(true);
  });

  it("saves a draft once a persisted field is filled next to the notes", () => {
    const { result } = renderClientsData();

    act(() => result.current.setFormNotes("Prefers morning visits"));
    act(() => result.current.setFormFirstName("Anna"));

    expect(recovery.saveFormState).toHaveBeenCalledTimes(1);
    expect(recovery.saveFormState).toHaveBeenLastCalledWith(
      expect.objectContaining({ firstName: "Anna" }),
    );
    expect(recovery.setDirty).toHaveBeenLastCalledWith(true);
  });

  it("keeps an empty form clean and without a draft", () => {
    renderClientsData();

    expect(recovery.saveFormState).not.toHaveBeenCalled();
    expect(recovery.setDirty).toHaveBeenLastCalledWith(false);
  });
});
