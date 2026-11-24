/**
 * lib/push-subscription — allowlista endpointów Web Push i walidacja kluczy.
 *
 * web-push robi https.request na host:port z `endpoint` (url.parse). Bez
 * allowlisty dowolne konto kierowało nasz serwer na dowolny host (SSRF, P1 —
 * ocena z audytu bezpieczeństwa na #46, sekcja 2).
 */
import { parse as legacyParse } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  PUSH_ENDPOINT_MAX_LENGTH,
  PushDeadlineError,
  isAllowedPushHost,
  isValidP256dh,
  isValidPushAuth,
  isValidPushEndpoint,
  isValidPushSubscription,
  runWithConcurrency,
  withPushDeadline,
} from "@/lib/push-subscription";
import {
  VALID_AUTH,
  VALID_ENDPOINTS,
  VALID_P256DH,
} from "../fixtures/push-subscriptions";

const FCM = VALID_ENDPOINTS.chromeFcm;
const FCM_PATH = FCM.slice("https://fcm.googleapis.com".length);

describe("isValidPushEndpoint — przyjmuje usługi push przeglądarek", () => {
  it.each(Object.entries(VALID_ENDPOINTS))("%s", (_name, endpoint) => {
    expect(isValidPushEndpoint(endpoint)).toBe(true);
  });

  it("wszystkie regiony WNS i hosty Apple pod sufiksem", () => {
    expect(isValidPushEndpoint("https://wns2-bl2p.notify.windows.com/w/?token=AbC")).toBe(true);
    expect(isValidPushEndpoint("https://db5.notify.windows.com/w/?token=AbC")).toBe(true);
    expect(isValidPushEndpoint("https://api.push.apple.com/abc")).toBe(true);
  });

  it("url.parse (parser web-push) widzi ten sam host co WHATWG", () => {
    for (const endpoint of Object.values(VALID_ENDPOINTS)) {
      expect(legacyParse(endpoint).hostname).toBe(new URL(endpoint).hostname);
      expect(legacyParse(endpoint).port).toBeNull();
    }
  });
});

describe("isValidPushEndpoint — odrzuca", () => {
  const rejected: Array<[string, unknown]> = [
    ["metadane GCP/AWS przez http", "http://169.254.169.254/computeMetadata/v1/"],
    ["metadane przez https", "https://169.254.169.254/latest/meta-data/"],
    ["obcy host", "https://evil.example/fcm/send/x"],
    ["sufiks doklejony do FCM", `https://fcm.googleapis.com.evil.example${FCM_PATH}`],
    ["FCM jako subdomena obcego hosta", `https://evilfcm.googleapis.com${FCM_PATH}`],
    ["obca domena kończąca się na apple", "https://evilpush.apple.com/x"],
    ["sufiks bez kropki (notify.windows.com.evil)", "https://wns2.notify.windows.com.evil.example/w/"],
    ["goły sufiks bez etykiety", "https://push.apple.com/x"],
    ["http do FCM", FCM.replace("https:", "http:")],
    ["HTTPS wielkimi literami", FCM.replace("https:", "HTTPS:")],
    ["host wielkimi literami", FCM.replace("fcm.googleapis.com", "FCM.googleapis.com")],
    ["userinfo", `https://user:pass@fcm.googleapis.com${FCM_PATH}`],
    ["userinfo z hostem FCM przed @", `https://fcm.googleapis.com@169.254.169.254${FCM_PATH}`],
    ["@ za fragmentem (#@)", `https://169.254.169.254#@fcm.googleapis.com${FCM_PATH}`],
    ["backslash przed @", `https://fcm.googleapis.com\\@169.254.169.254${FCM_PATH}`],
    ["backslash zamiast ukośnika", `https:\\\\fcm.googleapis.com${FCM_PATH}`],
    ["port niedomyślny", `https://fcm.googleapis.com:8443${FCM_PATH}`],
    ["port domyślny jawnie", `https://fcm.googleapis.com:443${FCM_PATH}`],
    ["IP literal v4", "https://10.0.0.5/fcm/send/x"],
    ["IP literal v6", "https://[::1]/fcm/send/x"],
    ["IP dziesiętny", "https://2852039166/x"],
    ["trailing dot", `https://fcm.googleapis.com.${FCM_PATH}`],
    ["IDN w Unicode", "https://fcm.googleapis.cóm/x"],
    ["kropka pełnej szerokości", "https://fcm．googleapis.com/x"],
    ["punycode obcej domeny", "https://xn--fcm-googleapis-com.evil.example/x"],
    ["fragment", `${FCM}#frag`],
    ["spacja na początku", ` ${FCM}`],
    ["znak nowej linii na końcu", `${FCM}\n`],
    ["traversal (niekanoniczny)", "https://fcm.googleapis.com/fcm/../../x"],
    ["bez ścieżki", "https://fcm.googleapis.com"],
    ["schemat bez ukośników", "https:fcm.googleapis.com/x"],
    ["file:", "file:///etc/passwd"],
    ["data:", "data:text/plain,x"],
    ["pusty", ""],
    ["za długi", `https://fcm.googleapis.com/fcm/send/${"a".repeat(PUSH_ENDPOINT_MAX_LENGTH)}`],
    ["nie string", 42],
    ["null", null],
  ];

  it.each(rejected)("%s", (_name, endpoint) => {
    expect(isValidPushEndpoint(endpoint)).toBe(false);
  });
});

describe("isAllowedPushHost", () => {
  it("dokładne hosty i sufiksy na granicy etykiety", () => {
    expect(isAllowedPushHost("fcm.googleapis.com")).toBe(true);
    expect(isAllowedPushHost("updates.push.services.mozilla.com")).toBe(true);
    expect(isAllowedPushHost("web.push.apple.com")).toBe(true);
    expect(isAllowedPushHost("wns2-par02p.notify.windows.com")).toBe(true);
    expect(isAllowedPushHost("android.googleapis.com")).toBe(false);
    expect(isAllowedPushHost("googleapis.com")).toBe(false);
    expect(isAllowedPushHost("xpush.apple.com")).toBe(false);
    expect(isAllowedPushHost("notify.windows.com")).toBe(false);
  });
});

describe("klucze p256dh / auth", () => {
  it("przyjmuje poprawne klucze przeglądarki", () => {
    expect(isValidP256dh(VALID_P256DH)).toBe(true);
    expect(isValidPushAuth(VALID_AUTH)).toBe(true);
  });

  it("odrzuca złą długość, zły prefiks punktu i znaki spoza base64url", () => {
    expect(isValidP256dh("key")).toBe(false);
    expect(isValidP256dh(Buffer.alloc(65, 0x02).toString("base64url"))).toBe(false);
    expect(isValidP256dh(Buffer.alloc(64, 0x04).toString("base64url"))).toBe(false);
    expect(isValidP256dh(`${VALID_P256DH.slice(0, -1)}+`)).toBe(false);
    expect(isValidP256dh("")).toBe(false);
    expect(isValidP256dh(undefined)).toBe(false);
    expect(isValidPushAuth("auth")).toBe(false);
    expect(isValidPushAuth(Buffer.alloc(15).toString("base64url"))).toBe(false);
    expect(isValidPushAuth("a/b+c=d")).toBe(false);
  });

  it("isValidPushSubscription łączy endpoint i klucze", () => {
    expect(isValidPushSubscription({ endpoint: FCM, p256dh: VALID_P256DH, auth: VALID_AUTH })).toBe(true);
    expect(isValidPushSubscription({ endpoint: "https://evil.example/x", p256dh: VALID_P256DH, auth: VALID_AUTH })).toBe(false);
    expect(isValidPushSubscription({ endpoint: FCM, p256dh: "key", auth: VALID_AUTH })).toBe(false);
  });
});

describe("withPushDeadline / runWithConcurrency", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("wiszące żądanie kończy się PushDeadlineError po limicie", async () => {
    vi.useFakeTimers();
    const pending = withPushDeadline(new Promise<never>(() => {}), 1000);
    const assertion = expect(pending).rejects.toBeInstanceOf(PushDeadlineError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("szybkie żądanie zwraca wynik", async () => {
    await expect(withPushDeadline(Promise.resolve("ok"), 1000)).resolves.toBe("ok");
  });

  it("nie przekracza limitu równoległości i przetwarza wszystko", async () => {
    let active = 0;
    let maxActive = 0;
    const done: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 1));
      done.push(n);
      active--;
    });
    expect(maxActive).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("pusta lista nie uruchamia workera", async () => {
    const worker = vi.fn();
    await runWithConcurrency([], 5, worker);
    expect(worker).not.toHaveBeenCalled();
  });
});
