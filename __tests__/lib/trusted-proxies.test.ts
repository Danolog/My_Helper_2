/**
 * Testy listy zaufanych proxy (TRUSTED_PROXIES) i wyboru adresu klienta
 * z łańcucha X-Forwarded-For (src/lib/trusted-proxies.ts).
 *
 * Model zagrożenia: lewą część X-Forwarded-For klient wpisuje sam, więc może
 * ją podrobić. Wiarygodne są tylko wpisy dopisane przez nasze proxy, czyli
 * prawy koniec łańcucha. Adres klienta to pierwszy od prawej wpis, który NIE
 * jest zaufanym proxy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockWarn = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  parseTrustedProxies,
  getTrustedProxies,
  isTrustedProxy,
  selectClientIp,
} from "@/lib/trusted-proxies";

beforeEach(() => {
  mockWarn.mockClear();
});

// -------------------------------------------------------
// parseTrustedProxies
// -------------------------------------------------------

describe("parseTrustedProxies", () => {
  it("zwraca pustą listę dla braku wartości", () => {
    expect(parseTrustedProxies(undefined)).toEqual([]);
    expect(parseTrustedProxies("")).toEqual([]);
    expect(parseTrustedProxies("  , ,  ")).toEqual([]);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("przyjmuje adresy i wąskie zakresy CIDR (IPv4 i IPv6), przycina spacje", () => {
    expect(
      parseTrustedProxies(" 34.120.10.5 , 35.191.0.0/16,130.211.0.0/22, 2600:1901::/48, 2001:db8::1 ")
    ).toEqual(["34.120.10.5", "35.191.0.0/16", "130.211.0.0/22", "2600:1901::/48", "2001:db8::1"]);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("przyjmuje wąski zakres prywatny (/24 i węższy) i pojedynczy adres prywatny", () => {
    expect(parseTrustedProxies("10.8.0.0/24,192.168.1.10,127.0.0.1")).toEqual([
      "10.8.0.0/24",
      "192.168.1.10",
      "127.0.0.1",
    ]);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it.each([
    "0.0.0.0/0",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "::/0",
  ])("odrzuca szeroki zakres %s z ostrzeżeniem w logu", (entry) => {
    expect(parseTrustedProxies(`${entry},34.120.10.5`)).toEqual(["34.120.10.5"]);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn.mock.calls[0]?.[1]).toMatchObject({ entry, reason: "too_broad" });
  });

  it.each([
    "10.0.0.0/9", // podzbiór 10/8, ale dalej obejmuje miliony adresów prywatnych
    "10.1.0.0/16", // prywatny szerszy niż /24
    "172.20.0.0/20",
    "8.0.0.0/8", // publiczny szerszy niż /16
    "fd00::/8", // ULA szersze niż /64
    "2600::/16", // publiczny IPv6 szerszy niż /32
  ])("odrzuca zbyt szeroki zakres %s (reguła minimalnego prefiksu)", (entry) => {
    expect(parseTrustedProxies(entry)).toEqual([]);
    expect(mockWarn.mock.calls[0]?.[1]).toMatchObject({ entry, reason: "too_broad" });
  });

  it.each([
    "not-an-ip",
    "256.1.1.1",
    "1.2.3",
    "01.2.3.4",
    "1.2.3.4/33",
    "1.2.3.4/",
    "1.2.3.4/abc",
    "2001:db8::1/129",
    "1.2.3.4:8080",
    "fe80::1%eth0",
  ])("odrzuca niepoprawny wpis %s z ostrzeżeniem w logu", (entry) => {
    expect(parseTrustedProxies(entry)).toEqual([]);
    expect(mockWarn.mock.calls[0]?.[1]).toMatchObject({ entry, reason: "invalid" });
  });
});

// -------------------------------------------------------
// getTrustedProxies — jedno źródło prawdy z env
// -------------------------------------------------------

describe("getTrustedProxies", () => {
  const original = process.env.TRUSTED_PROXIES;

  afterEach(() => {
    if (original === undefined) delete process.env.TRUSTED_PROXIES;
    else process.env.TRUSTED_PROXIES = original;
  });

  it("domyślnie (brak zmiennej) zwraca pustą listę", () => {
    delete process.env.TRUSTED_PROXIES;
    expect(getTrustedProxies()).toEqual([]);
  });

  it("czyta TRUSTED_PROXIES i odrzuca szerokie zakresy", () => {
    process.env.TRUSTED_PROXIES = "34.120.10.5,10.0.0.0/8";
    expect(getTrustedProxies()).toEqual(["34.120.10.5"]);
  });

  it("ostrzega raz dla danej wartości zmiennej, nie przy każdym żądaniu", () => {
    process.env.TRUSTED_PROXIES = "34.120.10.6,0.0.0.0/0";
    getTrustedProxies();
    getTrustedProxies();
    getTrustedProxies();
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------
// isTrustedProxy
// -------------------------------------------------------

describe("isTrustedProxy", () => {
  const trusted = ["34.120.10.5", "35.191.0.0/16", "2600:1901::/48"];

  it("dopasowuje adres dokładny i zakres CIDR", () => {
    expect(isTrustedProxy("34.120.10.5", trusted)).toBe(true);
    expect(isTrustedProxy("35.191.200.7", trusted)).toBe(true);
    expect(isTrustedProxy("2600:1901:0:abcd::1", trusted)).toBe(true);
  });

  it("dopasowuje IPv4 zapisany jako IPv4-mapped IPv6", () => {
    expect(isTrustedProxy("::ffff:34.120.10.5", trusted)).toBe(true);
  });

  it("nie dopasowuje adresu spoza listy ani śmieci", () => {
    expect(isTrustedProxy("34.120.10.6", trusted)).toBe(false);
    expect(isTrustedProxy("35.192.0.1", trusted)).toBe(false);
    expect(isTrustedProxy("2600:1902::1", trusted)).toBe(false);
    expect(isTrustedProxy("garbage", trusted)).toBe(false);
    expect(isTrustedProxy("", trusted)).toBe(false);
  });
});

// -------------------------------------------------------
// selectClientIp — wybór adresu z łańcucha X-Forwarded-For
// -------------------------------------------------------

describe("selectClientIp", () => {
  const LB = "34.120.10.5";
  const GFE = "35.191.3.4";

  describe("0 zaufanych proxy (lista pusta — lokalnie i Vercel)", () => {
    it("pojedyncza wartość: zwraca ją bez zmian (jak dziś)", () => {
      expect(selectClientIp("203.0.113.50", [])).toBe("203.0.113.50");
      expect(selectClientIp("  203.0.113.50  ", [])).toBe("203.0.113.50");
      expect(selectClientIp("10.12.34.56", [])).toBe("10.12.34.56");
    });

    it("wiele wartości: bierze prawą (dopisaną najbliżej nas), nie podrobioną lewą", () => {
      expect(selectClientIp("6.6.6.6, 203.0.113.50", [])).toBe("203.0.113.50");
    });

    it("pusty nagłówek: null", () => {
      expect(selectClientIp("", [])).toBeNull();
      expect(selectClientIp(" , ", [])).toBeNull();
    });
  });

  describe("1 zaufane proxy (LB)", () => {
    it("<klient>, <LB> → klient", () => {
      expect(selectClientIp(`203.0.113.50, ${LB}`, [LB])).toBe("203.0.113.50");
    });

    it("podrobiony lewy adres nie wygrywa: <podróbka>, <klient>, <LB> → klient", () => {
      expect(selectClientIp(`1.1.1.1, 203.0.113.50, ${LB}`, [LB])).toBe("203.0.113.50");
    });

    it("podróbka udająca nasz LB po lewej nie przesuwa wyboru", () => {
      expect(selectClientIp(`${LB}, 203.0.113.50, ${LB}`, [LB])).toBe("203.0.113.50");
    });

    it("każdy klient dostaje swój kubełek mimo wspólnego LB", () => {
      const a = selectClientIp(`203.0.113.50, ${LB}`, [LB]);
      const b = selectClientIp(`198.51.100.7, ${LB}`, [LB]);
      expect(a).not.toBe(b);
    });
  });

  describe("2 zaufane proxy (LB + GFE z zakresu CIDR)", () => {
    const trusted = [LB, "35.191.0.0/16"];

    it("<klient>, <LB>, <GFE> → klient", () => {
      expect(selectClientIp(`203.0.113.50, ${LB}, ${GFE}`, trusted)).toBe("203.0.113.50");
    });

    it("podrobiony lewy adres nie wygrywa", () => {
      expect(selectClientIp(`9.9.9.9, 8.8.8.8, 203.0.113.50, ${LB}, ${GFE}`, trusted)).toBe(
        "203.0.113.50"
      );
    });

    it("cały łańcuch z zaufanych proxy (np. health check): lewy wpis", () => {
      expect(selectClientIp(`${LB}, ${GFE}`, trusted)).toBe(LB);
    });

    it("niepoprawny wpis między proxy a klientem traktuje jako adres klienta", () => {
      expect(selectClientIp(`203.0.113.50, unknown, ${LB}`, trusted)).toBe("unknown");
    });
  });
});
