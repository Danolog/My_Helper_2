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
 *   `salon_subscriptions` (np. 23505 z częściowego indeksu unikalnego).
 *
 * Użycie (fabryki vi.mock nie widzą zwykłych importów):
 *   const f = await vi.hoisted(async () =>
 *     (await import("./subscription-db-fake")).createSubscriptionDbFake());
 *   vi.mock("@/lib/db", () => ({ db: f.db }));
 */
import { salonSubscriptions, subscriptionPayments } from "@/lib/schema";

export interface FakeWrite {
  op: "insert" | "update";
  table: "salon_subscriptions" | "subscription_payments" | "other";
  values: Record<string, unknown>;
}

export function createSubscriptionDbFake() {
  const selects: unknown[][] = [];
  const committed: FakeWrite[] = [];
  const state = {
    transactions: 0,
    rolledBack: 0,
    paymentInsertResult: null as unknown[] | null,
    failNextSubscriptionWrite: null as { code: string } | null,
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
    chain.then = (resolve: (r: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(selects.shift() ?? []).then(resolve, reject);
    return chain;
  }

  function writeChain(op: FakeWrite["op"], table: unknown, sink: FakeWrite[]) {
    const write: FakeWrite = { op, table: tableName(table), values: {} };
    const chain: Record<string, unknown> = {};
    const record = () => {
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
      };
      try {
        const result = await fn(tx);
        committed.push(...pending);
        return result;
      } catch (e) {
        state.rolledBack++;
        throw e;
      }
    },
  };

  function reset() {
    selects.length = 0;
    committed.length = 0;
    state.transactions = 0;
    state.rolledBack = 0;
    state.paymentInsertResult = null;
    state.failNextSubscriptionWrite = null;
  }

  return { db, selects, committed, state, reset };
}
