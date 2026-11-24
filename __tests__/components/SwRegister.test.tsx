import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DRAFT_SWEEP_INTERVAL_MS, SwRegister } from "@/components/pwa/sw-register";
import { DRAFT_MAX_AGE_MS } from "@/hooks/use-form-recovery";

/**
 * Regresja 2026-11-14: przy pierwszej wizycie service worker po instalacji
 * przejmuje strone (sw.js: clients.claim()), co wywoluje "controllerchange".
 * SwRegister przeladowywal wtedy strone — uzytkowniczka tracila wybrany plan
 * i wpisane dane na /register, a zadanie logowania na /login bylo zrywane.
 * Przeladowanie ma sens tylko przy AKTUALIZACJI (strona miala juz kontroler).
 */

type Listener = () => void;

function installServiceWorkerMock(initialController: object | null) {
  const listeners = new Map<string, Set<Listener>>();

  const serviceWorker = {
    controller: initialController,
    register: vi.fn().mockResolvedValue({
      waiting: null,
      installing: null,
      addEventListener: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    }),
    addEventListener: vi.fn((type: string, listener: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener);
    }),
  };

  Object.defineProperty(navigator, "serviceWorker", {
    value: serviceWorker,
    writable: true,
    configurable: true,
  });

  return {
    serviceWorker,
    /** Nowy worker przejmuje strone: przegladarka podmienia kontroler i emituje zdarzenie. */
    takeControl: () => {
      serviceWorker.controller = { scriptURL: "/sw.js" };
      listeners.get("controllerchange")?.forEach((listener) => listener());
    },
  };
}

describe("SwRegister", () => {
  const mockReload = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    Object.defineProperty(window, "location", {
      value: { reload: mockReload },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers /sw.js in production", () => {
    const { serviceWorker } = installServiceWorkerMock(null);

    render(<SwRegister />);

    expect(serviceWorker.register).toHaveBeenCalledWith("/sw.js");
  });

  it("does not register the service worker outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const { serviceWorker } = installServiceWorkerMock(null);

    render(<SwRegister />);

    expect(serviceWorker.register).not.toHaveBeenCalled();
    expect(serviceWorker.addEventListener).not.toHaveBeenCalled();
  });

  it("does NOT reload the page when the worker takes control on the first visit", () => {
    // Pierwsza wizyta: strona zaladowala sie bez kontrolera.
    const { takeControl } = installServiceWorkerMock(null);
    render(<SwRegister />);

    // sw.js: install -> skipWaiting -> activate -> clients.claim()
    takeControl();

    expect(mockReload).not.toHaveBeenCalled();
  });

  it("reloads the page when an updated worker replaces the one already in control", () => {
    // Kolejna wizyta: strona zaladowala sie pod kontrola starego workera.
    const { takeControl } = installServiceWorkerMock({ scriptURL: "/sw.js" });
    render(<SwRegister />);

    takeControl();

    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it("reloads on an update that arrives later during the first visit", () => {
    const { takeControl } = installServiceWorkerMock(null);
    render(<SwRegister />);

    takeControl(); // pierwsza instalacja — bez przeladowania
    expect(mockReload).not.toHaveBeenCalled();

    takeControl(); // aktualizacja w tej samej sesji — przeladowanie
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it("stops listening for controllerchange after unmount", () => {
    const { takeControl } = installServiceWorkerMock({ scriptURL: "/sw.js" });
    const { unmount } = render(<SwRegister />);

    unmount();
    takeControl();

    expect(mockReload).not.toHaveBeenCalled();
  });

  it("sweeps legacy form drafts on start, also outside production", () => {
    // Przeglad szkicow nie moze zalezec od service workera ani srodowiska.
    vi.stubEnv("NODE_ENV", "test");
    installServiceWorkerMock(null);
    const { store, restore } = installStorageMock([
      ["form_recovery_sweep-on-start", JSON.stringify({ name: "x" })],
      ["unrelated-key", "keep"],
    ]);

    try {
      render(<SwRegister />);

      expect([...store.keys()]).toEqual(["unrelated-key"]);
    } finally {
      restore();
    }
  });

  describe("periodic draft sweep", () => {
    // Tablet w salonie potrafi miec aplikacje otwarta przez kilka dni bez
    // przeladowania. Szkic musi zniknac po 24 h bez ponownego startu
    // aplikacji i bez ponownego otwierania formularza.
    const DRAFT_KEY = "form_recovery_add-client-form";
    let restoreStorage: () => void;
    let store: Map<string, string>;

    function draftSavedAt(savedAt: number): string {
      return JSON.stringify({ v: 1, savedAt, data: { firstName: "Anna" } });
    }

    function setVisibility(state: DocumentVisibilityState) {
      Object.defineProperty(document, "visibilityState", {
        value: state,
        configurable: true,
      });
    }

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-24T08:00:00Z"));
      vi.stubEnv("NODE_ENV", "test");
      installServiceWorkerMock(null);
      ({ store, restore: restoreStorage } = installStorageMock([
        [DRAFT_KEY, draftSavedAt(Date.now())],
        ["unrelated-key", "keep"],
      ]));
    });

    afterEach(() => {
      restoreStorage();
      setVisibility("visible");
      // Zdejmuje szpiegow clearInterval i removeEventListener.
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("removes a draft once it reaches 24 hours, without a remount", () => {
      render(<SwRegister />);

      // Ostatni przeglad przed granica: szkic ma 23 h 45 min i zostaje.
      vi.advanceTimersByTime(DRAFT_MAX_AGE_MS - DRAFT_SWEEP_INTERVAL_MS);
      expect(store.has(DRAFT_KEY)).toBe(true);

      vi.advanceTimersByTime(DRAFT_SWEEP_INTERVAL_MS);
      expect(store.has(DRAFT_KEY)).toBe(false);
      expect(store.get("unrelated-key")).toBe("keep");
    });

    it("sweeps when the page becomes visible again", () => {
      render(<SwRegister />);
      // Szkic przeterminowany, a do nastepnego przegladu cyklicznego daleko.
      store.set(DRAFT_KEY, draftSavedAt(Date.now() - DRAFT_MAX_AGE_MS));

      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));

      expect(store.has(DRAFT_KEY)).toBe(false);
    });

    it("does not sweep when the page goes to the background", () => {
      render(<SwRegister />);
      store.set(DRAFT_KEY, draftSavedAt(Date.now() - DRAFT_MAX_AGE_MS));

      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));

      expect(store.has(DRAFT_KEY)).toBe(true);
    });

    it("stops the interval and the visibility listener after unmount", () => {
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
      const removeListenerSpy = vi.spyOn(document, "removeEventListener");
      const { unmount } = render(<SwRegister />);

      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();
      expect(removeListenerSpy).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );

      store.set(DRAFT_KEY, draftSavedAt(Date.now() - DRAFT_MAX_AGE_MS));
      vi.advanceTimersByTime(DRAFT_SWEEP_INTERVAL_MS * 4);
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));

      expect(store.has(DRAFT_KEY)).toBe(true);
    });
  });
});

/** Podmienia window.localStorage na atrape opartą o Map; restore() przywraca oryginał. */
function installStorageMock(entries: [string, string][]) {
  const store = new Map<string, string>(entries);
  const storageMock = {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  } as Storage;
  const originalLocalStorage = window.localStorage;
  Object.defineProperty(window, "localStorage", {
    value: storageMock,
    writable: true,
    configurable: true,
  });

  return {
    store,
    restore: () => {
      Object.defineProperty(window, "localStorage", {
        value: originalLocalStorage,
        writable: true,
        configurable: true,
      });
    },
  };
}
