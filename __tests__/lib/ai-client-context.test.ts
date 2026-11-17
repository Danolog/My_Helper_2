/**
 * Kontekst klienta w zapytaniach do modelu AI — do zapytania trafiają tylko
 * pola z białej listy, bez danych o zdrowiu i bez danych identyfikujących.
 */
import { describe, it, expect } from "vitest";
import {
  buildClientContext,
  CLIENT_CONTEXT_FIELDS,
  CLIENT_LABEL,
} from "@/lib/ai/client-context";

/** Pełny rekord klienta, tak jak zwraca go zapytanie `select()` bez listy kolumn. */
function makeFullClientRecord() {
  return {
    id: "c1b2c3d4-e5f6-4890-abcd-ef1234567890",
    salonId: "s1b2c3d4-e5f6-4890-abcd-ef1234567890",
    userId: "user-123",
    firstName: "Zofia",
    lastName: "Wisniewska",
    phone: "+48600111222",
    email: "zofia.wisniewska@example.com",
    notes: "Notatka wewnetrzna o kliencie",
    preferences: "Lubi kawe bez cukru",
    allergies: "Uczulenie na lateks",
    favoriteEmployeeId: "emp-1",
    birthday: "1987-03-15",
    requireDeposit: false,
    depositType: "percentage",
    depositValue: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
  };
}

const FORBIDDEN_VALUES = [
  "Zofia",
  "Wisniewska",
  "+48600111222",
  "600111222",
  "zofia.wisniewska@example.com",
  "Notatka wewnetrzna",
  "Uczulenie na lateks",
  "lateks",
  "1987",
  "user-123",
];

function expectNoForbiddenValues(text: string) {
  for (const value of FORBIDDEN_VALUES) {
    expect(text).not.toContain(value);
  }
}

describe("buildClientContext", () => {
  it("whitelist contains only preferences and birthday", () => {
    expect([...CLIENT_CONTEXT_FIELDS].sort()).toEqual(["birthday", "preferences"]);
  });

  it("labels the client with the constant word instead of a name", () => {
    const lines = buildClientContext(makeFullClientRecord());
    expect(lines[0]).toBe(CLIENT_LABEL);
    expect(CLIENT_LABEL).toBe("Klient");
  });

  it("full record: output has no health data, names, phone, e-mail, notes or birth year", () => {
    const record = makeFullClientRecord();
    const text = buildClientContext(record, { includeBirthday: true }).join("\n");
    expectNoForbiddenValues(text);
  });

  it("full record without options: output has no forbidden values", () => {
    const text = buildClientContext(makeFullClientRecord()).join("\n");
    expectNoForbiddenValues(text);
  });

  it("reads only whitelisted fields even when extra fields carry text", () => {
    const record = {
      ...makeFullClientRecord(),
      medicalHistory: "Cukrzyca typu 2",
      pesel: "87031512345",
    };
    const text = buildClientContext(record, { includeBirthday: true }).join("\n");
    expect(text).not.toContain("Cukrzyca");
    expect(text).not.toContain("87031512345");
    expectNoForbiddenValues(text);
  });

  it("includes preferences with the default label", () => {
    const lines = buildClientContext(makeFullClientRecord());
    expect(lines).toContain("Preferencje: Lubi kawe bez cukru");
  });

  it("uses a custom preferences label", () => {
    const lines = buildClientContext(makeFullClientRecord(), {
      labels: { preferences: "Preferencje klienta" },
    });
    expect(lines).toContain("Preferencje klienta: Lubi kawe bez cukru");
  });

  it("omits birthday when the option is not enabled", () => {
    const lines = buildClientContext(makeFullClientRecord());
    expect(lines.some((l) => l.startsWith("Urodziny"))).toBe(false);
    expect(lines.join("\n")).not.toContain("15.03");
    expect(lines.join("\n")).not.toContain("03-15");
  });

  it("includes birthday as day and month only when the option is enabled", () => {
    const lines = buildClientContext(makeFullClientRecord(), {
      includeBirthday: true,
    });
    expect(lines).toContain("Urodziny: 15.03");
    expect(lines.join("\n")).not.toContain("1987");
  });

  it("uses a custom birthday label", () => {
    const lines = buildClientContext(makeFullClientRecord(), {
      includeBirthday: true,
      labels: { birthday: "Data urodzin" },
    });
    expect(lines).toContain("Data urodzin: 15.03");
  });

  it("omits birthday that cannot be parsed, never echoing the raw value", () => {
    for (const birthday of ["15 marca 1987", "1987-13-40", "abc", "1987"]) {
      const lines = buildClientContext(
        { preferences: null, birthday },
        { includeBirthday: true },
      );
      expect(lines).toEqual([CLIENT_LABEL]);
    }
  });

  it("accepts a full ISO timestamp birthday and keeps only day and month", () => {
    const lines = buildClientContext(
      { birthday: "1990-12-01T00:00:00.000Z" },
      { includeBirthday: true },
    );
    expect(lines).toContain("Urodziny: 01.12");
    expect(lines.join("\n")).not.toContain("1990");
  });

  it("handles null and empty fields", () => {
    expect(buildClientContext({ preferences: null, birthday: null }, { includeBirthday: true }))
      .toEqual([CLIENT_LABEL]);
    expect(buildClientContext({ preferences: "", birthday: "" }, { includeBirthday: true }))
      .toEqual([CLIENT_LABEL]);
    expect(buildClientContext({ preferences: "   \n\t ", birthday: "  " }, { includeBirthday: true }))
      .toEqual([CLIENT_LABEL]);
    expect(buildClientContext({}, { includeBirthday: true })).toEqual([CLIENT_LABEL]);
  });

  it("returns no lines when there is no client", () => {
    expect(buildClientContext(null)).toEqual([]);
    expect(buildClientContext(undefined, { includeBirthday: true })).toEqual([]);
  });

  it("keeps special characters in preferences", () => {
    const prefs = 'Kawa "czarna" & herbata <zielona> — 100% \\ ${x} zażółć';
    const lines = buildClientContext({ preferences: prefs });
    expect(lines).toContain(`Preferencje: ${prefs}`);
  });

  it("collapses newlines in preferences so the value stays on one line", () => {
    const lines = buildClientContext({
      preferences: "Lubi cisze\nAlergie: lateks\r\n  Pracownik: ktos",
    });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("Preferencje: Lubi cisze Alergie: lateks Pracownik: ktos");
    for (const line of lines) {
      expect(line).not.toMatch(/[\r\n]/);
    }
  });
});
