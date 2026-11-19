import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import {
  cancelDialogAccessText,
  cancelDialogRepurchaseText,
  cancelSuccessDescription,
  canceledNoticeText,
  formatDate,
  pastDueNoticeText,
  periodEndLabel,
  planFeaturesHeading,
  purchaseBlockedText,
  type AccessData,
} from "@/app/dashboard/subscription/_types";

// formatDate formats in the process time zone; the expected texts are written for Europe/Warsaw.
beforeAll(() => {
  vi.stubEnv("TZ", "Europe/Warsaw");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

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
const NEW_PURCHASE_AFTER_TEXT = "Nowy zakup bedzie mozliwy po tym terminie.";

function access(overrides: Partial<AccessData>): AccessData {
  return { state: "canceled", mode: "full", planSlug: "pro", until: UNTIL, ...overrides };
}

function accessUntilText(until: string): string {
  return `Dostep do funkcji planu jest aktywny do ${formatDate(until)}.`;
}

describe("canceledNoticeText", () => {
  it("with cancel date and full canceled access returns cancel date, access end date and reactivation text", () => {
    expect(canceledNoticeText(CANCELED_AT, access({}), null)).toBe(
      `Anulowano: ${formatDate(CANCELED_AT)}. ${accessUntilText(UNTIL)} ${REACTIVATE_TEXT}`,
    );
  });

  it("without cancel date and with full canceled access returns generic cancel text, access end date and reactivation text", () => {
    expect(canceledNoticeText(null, access({}), null)).toBe(
      `Twoja subskrypcja zostala anulowana. ${accessUntilText(UNTIL)} ${REACTIVATE_TEXT}`,
    );
  });

  it("with cancel date and null access returns cancel date and reactivation text without an access sentence", () => {
    expect(canceledNoticeText(CANCELED_AT, null, null)).toBe(
      `Anulowano: ${formatDate(CANCELED_AT)}. ${REACTIVATE_TEXT}`,
    );
  });

  it("without cancel date and null access returns generic cancel text and reactivation text without an access sentence", () => {
    expect(canceledNoticeText(null, null, null)).toBe(
      `Twoja subskrypcja zostala anulowana. ${REACTIVATE_TEXT}`,
    );
  });

  it("read_only access returns the text without an access sentence", () => {
    expect(
      canceledNoticeText(CANCELED_AT, access({ mode: "read_only", planSlug: null, until: null }), null),
    ).toBe(`Anulowano: ${formatDate(CANCELED_AT)}. ${REACTIVATE_TEXT}`);
  });

  it("read_only access with a non-null until returns the text without an access sentence", () => {
    expect(canceledNoticeText(CANCELED_AT, access({ mode: "read_only" }), null)).toBe(
      `Anulowano: ${formatDate(CANCELED_AT)}. ${REACTIVATE_TEXT}`,
    );
  });

  it("full canceled access with null until returns the text without an access sentence", () => {
    expect(canceledNoticeText(CANCELED_AT, access({ until: null }), null)).toBe(
      `Anulowano: ${formatDate(CANCELED_AT)}. ${REACTIVATE_TEXT}`,
    );
  });

  it("full access in a state other than canceled returns the text without an access sentence", () => {
    expect(canceledNoticeText(CANCELED_AT, access({ state: "active" }), null)).toBe(
      `Anulowano: ${formatDate(CANCELED_AT)}. ${REACTIVATE_TEXT}`,
    );
  });

  it("with a blocked purchase ends with the new purchase text instead of the reactivation text", () => {
    expect(canceledNoticeText(CANCELED_AT, access({}), UNTIL)).toBe(
      `Anulowano: 10 listopada 2026. Dostep do funkcji planu jest aktywny do 19 grudnia 2026. ${NEW_PURCHASE_AFTER_TEXT}`,
    );
  });

  it("without cancel date and with a blocked purchase ends with the new purchase text", () => {
    expect(canceledNoticeText(null, access({}), UNTIL)).toBe(
      `Twoja subskrypcja zostala anulowana. Dostep do funkcji planu jest aktywny do 19 grudnia 2026. ${NEW_PURCHASE_AFTER_TEXT}`,
    );
  });

  it("empty blocked date ends with the reactivation text", () => {
    expect(canceledNoticeText(CANCELED_AT, access({}), "")).toBe(
      `Anulowano: 10 listopada 2026. Dostep do funkcji planu jest aktywny do 19 grudnia 2026. ${REACTIVATE_TEXT}`,
    );
  });
});

const PAST_DUE_TEXT = "Ostatnia platnosc nie powiodla sie.";
const CONTACT_SUPPORT_TEXT = "W sprawie zaleglej platnosci skontaktuj sie z obsluga.";

function pastDueAccess(overrides: Partial<AccessData>): AccessData {
  return access({ state: "past_due", ...overrides });
}

describe("pastDueNoticeText", () => {
  it("full past_due access with until returns the failed payment text, access end date and support text", () => {
    expect(pastDueNoticeText(pastDueAccess({}), null)).toBe(
      `${PAST_DUE_TEXT} ${accessUntilText(UNTIL)} ${CONTACT_SUPPORT_TEXT}`,
    );
  });

  it("null access returns the failed payment text and support text", () => {
    expect(pastDueNoticeText(null, null)).toBe(`${PAST_DUE_TEXT} ${CONTACT_SUPPORT_TEXT}`);
  });

  it("read_only past_due access returns the failed payment text and support text", () => {
    expect(
      pastDueNoticeText(pastDueAccess({ mode: "read_only", planSlug: null, until: null }), null),
    ).toBe(`${PAST_DUE_TEXT} ${CONTACT_SUPPORT_TEXT}`);
  });

  it("read_only past_due access with a non-null until returns the failed payment text and support text", () => {
    expect(pastDueNoticeText(pastDueAccess({ mode: "read_only" }), null)).toBe(
      `${PAST_DUE_TEXT} ${CONTACT_SUPPORT_TEXT}`,
    );
  });

  it("full past_due access with null until returns the failed payment text and support text", () => {
    expect(pastDueNoticeText(pastDueAccess({ until: null }), null)).toBe(
      `${PAST_DUE_TEXT} ${CONTACT_SUPPORT_TEXT}`,
    );
  });

  it("full access in a state other than past_due returns the failed payment text and support text", () => {
    expect(pastDueNoticeText(pastDueAccess({ state: "canceled" }), null)).toBe(
      `${PAST_DUE_TEXT} ${CONTACT_SUPPORT_TEXT}`,
    );
  });

  it("with a blocked purchase adds the new purchase text before the support text", () => {
    expect(pastDueNoticeText(pastDueAccess({}), UNTIL)).toBe(
      `${PAST_DUE_TEXT} Dostep do funkcji planu jest aktywny do 19 grudnia 2026. ${NEW_PURCHASE_AFTER_TEXT} ${CONTACT_SUPPORT_TEXT}`,
    );
  });

  it("empty blocked date returns the text without the new purchase text", () => {
    expect(pastDueNoticeText(pastDueAccess({}), "")).toBe(
      `${PAST_DUE_TEXT} Dostep do funkcji planu jest aktywny do 19 grudnia 2026. ${CONTACT_SUPPORT_TEXT}`,
    );
  });
});

const REAL_ID = "sub_1Real";
const SIM_ID = "sim_sub_1";

describe("purchaseBlockedText", () => {
  it("returns the new purchase text with the formatted date", () => {
    expect(purchaseBlockedText(UNTIL)).toBe("Nowy zakup bedzie mozliwy po 19 grudnia 2026.");
  });
});

const DIALOG_ACCESS_TEXT =
  "Zachowasz dostep do wszystkich funkcji planu Pro do konca biezacego okresu rozliczeniowego (19 grudnia 2026). Po tym terminie subskrypcja nie zostanie odnowiona.";

describe("cancelDialogAccessText", () => {
  it("period end in the future returns the access text with the plan name and end date", () => {
    expect(cancelDialogAccessText("Pro", UNTIL, NOW)).toBe(DIALOG_ACCESS_TEXT);
  });

  it("period end in the past returns only the not renewed text", () => {
    expect(cancelDialogAccessText("Pro", "2026-10-19T12:00:00.000Z", NOW)).toBe(NOT_RENEWED_TEXT);
  });

  it("period end equal to now returns only the not renewed text", () => {
    expect(cancelDialogAccessText("Pro", NOW.toISOString(), NOW)).toBe(NOT_RENEWED_TEXT);
  });

  it("null period end returns only the not renewed text", () => {
    expect(cancelDialogAccessText("Pro", null, NOW)).toBe(NOT_RENEWED_TEXT);
  });

  it("empty period end returns only the not renewed text", () => {
    expect(cancelDialogAccessText("Pro", "", NOW)).toBe(NOT_RENEWED_TEXT);
  });

  it("invalid date period end returns only the not renewed text", () => {
    expect(cancelDialogAccessText("Pro", "not-a-date", NOW)).toBe(NOT_RENEWED_TEXT);
  });
});

const DIALOG_REACTIVATE_TEXT = "Mozesz ponownie aktywowac subskrypcje w dowolnym momencie.";

describe("cancelDialogRepurchaseText", () => {
  it.each<[string, string | null, string | null, string]>([
    ["real Stripe id, period end in the future", REAL_ID, UNTIL, NEW_PURCHASE_AFTER_TEXT],
    ["real Stripe id, period end in the past", REAL_ID, "2026-10-19T12:00:00.000Z", DIALOG_REACTIVATE_TEXT],
    ["real Stripe id, period end equal to now", REAL_ID, NOW.toISOString(), DIALOG_REACTIVATE_TEXT],
    ["real Stripe id, null period end", REAL_ID, null, DIALOG_REACTIVATE_TEXT],
    ["real Stripe id, invalid period end", REAL_ID, "not-a-date", DIALOG_REACTIVATE_TEXT],
    ["null Stripe id, period end in the future", null, UNTIL, DIALOG_REACTIVATE_TEXT],
    ["null Stripe id, period end in the past", null, "2026-10-19T12:00:00.000Z", DIALOG_REACTIVATE_TEXT],
    ["null Stripe id, null period end", null, null, DIALOG_REACTIVATE_TEXT],
    ["sim_ Stripe id, period end in the future", SIM_ID, UNTIL, DIALOG_REACTIVATE_TEXT],
    ["sim_ Stripe id, period end in the past", SIM_ID, "2026-10-19T12:00:00.000Z", DIALOG_REACTIVATE_TEXT],
    ["sim_ Stripe id, null period end", SIM_ID, null, DIALOG_REACTIVATE_TEXT],
  ])("%s", (_name, stripeSubscriptionId, periodEnd, expected) => {
    expect(cancelDialogRepurchaseText(stripeSubscriptionId, periodEnd, NOW)).toBe(expected);
  });
});

describe("planFeaturesHeading", () => {
  it("read_only access names the plan of the row", () => {
    expect(planFeaturesHeading("Pro", access({ mode: "read_only", planSlug: null, until: null }))).toBe(
      "Funkcje planu Pro",
    );
  });

  it("full access returns the current plan heading", () => {
    expect(planFeaturesHeading("Pro", access({}))).toBe("Funkcje w Twoim planie");
  });

  it("null access returns the current plan heading", () => {
    expect(planFeaturesHeading("Pro", null)).toBe("Funkcje w Twoim planie");
  });
});
