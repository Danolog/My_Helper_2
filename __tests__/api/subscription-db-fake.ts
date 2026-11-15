/**
 * Atrapa `db` dla potwierdzenia subskrypcji (T3): confirm i webhook idą przez
 * prawdziwe `confirmSubscriptionCheckout()`, mockowana jest tylko baza.
 *
 * - `selects`: wyniki kolejnych SELECT-ów (w kolejności wywołań),
 * - `committed`: zapisy z transakcji, które się powiodły (wycofana
 *   transakcja nie zostawia nic — jak w Postgresie),
 * - `paymentInsertResult`: wynik `insert(subscription_payments)…returning()`;
 *   `[]` = konflikt na unikalnym indeksie (ktoś potwierdził pierwszy),
 * - `failNextSubscriptionWrite`: wyjątek z kodem Postgresa przy zapisie
 *   `salon_subscriptions` (np. 23505 z częściowego indeksu unikalnego),
 * - `log`: kolejność operacji (`lock_timeout`, `lock:stripe_sub:<id>`,
 *   `lock:salon:<salonId>`, `select`, `insert:<tabela>`,
 *   `update:<tabela>`, `commit`, `rollback`) — dowód, że odczyt stanu jest
 *   pod blokadą salonu,
 * - `partialUniqueActiveTrialing`: emulacja częściowego indeksu unikalnego
 *   z T3(b) (`salon_id` WHERE status IN ('trialing','active')) — wiersze
 *   „zatwierdzone przez inną transakcję”, niewidoczne dla SELECT-a; INSERT
 *   active/trialing przy istniejącym active/trialing tego salonu → 23505.
 *
 * Użycie (fabryki vi.mock nie widzą zwykłych importów):
 *   const f = await vi.hoisted(async () =>
 *     (await import("./subscription-db-fake")).createSubscriptionDbFake());
 *   vi.mock("@/lib/db", () => ({ db: f.db }));
 */
import { salonSubscriptions, subscriptionPayments } from "@/lib/schema";
import { SUBSCRIPTION_LOCK_NAMESPACE } from "@/lib/subscription-lock-namespace";

export interface FakeWrite {
  op: "insert" | "update";
  table: "salon_subscriptions" | "subscription_payments" | "other";
  values: Record<string, unknown>;
}

export function createSubscriptionDbFake() {
  const selects: unknown[][] = [];
  const committed: FakeWrite[] = [];
  const log: string[] = [];
  const partialUniqueActiveTrialing: Array<{ salonId: string; status: string }> = [];
  const state = {
    transactions: 0,
    rolledBack: 0,
    paymentInsertResult: null as unknown[] | null,
    failNextSubscriptionWrite: null as { code: string } | null,
    /** Wyjątek przy następnej blokadzie (np. 40P01 zakleszczenie, 55P03 lock_timeout). */
    failNextLock: null as { code: string } | null,
  };

  function tableName(t: unknown): FakeWrite["table"] {
    if (t === salonSubscriptions) return "salon_subscriptions";
    if (t === subscriptionPayments) return "subscription_payments";
    return "other";
  }

  function selectChain() {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "innerJoin", "leftJoin", "orderBy", "limit"]) {
      chain[m] = () => chain;
    }
    chain.then = (resolve: (r: unknown[]) => unknown, reject?: (e: unknown) => unknown) => {
      log.push("select");
      return Promise.resolve(selects.shift() ?? []).then(resolve, reject);
    };
    return chain;
  }

  function writeChain(op: FakeWrite["op"], table: unknown, sink: FakeWrite[]) {
    const write: FakeWrite = { op, table: tableName(table), values: {} };
    const chain: Record<string, unknown> = {};
    const record = () => {
      log.push(`${op}:${write.table}`);
      const status = write.values.status;
      if (
        op === "insert" &&
        write.table === "salon_subscriptions" &&
        (status === "active" || status === "trialing") &&
        partialUniqueActiveTrialing.some(
          (r) =>
            r.salonId === write.values.salonId && (r.status === "active" || r.status === "trialing")
        )
      ) {
        throw Object.assign(new Error("duplicate key (salon_subscriptions partial unique)"), {
          code: "23505",
        });
      }
      if (write.table === "salon_subscriptions" && state.failNextSubscriptionWrite) {
        const err = Object.assign(new Error("duplicate key"), state.failNextSubscriptionWrite);
        state.failNextSubscriptionWrite = null;
        throw err;
      }
      sink.push(write);
    };
    chain.values = (v: Record<string, unknown>) => {
      write.values = v;
      return chain;
    };
    chain.set = (v: Record<string, unknown>) => {
      write.values = v;
      return chain;
    };
    chain.where = () => chain;
    chain.onConflictDoNothing = () => chain;
    chain.returning = async () => {
      record();
      if (write.table === "subscription_payments" && state.paymentInsertResult) {
        return state.paymentInsertResult;
      }
      return [{ id: write.op === "insert" ? "sub-new" : "sub-updated", ...write.values }];
    };
    chain.then = (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      try {
        record();
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
      return Promise.resolve(undefined).then(resolve, reject);
    };
    return chain;
  }

  const db = {
    select: () => selectChain(),
    insert: (t: unknown) => writeChain("insert", t, committed),
    update: (t: unknown) => writeChain("update", t, committed),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      state.transactions++;
      const pending: FakeWrite[] = [];
      const tx = {
        select: () => selectChain(),
        insert: (t: unknown) => writeChain("insert", t, pending),
        update: (t: unknown) => writeChain("update", t, pending),
        execute: async (q: { queryChunks?: unknown[] }) => {
          const chunks = q.queryChunks ?? [];
          const text = JSON.stringify(chunks);
          if (text.includes("lock_timeout")) {
            log.push("lock_timeout");
            return [];
          }
          if (!text.includes("pg_advisory_xact_lock")) {
            log.push("execute");
            return [];
          }
          const ns = text.includes(String(SUBSCRIPTION_LOCK_NAMESPACE.stripeSub))
            ? "stripe_sub"
            : text.includes(String(SUBSCRIPTION_LOCK_NAMESPACE.salon))
              ? "salon"
              : "?";
          const key = chunks.find((c) => typeof c === "string");
          log.push(`lock:${ns}:${String(key)}`);
          if (state.failNextLock) {
            const err = Object.assign(new Error("lock failure"), state.failNextLock);
            state.failNextLock = null;
            throw err;
          }
          return [];
        },
      };
      try {
        const result = await fn(tx);
        committed.push(...pending);
        log.push("commit");
        return result;
      } catch (e) {
        state.rolledBack++;
        log.push("rollback");
        throw e;
      }
    },
  };

  function reset() {
    selects.length = 0;
    committed.length = 0;
    log.length = 0;
    partialUniqueActiveTrialing.length = 0;
    state.transactions = 0;
    state.rolledBack = 0;
    state.paymentInsertResult = null;
    state.failNextSubscriptionWrite = null;
    state.failNextLock = null;
  }

  return { db, selects, committed, log, partialUniqueActiveTrialing, state, reset };
}
