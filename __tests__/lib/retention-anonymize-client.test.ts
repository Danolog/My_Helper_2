/**
 * `anonymizeClientData` bez bazy: brak salonu albo klienta kończy się błędem,
 * zanim funkcja wyśle cokolwiek do transakcji. Zachowanie na danych sprawdza
 * test na prawdziwym Postgresie (`__tests__/pg/anonymize-client.pg.test.ts`).
 */
import { describe, expect, it, vi } from "vitest";
import type { DbTx } from "@/lib/server/repository";
import { anonymizeClientData } from "@/lib/server/retention/anonymize-client";

function trackingTx() {
  const calls: string[] = [];
  const tx = new Proxy(
    {},
    {
      get(_target, prop) {
        return vi.fn(() => {
          calls.push(String(prop));
          throw new Error(`nieoczekiwane wywołanie tx.${String(prop)}`);
        });
      },
    }
  ) as unknown as DbTx;
  return { tx, calls };
}

describe("anonymizeClientData — walidacja argumentów", () => {
  it.each([
    ["pusty salonId", "", "client-1"],
    ["pusty clientId", "salon-1", ""],
    ["oba puste", "", ""],
  ])("%s → błąd, transakcja nietknięta", async (_label, salonId, clientId) => {
    const { tx, calls } = trackingTx();
    await expect(anonymizeClientData(tx, salonId, clientId)).rejects.toThrow(
      "anonymizeClientData: salonId i clientId wymagane"
    );
    expect(calls).toEqual([]);
  });
});
