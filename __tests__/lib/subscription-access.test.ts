/**
 * Stan dostępu salonu liczony z wierszy subskrypcji (`resolveSalonAccess`).
 *
 * Czysta funkcja bez atrap: wejście to wszystkie wiersze salonu w dowolnej
 * kolejności i chwila odczytu. Granice terminów są wyłączne i liczone
 * w milisekundach.
 */
import { describe, expect, it } from "vitest";
import {
  PAST_DUE_GRACE_DAYS,
  SALON_ACCESS_UNAVAILABLE,
  resolveSalonAccess,
  type SalonSubscriptionAccessRow,
} from "@/lib/subscription-predicates";

const NOW = new Date("2026-11-15T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const GRACE = 7 * DAY;

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

function row(
  status: string,
  dates: {
    trialEndsAt?: Date | null;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    createdAt?: Date;
  } = {},
  planSlug = "pro"
): SalonSubscriptionAccessRow {
  return {
    status,
    planSlug,
    trialEndsAt: dates.trialEndsAt ?? null,
    currentPeriodStart: dates.currentPeriodStart ?? null,
    currentPeriodEnd: dates.currentPeriodEnd ?? null,
    createdAt: dates.createdAt ?? at(-60 * DAY),
  };
}

describe("resolveSalonAccess — stałe", () => {
  it("łaska po nieudanej płatności trwa 7 dni", () => {
    expect(PAST_DUE_GRACE_DAYS).toBe(7);
  });

  it("dostęp niedostępny: unavailable, tylko do odczytu, bez planu i terminu", () => {
    expect(SALON_ACCESS_UNAVAILABLE).toEqual({ state: "unavailable", mode: "read_only", planSlug: null, until: null });
  });
});

describe("resolveSalonAccess — brak wierszy", () => {
  it("brak wierszy -> none, tylko do odczytu", () => {
    expect(resolveSalonAccess([], NOW)).toEqual({ state: "none", mode: "read_only", planSlug: null, until: null });
  });
});

describe("resolveSalonAccess — trialing", () => {
  it("trialEndsAt w przyszłości -> trialing, pełny dostęp do trialEndsAt", () => {
    const end = at(3 * DAY);
    expect(resolveSalonAccess([row("trialing", { trialEndsAt: end })], NOW)).toEqual({
      state: "trialing",
      mode: "full",
      planSlug: "pro",
      until: end,
    });
  });

  it("trialEndsAt w przeszłości -> expired, tylko do odczytu", () => {
    expect(resolveSalonAccess([row("trialing", { trialEndsAt: at(-DAY) })], NOW)).toEqual({
      state: "expired",
      mode: "read_only",
      planSlug: null,
      until: null,
    });
  });

  it("brak trialEndsAt -> expired, tylko do odczytu", () => {
    expect(resolveSalonAccess([row("trialing", { trialEndsAt: null, currentPeriodEnd: at(DAY) })], NOW)).toEqual({
      state: "expired",
      mode: "read_only",
      planSlug: null,
      until: null,
    });
  });

  it("granica: trialEndsAt == teraz -> expired", () => {
    expect(resolveSalonAccess([row("trialing", { trialEndsAt: at(0) })], NOW)).toMatchObject({
      state: "expired",
      mode: "read_only",
    });
  });

  it("granica: trialEndsAt == teraz + 1 ms -> trialing", () => {
    expect(resolveSalonAccess([row("trialing", { trialEndsAt: at(1) })], NOW)).toMatchObject({
      state: "trialing",
      mode: "full",
    });
  });

  it("granica: trialEndsAt == teraz - 1 ms -> expired", () => {
    expect(resolveSalonAccess([row("trialing", { trialEndsAt: at(-1) })], NOW)).toMatchObject({
      state: "expired",
      mode: "read_only",
    });
  });
});

describe("resolveSalonAccess — active", () => {
  it("active z okresem w przyszłości -> pełny dostęp do currentPeriodEnd", () => {
    const end = at(20 * DAY);
    expect(resolveSalonAccess([row("active", { currentPeriodEnd: end })], NOW)).toEqual({
      state: "active",
      mode: "full",
      planSlug: "pro",
      until: end,
    });
  });

  it("active bez currentPeriodEnd -> pełny dostęp, until null", () => {
    expect(resolveSalonAccess([row("active", { currentPeriodEnd: null }, "basic")], NOW)).toEqual({
      state: "active",
      mode: "full",
      planSlug: "basic",
      until: null,
    });
  });

  it("active z datami w przeszłości -> nadal pełny dostęp", () => {
    const end = at(-10 * DAY);
    expect(
      resolveSalonAccess([row("active", { currentPeriodEnd: end, trialEndsAt: at(-30 * DAY) })], NOW)
    ).toEqual({ state: "active", mode: "full", planSlug: "pro", until: end });
  });
});

describe("resolveSalonAccess — past_due (łaska 7 dni od currentPeriodEnd)", () => {
  const READ_ONLY = { state: "past_due", mode: "read_only", planSlug: null, until: null };

  it("currentPeriodEnd w przyszłości -> past_due, pełny dostęp do currentPeriodEnd + 7 dni", () => {
    const end = at(20 * DAY);
    expect(
      resolveSalonAccess([row("past_due", { currentPeriodStart: at(-10 * DAY), currentPeriodEnd: end })], NOW)
    ).toEqual({
      state: "past_due",
      mode: "full",
      planSlug: "pro",
      until: new Date(end.getTime() + GRACE),
    });
  });

  it("currentPeriodEnd 3 dni temu -> past_due, pełny dostęp do currentPeriodEnd + 7 dni", () => {
    const end = at(-3 * DAY);
    expect(
      resolveSalonAccess([row("past_due", { currentPeriodStart: at(-33 * DAY), currentPeriodEnd: end }, "basic")], NOW)
    ).toEqual({
      state: "past_due",
      mode: "full",
      planSlug: "basic",
      until: new Date(end.getTime() + GRACE),
    });
  });

  it("currentPeriodEnd 8 dni temu -> past_due, tylko do odczytu", () => {
    expect(
      resolveSalonAccess([row("past_due", { currentPeriodStart: at(-38 * DAY), currentPeriodEnd: at(-8 * DAY) })], NOW)
    ).toEqual(READ_ONLY);
  });

  it("bez currentPeriodEnd, z currentPeriodStart wczoraj -> past_due, tylko do odczytu", () => {
    expect(
      resolveSalonAccess([row("past_due", { currentPeriodStart: at(-DAY), currentPeriodEnd: null })], NOW)
    ).toEqual(READ_ONLY);
  });

  it("bez currentPeriodStart i bez currentPeriodEnd -> past_due, tylko do odczytu", () => {
    expect(resolveSalonAccess([row("past_due", { currentPeriodStart: null, currentPeriodEnd: null })], NOW)).toEqual(
      READ_ONLY
    );
  });

  it("granica: teraz == currentPeriodEnd + 7 dni -> tylko do odczytu", () => {
    expect(resolveSalonAccess([row("past_due", { currentPeriodEnd: at(-GRACE) })], NOW)).toEqual(READ_ONLY);
  });

  it("granica: teraz == currentPeriodEnd + 7 dni - 1 ms -> pełny dostęp do currentPeriodEnd + 7 dni", () => {
    const end = at(-GRACE + 1);
    expect(resolveSalonAccess([row("past_due", { currentPeriodEnd: end })], NOW)).toEqual({
      state: "past_due",
      mode: "full",
      planSlug: "pro",
      until: new Date(end.getTime() + GRACE),
    });
  });

  it("granica: teraz == currentPeriodEnd + 7 dni + 1 ms -> tylko do odczytu", () => {
    expect(resolveSalonAccess([row("past_due", { currentPeriodEnd: at(-GRACE - 1) })], NOW)).toEqual(READ_ONLY);
  });

  it("currentPeriodStart bez wpływu: start 8 dni temu, currentPeriodEnd w przyszłości -> pełny dostęp", () => {
    const end = at(22 * DAY);
    expect(
      resolveSalonAccess([row("past_due", { currentPeriodStart: at(-8 * DAY), currentPeriodEnd: end })], NOW)
    ).toEqual({
      state: "past_due",
      mode: "full",
      planSlug: "pro",
      until: new Date(end.getTime() + GRACE),
    });
  });

  it("currentPeriodStart bez wpływu: start wczoraj, currentPeriodEnd 8 dni temu -> tylko do odczytu", () => {
    expect(
      resolveSalonAccess([row("past_due", { currentPeriodStart: at(-DAY), currentPeriodEnd: at(-8 * DAY) })], NOW)
    ).toEqual(READ_ONLY);
  });

  it("past_due z końcem okresu równym końcowi okresu próbnego 3 dni temu -> pełny dostęp do końca okresu + 7 dni", () => {
    const end = at(-3 * DAY);
    expect(
      resolveSalonAccess(
        [row("past_due", { trialEndsAt: end, currentPeriodStart: at(-17 * DAY), currentPeriodEnd: end })],
        NOW
      )
    ).toEqual({
      state: "past_due",
      mode: "full",
      planSlug: "pro",
      until: new Date(end.getTime() + GRACE),
    });
  });

  it("past_due z końcem okresu równym końcowi okresu próbnego 8 dni temu -> tylko do odczytu", () => {
    const end = at(-8 * DAY);
    expect(
      resolveSalonAccess(
        [row("past_due", { trialEndsAt: end, currentPeriodStart: at(-22 * DAY), currentPeriodEnd: end })],
        NOW
      )
    ).toEqual(READ_ONLY);
  });
});

describe("resolveSalonAccess — canceled (pełny dostęp do currentPeriodEnd)", () => {
  const READ_ONLY = { state: "canceled", mode: "read_only", planSlug: null, until: null };

  it("currentPeriodEnd w przyszłości -> canceled, pełny dostęp z planem wiersza do currentPeriodEnd", () => {
    const end = at(10 * DAY);
    expect(
      resolveSalonAccess([row("canceled", { currentPeriodStart: at(-20 * DAY), currentPeriodEnd: end })], NOW)
    ).toEqual({
      state: "canceled",
      mode: "full",
      planSlug: "pro",
      until: end,
    });
  });

  it("currentPeriodEnd w przeszłości -> canceled, tylko do odczytu", () => {
    expect(resolveSalonAccess([row("canceled", { currentPeriodEnd: at(-DAY) })], NOW)).toEqual(READ_ONLY);
  });

  it("bez dat okresu -> canceled, tylko do odczytu", () => {
    expect(resolveSalonAccess([row("canceled", { currentPeriodStart: null, currentPeriodEnd: null })], NOW)).toEqual(
      READ_ONLY
    );
  });

  it("granica: currentPeriodEnd == teraz -> tylko do odczytu", () => {
    expect(resolveSalonAccess([row("canceled", { currentPeriodEnd: at(0) })], NOW)).toEqual(READ_ONLY);
  });

  it("granica: currentPeriodEnd == teraz + 1 ms -> pełny dostęp do currentPeriodEnd", () => {
    const end = at(1);
    expect(resolveSalonAccess([row("canceled", { currentPeriodEnd: end }, "basic")], NOW)).toEqual({
      state: "canceled",
      mode: "full",
      planSlug: "basic",
      until: end,
    });
  });

  it("granica: currentPeriodEnd == teraz - 1 ms -> tylko do odczytu", () => {
    expect(resolveSalonAccess([row("canceled", { currentPeriodEnd: at(-1) })], NOW)).toEqual(READ_ONLY);
  });

  it("trialEndsAt w przyszłości bez currentPeriodEnd -> tylko do odczytu", () => {
    expect(resolveSalonAccess([row("canceled", { trialEndsAt: at(5 * DAY), currentPeriodEnd: null })], NOW)).toEqual(
      READ_ONLY
    );
  });

  it("bez currentPeriodStart, z currentPeriodEnd w przyszłości -> pełny dostęp do currentPeriodEnd", () => {
    const end = at(3 * DAY);
    expect(
      resolveSalonAccess([row("canceled", { currentPeriodStart: null, currentPeriodEnd: end })], NOW)
    ).toEqual({
      state: "canceled",
      mode: "full",
      planSlug: "pro",
      until: end,
    });
  });
});

describe("resolveSalonAccess — nieznany status", () => {
  it.each(["incomplete", "paused", "unpaid", ""])("status %j -> inactive, tylko do odczytu", (status) => {
    expect(
      resolveSalonAccess([row(status, { trialEndsAt: at(DAY), currentPeriodEnd: at(DAY) })], NOW)
    ).toEqual({ state: "inactive", mode: "read_only", planSlug: null, until: null });
  });
});

describe("resolveSalonAccess — wybór wiersza", () => {
  it("starszy active obok nowszego canceled -> active", () => {
    const current = row("active", { currentPeriodEnd: at(20 * DAY), createdAt: at(-90 * DAY) }, "basic");
    const newer = row("canceled", { currentPeriodEnd: at(-DAY), createdAt: at(-5 * DAY) });
    expect(resolveSalonAccess([current, newer], NOW)).toMatchObject({ state: "active", mode: "full", planSlug: "basic" });
    expect(resolveSalonAccess([newer, current], NOW)).toMatchObject({ state: "active", mode: "full", planSlug: "basic" });
  });

  it("starszy trialing po terminie obok nowszego canceled z currentPeriodEnd w przyszłości -> wiersz bieżący (expired)", () => {
    const current = row("trialing", { trialEndsAt: at(-DAY), createdAt: at(-30 * DAY) });
    const newer = row("canceled", { currentPeriodEnd: at(10 * DAY), createdAt: at(-2 * DAY) });
    expect(resolveSalonAccess([newer, current], NOW)).toMatchObject({ state: "expired", mode: "read_only" });
    expect(resolveSalonAccess([current, newer], NOW)).toMatchObject({ state: "expired", mode: "read_only" });
  });

  it("nowszy past_due w łasce obok starszego canceled w opłaconym okresie -> wynik z nowszego (past_due)", () => {
    const older = row("canceled", { currentPeriodEnd: at(10 * DAY), createdAt: at(-60 * DAY) });
    const end = at(-3 * DAY);
    const newer = row(
      "past_due",
      { currentPeriodStart: at(-33 * DAY), currentPeriodEnd: end, createdAt: at(-20 * DAY) },
      "basic"
    );
    const expected = { state: "past_due", mode: "full", planSlug: "basic", until: new Date(end.getTime() + GRACE) };
    expect(resolveSalonAccess([older, newer], NOW)).toEqual(expected);
    expect(resolveSalonAccess([newer, older], NOW)).toEqual(expected);
  });

  it("nowszy canceled w opłaconym okresie obok starszego past_due w łasce -> wynik z nowszego (canceled, pełny dostęp)", () => {
    const older = row(
      "past_due",
      { currentPeriodStart: at(-33 * DAY), currentPeriodEnd: at(-3 * DAY), createdAt: at(-60 * DAY) },
      "basic"
    );
    const end = at(10 * DAY);
    const newer = row("canceled", { currentPeriodEnd: end, createdAt: at(-20 * DAY) });
    const expected = { state: "canceled", mode: "full", planSlug: "pro", until: end };
    expect(resolveSalonAccess([older, newer], NOW)).toEqual(expected);
    expect(resolveSalonAccess([newer, older], NOW)).toEqual(expected);
  });

  it("nowszy canceled po końcu okresu obok starszego past_due w łasce -> wynik z nowszego (tylko do odczytu)", () => {
    const older = row(
      "past_due",
      { currentPeriodStart: at(-33 * DAY), currentPeriodEnd: at(-3 * DAY), createdAt: at(-60 * DAY) },
      "basic"
    );
    const newer = row("canceled", { currentPeriodEnd: at(-DAY), createdAt: at(-20 * DAY) });
    const expected = { state: "canceled", mode: "read_only", planSlug: null, until: null };
    expect(resolveSalonAccess([older, newer], NOW)).toEqual(expected);
    expect(resolveSalonAccess([newer, older], NOW)).toEqual(expected);
  });

  it("trzy wiersze w dowolnej kolejności -> wiersz bieżący", () => {
    const a = row("canceled", { currentPeriodEnd: at(-40 * DAY), createdAt: at(-80 * DAY) });
    const b = row("trialing", { trialEndsAt: at(5 * DAY), createdAt: at(-9 * DAY) }, "basic");
    const c = row("past_due", { currentPeriodStart: at(-DAY), currentPeriodEnd: at(29 * DAY), createdAt: at(-DAY) });
    for (const rows of [[a, b, c], [c, b, a], [b, c, a]]) {
      expect(resolveSalonAccess(rows, NOW)).toEqual({
        state: "trialing",
        mode: "full",
        planSlug: "basic",
        until: at(5 * DAY),
      });
    }
  });
});
