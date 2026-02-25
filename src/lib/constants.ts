/**
 * Shared business constants.
 *
 * All values that appear in multiple places across the codebase
 * should be defined here to keep them in sync.
 */

// --------------- Pricing ---------------

export const PLANS = {
  basic: {
    slug: "basic" as const,
    name: "Basic",
    priceMonthly: 49,
    priceLabel: "49 PLN/mies.",
  },
  pro: {
    slug: "pro" as const,
    name: "Pro",
    priceMonthly: 149,
    priceLabel: "149 PLN/mies.",
  },
} as const;

// --------------- Taxes & Fees ---------------

/** Standard Polish VAT rate for services (%) */
export const DEFAULT_VAT_RATE = 23;

/** Default employee commission rate (%) */
export const DEFAULT_COMMISSION_RATE = 50;

/** Default deposit percentage for services (%) */
export const DEFAULT_DEPOSIT_PERCENTAGE = 30;

// --------------- Trial ---------------

/** Free trial period in days */
export const TRIAL_DAYS = 14;

// --------------- Currency & Locale ---------------

export const DEFAULT_CURRENCY = "PLN";
export const DEFAULT_LOCALE = "pl-PL";
