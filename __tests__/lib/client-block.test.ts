/**
 * Reguły blokady rezerwacji online (src/lib/client-block.ts) i ich zgodność
 * ze schematami walidacji (src/lib/api-validation.ts).
 */
import { describe, it, expect } from "vitest";
import { clientBlockSchema, noShowSettingsSchema } from "@/lib/api-validation";
import {
  CLIENT_BLOCK_NOTE_MAX_LENGTH,
  isClientBlockRole,
  NO_SHOW_AUTO_BLOCK_THRESHOLDS,
  onlineBookingUnavailableMessage,
  parseNoShowAutoBlockThreshold,
  reachesNoShowAutoBlock,
} from "@/lib/client-block";

describe("parseNoShowAutoBlockThreshold", () => {
  it.each([1, 2, 3])("%j → %j", (raw) => {
    expect(parseNoShowAutoBlockThreshold(raw)).toBe(raw);
  });

  it.each([null, undefined, 0, 4, -1, 1.5, "2", true, {}, [2], Number.NaN])(
    "%j → null (wyłączona)",
    (raw) => {
      expect(parseNoShowAutoBlockThreshold(raw)).toBeNull();
    }
  );
});

describe("reachesNoShowAutoBlock", () => {
  it.each([
    [0, 1, false],
    [1, 1, true],
    [1, 2, false],
    [2, 2, true],
    [5, 3, true],
    [2, 3, false],
    [10, null, false],
  ] as const)("licznik %j, próg %j → %j", (count, threshold, expected) => {
    expect(reachesNoShowAutoBlock(count, threshold)).toBe(expected);
  });
});

describe("isClientBlockRole", () => {
  it("tylko właściciel", () => {
    expect(isClientBlockRole("owner")).toBe(true);
    expect(isClientBlockRole("receptionist")).toBe(false);
    expect(isClientBlockRole("employee")).toBe(false);
  });
});

describe("onlineBookingUnavailableMessage", () => {
  it("z telefonem salonu", () => {
    expect(onlineBookingUnavailableMessage(" +48 000 600 704 ")).toBe(
      "Rezerwacja online jest niedostępna. Zadzwoń do salonu: +48 000 600 704"
    );
  });

  it.each([null, undefined, "", "   "])("bez telefonu (%j)", (phone) => {
    expect(onlineBookingUnavailableMessage(phone)).toBe(
      "Rezerwacja online jest niedostępna. Skontaktuj się z salonem."
    );
  });

  it("komunikat nie zdradza powodu", () => {
    for (const msg of [onlineBookingUnavailableMessage("123"), onlineBookingUnavailableMessage(null)]) {
      expect(msg.toLowerCase()).not.toMatch(/zablokowan|nieobecno|blokad/);
    }
  });
});

describe("zgodność ze schematami", () => {
  it("noShowSettingsSchema przyjmuje dokładnie progi z listy i null", () => {
    for (const t of [...NO_SHOW_AUTO_BLOCK_THRESHOLDS, null]) {
      expect(noShowSettingsSchema.safeParse({ noShowAutoBlockThreshold: t }).success).toBe(true);
    }
    for (const t of [0, 4, "1", 2.5]) {
      expect(noShowSettingsSchema.safeParse({ noShowAutoBlockThreshold: t }).success).toBe(false);
    }
  });

  it("clientBlockSchema: notatka do limitu z migracji", () => {
    expect(clientBlockSchema.safeParse({ note: "a".repeat(CLIENT_BLOCK_NOTE_MAX_LENGTH) }).success).toBe(true);
    expect(clientBlockSchema.safeParse({ note: "a".repeat(CLIENT_BLOCK_NOTE_MAX_LENGTH + 1) }).success).toBe(false);
    expect(clientBlockSchema.safeParse({}).success).toBe(true);
  });
});
