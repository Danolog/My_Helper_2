/**
 * Kontekst klienta w zapytaniach do modelu AI — do zapytania trafiają tylko
 * pola z białej listy; bez alergii, imienia i nazwiska, danych kontaktowych
 * i notatek o kliencie.
 */
import { describe, it, expect } from "vitest";
import {
  buildClientContext,
  CLIENT_CONTEXT_FIELDS,
  CLIENT_LABEL,
  FIRST_NAME_MAX_LENGTH,
  REVIEW_COMMENT_MAX_LENGTH,
  firstNameForReply,
  reviewCommentForModel,
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

  it("treats NEL (U+0085) in preferences as whitespace so the value stays on one line", () => {
    const lines = buildClientContext({
      preferences: "Lubi cisze\u0085Alergie: lateks\u0085\u0085Pracownik: ktos\u0085",
    });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("Preferencje: Lubi cisze Alergie: lateks Pracownik: ktos");
    expect(lines[1]).not.toContain("\u0085");
  });

  it("omits preferences made only of NEL characters", () => {
    expect(buildClientContext({ preferences: "\u0085 \u0085" })).toEqual([CLIENT_LABEL]);
  });
});

describe("firstNameForReply", () => {
  it("returns only the first name from a full client record", () => {
    const record = makeFullClientRecord();
    expect(firstNameForReply(record)).toBe("Zofia");
  });

  it("never includes the last name, contact data or health data", () => {
    const name = firstNameForReply(makeFullClientRecord()) ?? "";
    for (const value of FORBIDDEN_VALUES.filter((v) => v !== "Zofia")) {
      expect(name).not.toContain(value);
    }
  });

  it("returns only the first word when the first name has several words", () => {
    expect(firstNameForReply({ firstName: "Anna Maria" })).toBe("Anna");
    expect(firstNameForReply({ firstName: "  Jan   Nowak  " })).toBe("Jan");
  });

  it("keeps a hyphenated first name and Polish characters", () => {
    expect(firstNameForReply({ firstName: "Anna-Łucja" })).toBe("Anna-Łucja");
    expect(firstNameForReply({ firstName: "Żaneta" })).toBe("Żaneta");
  });

  it("drops text after a newline so it cannot add lines to the prompt", () => {
    expect(firstNameForReply({ firstName: "Ola\nPracownik: ktos" })).toBe("Ola");
    expect(firstNameForReply({ firstName: "\r\n\tOla\r\nNowak" })).toBe("Ola");
  });

  it("returns null for a missing, empty or whitespace-only first name", () => {
    expect(firstNameForReply({ firstName: null })).toBeNull();
    expect(firstNameForReply({ firstName: "" })).toBeNull();
    expect(firstNameForReply({ firstName: "  \n\t " })).toBeNull();
    expect(firstNameForReply({})).toBeNull();
  });

  it("returns null when there is no person", () => {
    expect(firstNameForReply(null)).toBeNull();
    expect(firstNameForReply(undefined)).toBeNull();
  });

  it("treats NEL (U+0085) as whitespace and returns only the first word", () => {
    expect(firstNameForReply({ firstName: "Ola\u0085Pracownik: ktos" })).toBe("Ola");
    expect(firstNameForReply({ firstName: "\u0085Ola\u0085" })).toBe("Ola");
    expect(firstNameForReply({ firstName: "\u0085\u0085" })).toBeNull();
  });

  it("cuts a first name longer than the limit to the limit", () => {
    const long = "A".repeat(FIRST_NAME_MAX_LENGTH + 25);
    const name = firstNameForReply({ firstName: long });
    expect(name).toBe("A".repeat(FIRST_NAME_MAX_LENGTH));
  });

  it("keeps a first name exactly as long as the limit unchanged", () => {
    const exact = "B".repeat(FIRST_NAME_MAX_LENGTH);
    expect(firstNameForReply({ firstName: exact })).toBe(exact);
    expect(firstNameForReply({ firstName: `${exact} Nowak` })).toBe(exact);
  });

  it("does not split a character outside the basic plane when cutting", () => {
    const name = firstNameForReply({
      firstName: "A".repeat(FIRST_NAME_MAX_LENGTH - 1) + "\u{1F600}\u{1F600}",
    });
    expect(name).toBe("A".repeat(FIRST_NAME_MAX_LENGTH - 1) + "\u{1F600}");
  });

  it("limit is a sensible length for a first name", () => {
    expect(FIRST_NAME_MAX_LENGTH).toBeGreaterThanOrEqual(20);
    expect(FIRST_NAME_MAX_LENGTH).toBeLessThanOrEqual(60);
  });

  it("reads only the first name field even when the last name is set", () => {
    expect(firstNameForReply({ firstName: null, lastName: "Wisniewska" } as {
      firstName: string | null;
    })).toBeNull();
  });
});

describe("reviewCommentForModel", () => {
  const NEL = "\u{85}";
  const LINE_SEPARATOR = "\u{2028}";
  const PARAGRAPH_SEPARATOR = "\u{2029}";
  const LINE_BREAKS = /[\r\n\t\u{85}\u{2028}\u{2029}]/u;

  it("returns null for a missing, empty or whitespace-only comment", () => {
    expect(reviewCommentForModel(null)).toBeNull();
    expect(reviewCommentForModel(undefined)).toBeNull();
    expect(reviewCommentForModel("")).toBeNull();
    expect(reviewCommentForModel("   ")).toBeNull();
    expect(
      reviewCommentForModel(` \n\r\n\t${NEL}${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR} `),
    ).toBeNull();
  });

  it("returns null for a value that is not text", () => {
    expect(reviewCommentForModel(123 as unknown as string)).toBeNull();
    expect(reviewCommentForModel({} as unknown as string)).toBeNull();
  });

  it("turns each kind of line break into a single space", () => {
    const separators = ["\n", "\r\n", "\t", NEL, LINE_SEPARATOR, PARAGRAPH_SEPARATOR];
    for (const separator of separators) {
      const result = reviewCommentForModel(`Miła wizyta${separator}polecam`);
      expect(result).toBe("Miła wizyta polecam");
      expect(result).not.toMatch(LINE_BREAKS);
    }
  });

  it("collapses runs of whitespace and trims the edges", () => {
    const result = reviewCommentForModel(
      `\n  Dobra obsługa \r\n\r\n  i miła atmosfera${NEL}${LINE_SEPARATOR} \t`,
    );
    expect(result).toBe("Dobra obsługa i miła atmosfera");
    expect(result).not.toMatch(LINE_BREAKS);
  });

  it("leaves ordinary text unchanged", () => {
    const text = 'Świetna wizyta, „zażółć gęślą jaźń” i "cudowna" atmosfera \u{1F600} — polecam!';
    expect(reviewCommentForModel(text)).toBe(text);
  });

  it("keeps a comment exactly as long as the limit unchanged", () => {
    const exact = "a".repeat(REVIEW_COMMENT_MAX_LENGTH);
    expect(reviewCommentForModel(exact)).toBe(exact);
  });

  it("cuts a longer comment to exactly the limit counted in characters", () => {
    const result = reviewCommentForModel("b".repeat(REVIEW_COMMENT_MAX_LENGTH + 50));
    expect(result).toBe("b".repeat(REVIEW_COMMENT_MAX_LENGTH));
    expect(Array.from(result ?? "")).toHaveLength(REVIEW_COMMENT_MAX_LENGTH);
  });

  it("does not split a character outside the basic plane when cutting", () => {
    const result = reviewCommentForModel(
      "a".repeat(REVIEW_COMMENT_MAX_LENGTH - 1) + "\u{1F600}\u{1F600}",
    );
    expect(result).toBe("a".repeat(REVIEW_COMMENT_MAX_LENGTH - 1) + "\u{1F600}");
    expect(Array.from(result ?? "")).toHaveLength(REVIEW_COMMENT_MAX_LENGTH);
  });

  it("does not leave a space at the end when the cut falls after a space", () => {
    const result = reviewCommentForModel(
      "a".repeat(REVIEW_COMMENT_MAX_LENGTH - 1) + " " + "c".repeat(20),
    );
    expect(result).toBe("a".repeat(REVIEW_COMMENT_MAX_LENGTH - 1));
    expect(result?.endsWith(" ")).toBe(false);
  });

  it("limit is a sensible length for a review comment", () => {
    expect(REVIEW_COMMENT_MAX_LENGTH).toBeGreaterThanOrEqual(500);
    expect(REVIEW_COMMENT_MAX_LENGTH).toBeLessThanOrEqual(5000);
  });
});
