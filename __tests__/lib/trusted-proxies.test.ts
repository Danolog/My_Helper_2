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
import {
  parseTrustedProxies,
  getTrustedProxies,
  isTrustedProxy,
  selectClientIp,
  resolveClientIp,
  resetForwardedChainWarningForTests,
} from "@/lib/trusted-proxies";

const mockWarn = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

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
    "::ffff:34.120.0.0/112",
    "::ffff:34.120.10.5/128",
    "::FFFF:10.0.0.0/104",
  ])("odrzuca IPv4-mapped CIDR %s (Better Auth czyta go inaczej)", (entry) => {
    expect(parseTrustedProxies(`${entry},34.120.10.5`)).toEqual(["34.120.10.5"]);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn.mock.calls[0]?.[1]).toMatchObject({ entry, reason: "ipv4_mapped_cidr" });
  });

  it("przyjmuje pojedynczy adres IPv4-mapped bez prefiksu (Better Auth czyta go tak samo)", () => {
    expect(parseTrustedProxies("::ffff:34.120.10.5")).toEqual(["::ffff:34.120.10.5"]);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it.each([
    "0.0.0.0/16",
    "198.18.0.0/16",
    "224.0.0.0/16",
    "240.0.0.0/16",
    "fe80::/16",
    "fe80::/48",
  ])("zakres specjalny %s podlega minimum /24 (IPv4) lub /64 (IPv6)", (entry) => {
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

  it("pojedynczy adres z 198.18.0.0/15 (fixture E2E) nie jest proxy: zwracany jako klient", () => {
    expect(selectClientIp("198.19.12.34", [])).toBe("198.19.12.34");
    expect(selectClientIp("198.19.12.34", ["34.120.10.5"])).toBe("198.19.12.34");
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

    it("cały łańcuch z zaufanych proxy (np. health check): null, jak Better Auth", () => {
      expect(selectClientIp(`${LB}, ${GFE}`, trusted)).toBeNull();
    });

    it("niepoprawny wpis między proxy a klientem → null, jak Better Auth", () => {
      expect(selectClientIp(`203.0.113.50, unknown, ${LB}`, trusted)).toBeNull();
      expect(selectClientIp(`203.0.113.50, 203.0.113.51:443, ${LB}, ${GFE}`, trusted)).toBeNull();
    });

    it("niepoprawny wpis na lewo od klienta nie ma znaczenia (przejście kończy się na kliencie)", () => {
      expect(selectClientIp(`garbage, 203.0.113.50, ${LB}`, trusted)).toBe("203.0.113.50");
    });

    it("niepoprawny wpis na miejscu zaufanego proxy → null", () => {
      expect(selectClientIp(`203.0.113.50, ${LB}, not-an-ip`, trusted)).toBeNull();
    });
  });

  describe("pusta lista: niepoprawny prawy wpis", () => {
    it.each(["garbage", "unknown", "203.0.113.50:1234", "fe80::1%eth0", "203.0.113.050", "[2001:db8::1]"])(
      "%s → null",
      (hop) => {
        expect(selectClientIp(hop, [])).toBeNull();
        expect(selectClientIp(`203.0.113.50, ${hop}`, [])).toBeNull();
      }
    );

    it("poprawny prawy wpis bez zmian", () => {
      expect(selectClientIp("garbage, 203.0.113.50", [])).toBe("203.0.113.50");
    });
  });
});

// -------------------------------------------------------
// resolveClientIp — jednorazowe ostrzeżenie o łańcuchu XFF przy pustej liście
// -------------------------------------------------------

describe("resolveClientIp: ostrzeżenie o łańcuchu XFF przy pustej liście", () => {
  const originalTrusted = process.env.TRUSTED_PROXIES;
  const originalVercel = process.env.VERCEL;

  beforeEach(() => {
    delete process.env.TRUSTED_PROXIES;
    delete process.env.VERCEL;
    resetForwardedChainWarningForTests();
  });

  afterEach(() => {
    if (originalTrusted === undefined) delete process.env.TRUSTED_PROXIES;
    else process.env.TRUSTED_PROXIES = originalTrusted;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });

  const headers = (h: Record<string, string>) => new Headers(h);

  it("ostrzega raz przy pierwszym XFF z wieloma wartościami (pomiar hops), bez adresów w logu", () => {
    resolveClientIp(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.50" }));
    resolveClientIp(headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.51" }));
    expect(mockWarn).toHaveBeenCalledTimes(1);
    const ctx = mockWarn.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(ctx).toMatchObject({ hops: 2, vercel: false, xRealIpPresent: false });
    expect(JSON.stringify(mockWarn.mock.calls[0])).not.toMatch(/6\.6\.6\.6|203\.0\.113/);
  });

  it("na Vercelu też ostrzega (pomiar) i podaje, czy x-real-ip = prawy wpis", () => {
    process.env.VERCEL = "1";
    expect(
      resolveClientIp(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.50", "x-real-ip": "203.0.113.50" }))
    ).toBe("203.0.113.50");
    expect(mockWarn.mock.calls[0]?.[1]).toMatchObject({
      hops: 2,
      vercel: true,
      xRealIpPresent: true,
      xRealIpEqualsRightmost: true,
      xRealIpEqualsLeftmost: false,
    });
  });

  it("nie ostrzega przy pojedynczej wartości XFF", () => {
    resolveClientIp(headers({ "x-forwarded-for": "203.0.113.50" }));
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("nie ostrzega przy niepustej liście zaufanych proxy", () => {
    process.env.TRUSTED_PROXIES = "34.120.10.5";
    expect(resolveClientIp(headers({ "x-forwarded-for": "203.0.113.50, 34.120.10.5" }))).toBe(
      "203.0.113.50"
    );
    expect(mockWarn).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------
// Parser IPv6 (L2 Leo): formy skrócone, niepoprawne, końcówka IPv4, łańcuch
// -------------------------------------------------------

describe("parser IPv6 (przez parseTrustedProxies / isTrustedProxy / selectClientIp)", () => {
  it.each([
    ["::", "::/128"],
    ["::1", "::1"],
    ["1::", "1::"],
    ["1:2:3:4:5:6:7::", "1:2:3:4:5:6:7::"],
    ["1:2:3:4:5:6:1.2.3.4", "1:2:3:4:5:6:1.2.3.4"],
    ["2001:db8::1", "2001:db8::1"],
  ])("poprawny adres %s jest przyjmowany i dopasowuje się sam do siebie", (ip, entry) => {
    expect(parseTrustedProxies(entry)).toEqual([entry]);
    expect(isTrustedProxy(ip, [entry])).toBe(true);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("formy skrócone są równoważne pełnemu zapisowi", () => {
    expect(isTrustedProxy("0:0:0:0:0:0:0:1", ["::1"])).toBe(true);
    expect(isTrustedProxy("1:0:0:0:0:0:0:0", ["1::"])).toBe(true);
    expect(isTrustedProxy("1:2:3:4:5:6:7:0", ["1:2:3:4:5:6:7::"])).toBe(true);
    expect(isTrustedProxy("1:2:3:4:5:6:102:304", ["1:2:3:4:5:6:1.2.3.4"])).toBe(true);
  });

  it.each([
    "1:::2",
    "1::2::3",
    ":1::",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7",
    "1:2:3:4:5:6:7:8::",
    "[2001:db8::1]",
    "12345::1",
    "g::1",
    "1:2:3:4:5:6:7:1.2.3.4",
  ])("niepoprawny adres %s: odrzucany z listy i nigdy nie jest proxy", (entry) => {
    expect(parseTrustedProxies(entry)).toEqual([]);
    expect(mockWarn.mock.calls[0]?.[1]).toMatchObject({ entry, reason: "invalid" });
    expect(isTrustedProxy(entry, ["::/0"])).toBe(false);
  });

  it.each([
    ["fd12:3456:789a:1::/64", true],
    ["fd12::/48", false],
    ["fe80::/64", true],
  ])("ULA/link-local %s: przyjęty = %s", (entry, accepted) => {
    expect(parseTrustedProxies(entry)).toEqual(accepted ? [entry] : []);
  });

  const LB = "34.120.10.5";
  it.each([
    [`2001:db8::abcd, ${LB}`, "2001:db8::abcd"],
    [`6.6.6.6, 2001:db8::abcd, ${LB}`, "2001:db8::abcd"],
    [`::ffff:203.0.113.50, ${LB}`, "::ffff:203.0.113.50"],
    [`2001:db8::abcd, ::ffff:${LB}`, "2001:db8::abcd"],
  ])("klient IPv6 w łańcuchu %s → %s", (xff, expected) => {
    expect(selectClientIp(xff, [LB])).toBe(expected);
  });

  it("LB IPv6 w łańcuchu jest pomijany", () => {
    expect(selectClientIp("203.0.113.50, 2600:1901::5", ["2600:1901::/48"])).toBe("203.0.113.50");
  });
});
