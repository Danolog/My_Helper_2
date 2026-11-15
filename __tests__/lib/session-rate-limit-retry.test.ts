/**
 * Testy łagodnej obsługi 429 na GET /api/auth/get-session po stronie klienta
 * (src/lib/session-rate-limit-retry.ts).
 *
 * Bez tej osłony 429 przy pierwszym pobraniu sesji daje w useSession()
 * `data: null, isPending: false` — strony traktują to jak brak logowania:
 * portal klienta przekierowuje na /login, panel się nie renderuje.
 * Osłona czeka X-Retry-After i ponawia tylko GET get-session.
 */
import { describe, it, expect, vi } from "vitest";
import { createSessionRateLimitRetryFetch } from "@/lib/session-rate-limit-retry";

function res429(retryAfter?: string): Response {
  return new Response(JSON.stringify({ message: "Too many requests" }), {
    status: 429,
    headers: retryAfter === undefined ? {} : { "X-Retry-After": retryAfter },
  });
}

function res200(): Response {
  return new Response(JSON.stringify({ session: {}, user: {} }), { status: 200 });
}

const SESSION_URL = "http://localhost:3000/api/auth/get-session";

function setup(responses: Response[]) {
  const baseFetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next;
  });
  const sleep = vi.fn(async () => {});
  const fetchImpl = createSessionRateLimitRetryFetch({
    baseFetch: baseFetch as unknown as typeof fetch,
    sleep,
  });
  return { baseFetch, sleep, fetchImpl };
}

describe("createSessionRateLimitRetryFetch", () => {
  it("happy path: 200 przechodzi bez ponowień", async () => {
    const { baseFetch, sleep, fetchImpl } = setup([res200()]);
    const res = await fetchImpl(SESSION_URL, { method: "GET" });
    expect(res.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("429 na GET get-session: czeka X-Retry-After i ponawia", async () => {
    const { baseFetch, sleep, fetchImpl } = setup([res429("3"), res200()]);
    const res = await fetchImpl(SESSION_URL, { method: "GET" });
    expect(res.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3000, undefined);
  });

  it("działa też dla URL z query i obiektu URL", async () => {
    const { baseFetch, fetchImpl } = setup([res429("1"), res200()]);
    const res = await fetchImpl(new URL(`${SESSION_URL}?disableCookieCache=true`));
    expect(res.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it("limit ponowień: po 2 ponowieniach oddaje 429 (bez pętli)", async () => {
    const { baseFetch, sleep, fetchImpl } = setup([res429("1"), res429("1"), res429("1"), res200()]);
    const res = await fetchImpl(SESSION_URL, { method: "GET" });
    expect(res.status).toBe(429);
    expect(baseFetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("brak/śmieciowy X-Retry-After: domyślne 1 s; zbyt duży: obcięty do 10 s", async () => {
    const a = setup([res429(), res200()]);
    await a.fetchImpl(SESSION_URL);
    expect(a.sleep).toHaveBeenCalledWith(1000, undefined);

    const b = setup([res429("abc"), res200()]);
    await b.fetchImpl(SESSION_URL);
    expect(b.sleep).toHaveBeenCalledWith(1000, undefined);

    const c = setup([res429("3600"), res200()]);
    await c.fetchImpl(SESSION_URL);
    expect(c.sleep).toHaveBeenCalledWith(10_000, undefined);
  });

  it("NIE ponawia logowania (POST /sign-in/email) — 429 trafia do formularza", async () => {
    const { baseFetch, sleep, fetchImpl } = setup([res429("3"), res200()]);
    const res = await fetchImpl("http://localhost:3000/api/auth/sign-in/email", { method: "POST" });
    expect(res.status).toBe(429);
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("NIE ponawia POST get-session (odświeżenie sesji) ani innych błędów", async () => {
    const post = setup([res429("1"), res200()]);
    expect((await post.fetchImpl(SESSION_URL, { method: "POST" })).status).toBe(429);
    expect(post.baseFetch).toHaveBeenCalledTimes(1);

    const err500 = setup([new Response("", { status: 500 }), res200()]);
    expect((await err500.fetchImpl(SESSION_URL)).status).toBe(500);
    expect(err500.baseFetch).toHaveBeenCalledTimes(1);

    const err401 = setup([new Response("", { status: 401 }), res200()]);
    expect((await err401.fetchImpl(SESSION_URL)).status).toBe(401);
    expect(err401.baseFetch).toHaveBeenCalledTimes(1);
  });

  it("przerwane żądanie (AbortSignal) nie jest ponawiane", async () => {
    const controller = new AbortController();
    const baseFetch = vi.fn(async () => res429("1"));
    const sleep = vi.fn(async () => {
      controller.abort();
    });
    const fetchImpl = createSessionRateLimitRetryFetch({
      baseFetch: baseFetch as unknown as typeof fetch,
      sleep,
    });
    const res = await fetchImpl(SESSION_URL, { signal: controller.signal });
    expect(res.status).toBe(429);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });
});
