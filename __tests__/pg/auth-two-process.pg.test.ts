/**
 * W8: limit prób logowania działa wspólnie dla instancji w OSOBNYCH procesach.
 *
 * Dwa procesy potomne (`child_process.fork`, Node z loaderem tsx z node_modules),
 * każdy z własną instancją Better Auth z fabryki (`helpers/auth-instance.ts`)
 * i własnym modułem licznika — nic nie jest dzielone w pamięci. Wspólna jest
 * tylko baza. Próby z jednego adresu na `/sign-in/email` naprzemiennie: 1. i 3.
 * w procesie A, 2. i 4. w procesie B → 401, 401, 401, 429.
 *
 * Z magazynem w pamięci procesu (tryb `memory`) każdy proces widzi tylko dwie
 * próby i czwarta też dostaje 401 — ten test ma wtedy być czerwony.
 *
 *   INTEGRATION_POSTGRES_URL=postgresql://…@localhost:5432/pos_dev pnpm exec vitest run --config vitest.pg.config.ts __tests__/pg/auth-two-process.pg.test.ts
 */
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountThrottleKey, ipThrottleKey } from "@/lib/auth-throttle-keys";
import { createIntegrationDb, INTEGRATION_URL } from "./pg-harness";

const STORE = "database";
const SECRET = "it-auth-two-process-secret-0123456789abcdef";
const ROOT = path.resolve(__dirname, "../..");
const CHILD = path.join(__dirname, "helpers/auth-instance.ts");
const START_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 5_000;

const h = await createIntegrationDb();
const suite = h && INTEGRATION_URL ? describe : describe.skip;

type Reply = { id?: number; status?: number; ready?: boolean; error?: string };

class Child {
  private nextId = 1;
  private pending = new Map<number, (status: number) => void>();
  readonly proc: ChildProcess;
  readonly ready: Promise<void>;

  constructor(name: string) {
    this.proc = fork(CHILD, [], {
      cwd: ROOT,
      execPath: process.execPath,
      execArgv: ["--import", "tsx"],
      env: {
        ...process.env,
        NODE_ENV: "test",
        INTEGRATION_POSTGRES_URL: INTEGRATION_URL,
        POSTGRES_URL: INTEGRATION_URL,
        AUTH_RATE_LIMIT_STORE: STORE,
        BETTER_AUTH_SECRET: SECRET,
      },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`proces ${name}: brak gotowości w ${START_TIMEOUT_MS} ms`)), START_TIMEOUT_MS);
      this.proc.on("message", (m: Reply) => {
        if (m.ready) {
          clearTimeout(timer);
          resolve();
        } else if (m.error && m.id === undefined) {
          clearTimeout(timer);
          reject(new Error(`proces ${name}: ${m.error}`));
        } else if (m.id !== undefined) {
          this.pending.get(m.id)?.(m.status ?? -1);
          this.pending.delete(m.id);
        }
      });
      this.proc.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`proces ${name} zakończył się kodem ${code}`));
      });
    });
  }

  attempt(ip: string, email: string): Promise<number> {
    const id = this.nextId++;
    return new Promise<number>((resolve) => {
      this.pending.set(id, resolve);
      this.proc.send({ id, path: "/sign-in/email", ip, email });
    });
  }

  async stop(): Promise<void> {
    if (this.proc.exitCode !== null || this.proc.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => this.proc.once("exit", () => resolve()));
    if (this.proc.connected) this.proc.disconnect();
    const timer = setTimeout(() => this.proc.kill("SIGKILL"), STOP_TIMEOUT_MS);
    await exited;
    clearTimeout(timer);
  }
}

suite("W8: dwa procesy, wspólny licznik w bazie", () => {
  const ip = `198.19.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
  const email = `it-authlimit-w8-${randomUUID().slice(0, 8)}@example.invalid`;
  let a: Child;
  let b: Child;

  beforeAll(async () => {
    a = new Child("A");
    b = new Child("B");
    await Promise.all([a.ready, b.ready]);
  }, START_TIMEOUT_MS + 10_000);

  afterAll(async () => {
    await Promise.allSettled([a?.stop(), b?.stop()]);
    if (h) {
      for (const key of [ipThrottleKey(`${ip}|/sign-in/email`, SECRET), accountThrottleKey(email, SECRET)]) {
        await h.observer.unsafe("DELETE FROM auth_rate_limit WHERE key = $1", [key]);
      }
      await h.end();
    }
  }, 2 * STOP_TIMEOUT_MS + 10_000);

  it("ten sam adres, próby naprzemiennie A, B, A, B → 401, 401, 401, 429", async () => {
    const statuses = [
      await a.attempt(ip, email),
      await b.attempt(ip, email),
      await a.attempt(ip, email),
      await b.attempt(ip, email),
    ];
    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it("procesy to osobne PID-y, różne od procesu testu", () => {
    expect(a.proc.pid).toBeDefined();
    expect(b.proc.pid).toBeDefined();
    expect(a.proc.pid).not.toBe(b.proc.pid);
    expect([a.proc.pid, b.proc.pid]).not.toContain(process.pid);
  });
});
