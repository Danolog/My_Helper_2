/**
 * Lista zaufanych proxy (env TRUSTED_PROXIES) i wybór adresu klienta
 * z łańcucha X-Forwarded-For.
 *
 * Jedno źródło prawdy dla:
 *  - Better Auth: `advanced.ipAddress.trustedProxies` (src/lib/auth.ts),
 *  - naszego limitera: `getClientIp` (src/lib/rate-limit.ts).
 *
 * Model zagrożenia: lewą część X-Forwarded-For wpisuje klient, więc może ją
 * podrobić. Każde proxy DOPISUJE po prawej adres, od którego dostało
 * połączenie. Adres klienta to więc pierwszy od prawej wpis, który NIE jest
 * naszym proxy. Przy pustej liście to po prostu prawy wpis (dla pojedynczej
 * wartości — lokalnie i na Vercel, który nadpisuje nagłówek — bez zmian).
 *
 * Format TRUSTED_PROXIES: CSV adresów IP lub zakresów CIDR (IPv4/IPv6),
 * np. "34.120.10.5,35.191.0.0/16". Domyślnie pusta.
 *
 * Vercel (`process.env.VERCEL === "1"`): adres klienta bierzemy najpierw
 * z `x-real-ip`, który ustawia Vercel Proxy (`@vercel/functions`:
 * IP_HEADER_NAME = "x-real-ip"), a X-Forwarded-For jest tylko zapasem.
 * Better Auth dostaje tę samą kolejność (`ipAddressHeaders`). Dzięki temu
 * nie zależymy od niezmierzonego założenia, że Vercel nadpisuje XFF jedną
 * wartością. Poza Vercelem `x-real-ip` NIE jest używany — tam klient może
 * wpisać go sam (np. LB GCP go nie ustawia).
 *
 * Odrzucane z ostrzeżeniem w logu:
 *  - wpisy niepoprawne (nie IP / nie CIDR, port, strefa IPv6),
 *  - zakresy zbyt szerokie. Reguła minimalnego prefiksu:
 *      IPv4 publiczny  ≥ /16,   IPv4 prywatny/specjalny ≥ /24,
 *      IPv6 publiczny  ≥ /32,   IPv6 ULA/link-local     ≥ /64.
 *    Obejmuje to wprost 0.0.0.0/0, ::/0, 10.0.0.0/8, 172.16.0.0/12,
 *    192.168.0.0/16, a także ich szerokie podzbiory (np. 10.0.0.0/9).
 *    Szeroki zakres prywatny obejmuje też klientów w tej samej sieci
 *    (VPC, Cloud NAT, inne usługi) — każdy z nich mógłby wtedy podać
 *    dowolny adres w XFF i wybrać sobie kubełek limitu.
 *  - zakresy IPv4-mapped z prefiksem (`::ffff:a.b.c.d/N`): Better Auth
 *    porównuje je inaczej niż my, więc obie warstwy widziałyby różne listy.
 *    Należy podać zakres IPv4 wprost (a.b.c.d/N).
 */

import { logger } from "@/lib/logger";

type ParsedIp = Uint8Array;

interface ParsedCidr {
  bytes: Uint8Array;
  prefix: number;
}

// ---------------------------------------------------------------------------
// Parsowanie adresów
// ---------------------------------------------------------------------------

const IPV4_OCTET = /^(0|[1-9]\d{0,2})$/;
const IPV6_GROUP = /^[0-9a-fA-F]{1,4}$/;

function parseIPv4(value: string): ParsedIp | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const part = parts[i] ?? "";
    if (!IPV4_OCTET.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes[i] = n;
  }
  return bytes;
}

function parseIPv6(value: string): ParsedIp | null {
  if (!value.includes(":")) return null;
  let head = value;
  let tail: Uint8Array | null = null;

  // Końcówka zapisana jako IPv4 (np. ::ffff:1.2.3.4)
  const lastColon = value.lastIndexOf(":");
  const maybeV4 = value.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    tail = parseIPv4(maybeV4);
    if (!tail) return null;
    head = value.slice(0, lastColon + 1);
    // "::1.2.3.4" → head "::"; "ffff:1.2.3.4" → head "ffff:" → usuwamy końcowy ":"
    if (!head.endsWith("::")) head = head.slice(0, -1);
  }

  const groupsNeeded = tail ? 6 : 8;
  const doubleColon = head.indexOf("::");
  if (doubleColon !== head.lastIndexOf("::")) return null;

  const toGroups = (s: string): string[] | null => {
    if (s === "") return [];
    const g = s.split(":");
    return g.every((x) => IPV6_GROUP.test(x)) ? g : null;
  };

  let groups: string[];
  if (doubleColon === -1) {
    const g = toGroups(head);
    if (!g || g.length !== groupsNeeded) return null;
    groups = g;
  } else {
    const left = toGroups(head.slice(0, doubleColon));
    const right = toGroups(head.slice(doubleColon + 2));
    if (!left || !right) return null;
    const missing = groupsNeeded - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  }

  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => {
    const n = Number.parseInt(g, 16);
    bytes[i * 2] = (n >> 8) & 0xff;
    bytes[i * 2 + 1] = n & 0xff;
  });
  if (tail) bytes.set(tail, 12);
  return bytes;
}

/** IPv4-mapped IPv6 (::ffff:a.b.c.d) → 4 bajty IPv4, jak w Better Auth. */
function unmapIPv4(bytes: ParsedIp): ParsedIp {
  if (bytes.length !== 16) return bytes;
  for (let i = 0; i < 10; i++) if (bytes[i] !== 0) return bytes;
  if (bytes[10] !== 0xff || bytes[11] !== 0xff) return bytes;
  return bytes.slice(12);
}

function parseIp(value: string): ParsedIp | null {
  const v = value.trim();
  if (v === "") return null;
  const bytes = parseIPv4(v) ?? parseIPv6(v);
  return bytes ? unmapIPv4(bytes) : null;
}

function parseCidr(value: string): ParsedCidr | null {
  const slash = value.indexOf("/");
  if (slash !== value.lastIndexOf("/")) return null;
  const addr = slash === -1 ? value : value.slice(0, slash);
  const raw = parseIPv4(addr) ?? parseIPv6(addr);
  if (!raw) return null;
  const maxBits = raw.length * 8;
  let prefix = maxBits;
  if (slash !== -1) {
    const p = value.slice(slash + 1);
    if (!/^\d{1,3}$/.test(p)) return null;
    prefix = Number(p);
    if (prefix > maxBits) return null;
  }
  // ::ffff:a.b.c.d/N → zakres IPv4 z prefiksem N-96
  const bytes = unmapIPv4(raw);
  if (bytes.length === 4 && raw.length === 16) {
    if (prefix < 96) return null;
    prefix -= 96;
  }
  return { bytes, prefix };
}

function matchesCidr(ip: ParsedIp, net: ParsedCidr): boolean {
  if (ip.length !== net.bytes.length) return false;
  let bits = net.prefix;
  for (let i = 0; i < ip.length && bits > 0; i++) {
    const take = Math.min(8, bits);
    const mask = (0xff << (8 - take)) & 0xff;
    if (((ip[i] ?? 0) & mask) !== ((net.bytes[i] ?? 0) & mask)) return false;
    bits -= 8;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Reguła „zbyt szeroki zakres"
// ---------------------------------------------------------------------------

/** Zakresy prywatne/specjalne, w których mogą siedzieć także klienci. */
const IPV4_PRIVATE_OR_SPECIAL: ParsedCidr[] = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10", // CGNAT
  "127.0.0.0/8",
  "169.254.0.0/16",
  "0.0.0.0/8", // "ta sieć"
  "198.18.0.0/15", // RFC 2544 (testy; fixture E2E)
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // zarezerwowane
].map((c) => parseCidr(c) as ParsedCidr);

/** IPv6 ULA i link-local — minimum /64, jak sieć lokalna. */
const IPV6_LOCAL: ParsedCidr[] = ["fc00::/7", "fe80::/10"].map(
  (c) => parseCidr(c) as ParsedCidr
);

const MIN_PREFIX = {
  v4Public: 16,
  v4Private: 24,
  v6Public: 32,
  v6Ula: 64,
} as const;

function isTooBroad(net: ParsedCidr): boolean {
  if (net.bytes.length === 4) {
    if (net.prefix < MIN_PREFIX.v4Public) return true;
    const isPrivate = IPV4_PRIVATE_OR_SPECIAL.some((p) => matchesCidr(net.bytes, p));
    return isPrivate && net.prefix < MIN_PREFIX.v4Private;
  }
  if (net.prefix < MIN_PREFIX.v6Public) return true;
  return IPV6_LOCAL.some((p) => matchesCidr(net.bytes, p)) && net.prefix < MIN_PREFIX.v6Ula;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Parsuje CSV z TRUSTED_PROXIES. Zwraca przyjęte wpisy (po trim, w zapisie
 * z env — ten sam format przyjmuje Better Auth 1.7.x). Wpisy niepoprawne
 * i zbyt szerokie są pomijane z ostrzeżeniem w logu.
 */
export function parseTrustedProxies(raw: string | undefined): string[] {
  if (!raw) return [];
  const accepted: string[] = [];
  for (const token of raw.split(",")) {
    const entry = token.trim();
    if (entry === "") continue;
    const net = parseCidr(entry);
    if (!net) {
      logger.warn("[TrustedProxies] Ignoring invalid TRUSTED_PROXIES entry", {
        entry,
        reason: "invalid",
      });
      continue;
    }
    if (entry.includes("/") && net.bytes.length === 4 && entry.includes(":")) {
      logger.warn(
        "[TrustedProxies] Ignoring IPv4-mapped CIDR in TRUSTED_PROXIES — write the IPv4 range directly (a.b.c.d/N)",
        { entry, reason: "ipv4_mapped_cidr" }
      );
      continue;
    }
    if (isTooBroad(net)) {
      logger.warn(
        "[TrustedProxies] Ignoring too broad TRUSTED_PROXIES range — list the actual proxy addresses",
        { entry, reason: "too_broad" }
      );
      continue;
    }
    accepted.push(entry);
  }
  return accepted;
}

let cache: { raw: string | undefined; list: string[]; parsed: ParsedCidr[] } | null = null;

function load() {
  const raw = process.env.TRUSTED_PROXIES;
  if (!cache || cache.raw !== raw) {
    const list = parseTrustedProxies(raw);
    cache = { raw, list, parsed: list.map((e) => parseCidr(e) as ParsedCidr) };
  }
  return cache;
}

/** Zaufane proxy z env (przefiltrowane). Parsowane raz na wartość zmiennej. */
export function getTrustedProxies(): string[] {
  return [...load().list];
}

/** Czy `ip` należy do któregoś z zaufanych proxy. */
export function isTrustedProxy(ip: string, trusted: readonly string[]): boolean {
  const bytes = parseIp(ip);
  if (!bytes) return false;
  const nets =
    cache && trusted === cache.list
      ? cache.parsed
      : trusted.map(parseCidr).filter((n): n is ParsedCidr => n !== null);
  return nets.some((n) => matchesCidr(bytes, n));
}

/**
 * Wybiera adres klienta z wartości X-Forwarded-For: pierwszy od prawej wpis,
 * który nie jest zaufanym proxy. Gdy wszystkie wpisy to zaufane proxy
 * (żądanie z wnętrza infrastruktury) — null, jak Better Auth (wywołujący
 * przechodzi do zapasu / "unknown"). Pusty nagłówek → null.
 *
 * Wpis niebędący poprawnym IP nie może być zaufanym proxy, więc jest
 * traktowany jak adres klienta (zwracany bez zmian, jak dotąd).
 */
export function selectClientIp(xff: string, trusted: readonly string[]): string | null {
  const hops = xff
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (hops.length === 0) return null;
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i] as string;
    if (!isTrustedProxy(hop, trusted)) return hop;
  }
  return null;
}

/** Wariant dla getClientIp: lista z env. */
export function selectClientIpFromEnv(xff: string): string | null {
  const { list } = load();
  return selectClientIp(xff, list);
}

// ---------------------------------------------------------------------------
// Adres klienta z nagłówków żądania (getClientIp) + konfiguracja Better Auth
// ---------------------------------------------------------------------------

/** Vercel ustawia VERCEL=1 w środowisku funkcji (build i runtime). */
export function isVercel(): boolean {
  return process.env.VERCEL === "1";
}

/**
 * Kolejność nagłówków IP — ta sama dla getClientIp i Better Auth
 * (`advanced.ipAddress.ipAddressHeaders`). Poza Vercelem: tylko XFF
 * (domyślne Better Auth), więc zwracamy undefined.
 */
export const VERCEL_IP_HEADERS = ["x-real-ip", "x-forwarded-for"] as const;

/** `advanced.ipAddress` dla Better Auth — z tych samych źródeł co getClientIp. */
export function getAuthIpAddressOptions(): {
  trustedProxies?: string[];
  ipAddressHeaders?: string[];
} {
  const trustedProxies = getTrustedProxies();
  return {
    ...(trustedProxies.length > 0 ? { trustedProxies } : {}),
    ...(isVercel() ? { ipAddressHeaders: [...VERCEL_IP_HEADERS] } : {}),
  };
}

let forwardedChainWarned = false;

/** Tylko dla testów: pozwala ponownie sprawdzić jednorazowe ostrzeżenie. */
export function resetForwardedChainWarningForTests(): void {
  forwardedChainWarned = false;
}

/**
 * Jednorazowo (na proces) ostrzega, gdy XFF przychodzi jako łańcuch, a lista
 * zaufanych proxy jest pusta. Poza Vercelem to błąd konfiguracji (za LB
 * wszyscy wpadają do jednego kubełka); na Vercelu to pomiar „hops", czy
 * platforma rzeczywiście nadpisuje XFF jedną wartością. Bez adresów IP
 * w logu — tylko liczba hopów i porównania z x-real-ip.
 */
function warnOnForwardedChain(hops: string[], realIp: string | null): void {
  if (forwardedChainWarned || hops.length < 2) return;
  if (load().list.length > 0) return;
  forwardedChainWarned = true;
  logger.warn(
    "[TrustedProxies] X-Forwarded-For has multiple hops but TRUSTED_PROXIES is empty — behind a load balancer all clients share one rate-limit bucket",
    {
      hops: hops.length,
      vercel: isVercel(),
      xRealIpPresent: realIp !== null,
      xRealIpEqualsRightmost: realIp !== null && realIp === hops[hops.length - 1],
      xRealIpEqualsLeftmost: realIp !== null && realIp === hops[0],
    }
  );
}

/**
 * Adres klienta z nagłówków żądania albo null.
 *
 * - Vercel: `x-real-ip` (Vercel Proxy), potem XFF od prawej jako zapas.
 * - Poza Vercelem: wyłącznie XFF od prawej z pominięciem zaufanych proxy;
 *   `x-real-ip` jest ignorowany (klient może go podrobić).
 */
export function resolveClientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  const realIpRaw = headers.get("x-real-ip")?.trim();
  const realIp = realIpRaw ? realIpRaw : null;

  const hops = xff
    ? xff
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean)
    : [];
  warnOnForwardedChain(hops, realIp);

  // Jak Better Auth: niepoprawny x-real-ip jest pomijany i decyduje XFF.
  if (isVercel() && realIp && parseIp(realIp)) return realIp;
  return xff ? selectClientIpFromEnv(xff) : null;
}
