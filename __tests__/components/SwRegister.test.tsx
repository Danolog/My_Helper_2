import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SwRegister } from "@/components/pwa/sw-register";

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
});
