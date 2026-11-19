import { describe, it, expect } from "vitest";
import {
  cancelSuccessDescription,
  canceledNoticeText,
  formatDate,
  pastDueNoticeText,
  periodEndLabel,
  type AccessData,
} from "@/app/dashboard/subscription/_types";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const NOT_RENEWED_TEXT = "Subskrypcja nie zostanie odnowiona.";

function activeText(periodEnd: string): string {
  return `Dostep do planu jest aktywny do ${formatDate(periodEnd)}. Subskrypcja nie zostanie odnowiona.`;
}

describe("cancelSuccessDescription", () => {
  it("period end in the future returns the text with the formatted end date", () => {
    const periodEnd = "2026-12-19T12:00:00.000Z";
    expect(cancelSuccessDescription(periodEnd, NOW)).toBe(
      activeText(periodEnd),
    );
  });

  it("period end one millisecond after now returns the text with the formatted end date", () => {
    const periodEnd = new Date(NOW.getTime() + 1).toISOString();
    expect(cancelSuccessDescription(periodEnd, NOW)).toBe(
      activeText(periodEnd),
    );
  });

  it("period end equal to now returns the text without an access date", () => {
    expect(cancelSuccessDescription(NOW.toISOString(), NOW)).toBe(NOT_RENEWED_TEXT);
  });

  it("period end in the past returns the text without an access date", () => {
    expect(
      cancelSuccessDescription("2026-10-19T12:00:00.000Z", NOW),
    ).toBe(NOT_RENEWED_TEXT);
  });

  it("null period end returns the text without an access date", () => {
    expect(cancelSuccessDescription(null, NOW)).toBe(NOT_RENEWED_TEXT);
  });

  it("undefined period end returns the text without an access date", () => {
    expect(cancelSuccessDescription(undefined, NOW)).toBe(NOT_RENEWED_TEXT);
  });

  it("empty string period end returns the text without an access date", () => {
    expect(cancelSuccessDescription("", NOW)).toBe(NOT_RENEWED_TEXT);
  });

  it("invalid date period end returns the text without an access date", () => {
    expect(cancelSuccessDescription("not-a-date", NOW)).toBe(NOT_RENEWED_TEXT);
  });
});

describe("periodEndLabel", () => {
  it("trialing returns the trial end label", () => {
    expect(periodEndLabel("trialing")).toBe("Koniec okresu probnego");
  });

  it("active returns the next payment label", () => {
    expect(periodEndLabel("active")).toBe("Nastepna platnosc");
  });

  it("canceled returns the period end label", () => {
    expect(periodEndLabel("canceled")).toBe("Koniec okresu");
  });

  it("past_due returns the period end label", () => {
    expect(periodEndLabel("past_due")).toBe("Koniec okresu");
  });

  it("unknown status returns the next payment label", () => {
    expect(periodEndLabel("incomplete")).toBe("Nastepna platnosc");
  });
});

const UNTIL = "2026-12-19T12:00:00.000Z";
const CANCELED_AT = "2026-11-10T12:00:00.000Z";
const REACTIVATE_TEXT = "Mozesz w kazdej chwili ponownie aktywowac plan.";

function access(overrides: Partial<AccessData>): AccessData {
  return { state: "canceled", mode: "full", planSlug: "pro", until: UNTIL, ...overrides };
}

function accessUntilText(until: string): string {
  return `Dostep do funkcji planu jest aktywny do ${formatDate(until)}.`;
}

describe("canceledNoticeText", () => {
  it("with cancel date and full canceled access returns cancel date, access end date and reactivation text", () => {
    expect(canceledNoticeText(CANCELED_AT, access({}))).toBe(
      `Anulowano: ${formatDate(CANCELED_AT)}. ${accessUntilText(UNTIL)} ${REACTIVATE_TEXT}`,
    );
  });

  it("without cancel date and with full canceled access returns generic cancel text, access end date and reactivation text", () => {
    expect(canceledNoticeText(null, access({}))).toBe(
      `Twoja subskrypcja zostala anulowana. ${accessUntilText(UNTIL)} ${REACTIVATE_TEXT}`,
    );
  });

  it("with cancel date and null access returns cancel date and reactivation text without an access sentence", () => {
    expect(canceledNoticeText(CANCELED_AT, null)).toBe(
      `Anulowano: ${formatDate(CANCELED_AT)}. ${REACTIVATE_TEXT}`,
    );
  });

  it("without cancel date and null access returns generic cancel text and reactivation text without an access sentence", () => {
    expect(canceledNoticeText(null, null)).toBe(
      `Twoja subskrypcja zostala anulowana. ${REACTIVATE_TEXT}`,
    );
  });

  it("read_only access returns the text without an access sentence", () => {
    expect(
      canceledNoticeText(CANCELED_AT, access({ mode: "read_only", planSlug: null, until: null })),
    ).toBe(`Anulowano: ${formatDate(CANCELED_AT)}. ${REACTIVATE_TEXT}`);
  });

  it("read_only access with a non-null until returns the text without an access sentence", () => {
    expect(canceledNoticeText(CANCELED_AT, access({ mode: "read_only" }))).toBe(
      `Anulowano: ${formatDate(CANCELED_AT)}. ${REACTIVATE_TEXT}`,
    );
  });

  it("full canceled access with null until returns the text without an access sentence", () => {
    expect(canceledNoticeText(CANCELED_AT, access({ until: null }))).toBe(
      `Anulowano: ${formatDate(CANCELED_AT)}. ${REACTIVATE_TEXT}`,
    );
  });

  it("full access in a state other than canceled returns the text without an access sentence", () => {
    expect(canceledNoticeText(CANCELED_AT, access({ state: "active" }))).toBe(
      `Anulowano: ${formatDate(CANCELED_AT)}. ${REACTIVATE_TEXT}`,
    );
  });
});

const PAST_DUE_TEXT = "Ostatnia platnosc nie powiodla sie.";

function pastDueAccess(overrides: Partial<AccessData>): AccessData {
  return access({ state: "past_due", ...overrides });
}

describe("pastDueNoticeText", () => {
  it("full past_due access with until returns the failed payment text and access end date", () => {
    expect(pastDueNoticeText(pastDueAccess({}))).toBe(
      `${PAST_DUE_TEXT} ${accessUntilText(UNTIL)}`,
    );
  });

  it("null access returns only the failed payment text", () => {
    expect(pastDueNoticeText(null)).toBe(PAST_DUE_TEXT);
  });

  it("read_only past_due access returns only the failed payment text", () => {
    expect(
      pastDueNoticeText(pastDueAccess({ mode: "read_only", planSlug: null, until: null })),
    ).toBe(PAST_DUE_TEXT);
  });

  it("read_only past_due access with a non-null until returns only the failed payment text", () => {
    expect(pastDueNoticeText(pastDueAccess({ mode: "read_only" }))).toBe(PAST_DUE_TEXT);
  });

  it("full past_due access with null until returns only the failed payment text", () => {
    expect(pastDueNoticeText(pastDueAccess({ until: null }))).toBe(PAST_DUE_TEXT);
  });

  it("full access in a state other than past_due returns only the failed payment text", () => {
    expect(pastDueNoticeText(pastDueAccess({ state: "canceled" }))).toBe(PAST_DUE_TEXT);
  });
});
