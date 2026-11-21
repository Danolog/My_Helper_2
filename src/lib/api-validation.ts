/**
 * Server-side validation utilities using Zod 4.
 *
 * Provides structured validation for API endpoints with detailed error responses.
 * Returns field-level error messages in Polish for consistency with the UI.
 */
import { z } from "zod";
import {
  PUSH_ENDPOINT_MAX_LENGTH,
  isValidP256dh,
  isValidPushAuth,
  isValidPushEndpoint,
} from "@/lib/push-subscription";
import { APPOINTMENT_NOTES_MAX_LENGTH } from "@/lib/appointment-limits";
import { normalizePolishPhoneNumber } from "@/lib/phone";
import { PLANS_ON_SALE } from "@/lib/plan-catalog";
import { isOwnUploadUrl } from "@/lib/upload-url";

// ==========================================
// Validation Helper
// ==========================================

/**
 * Validate request body against a Zod schema.
 * Returns null if valid, or a structured error response if invalid.
 */
export function validateBody<T extends z.ZodType>(
  schema: T,
  data: unknown
): ValidationErrorBody | null {
  const result = schema.safeParse(data);
  if (result.success) return null;
  return toValidationError(result.error);
}

export type ValidationErrorBody = { success: false; error: string; details: Record<string, string> };

function toValidationError(error: z.ZodError): ValidationErrorBody {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_root";
    // Only keep the first error per field
    if (!details[path]) {
      details[path] = issue.message;
    }
  }

  return {
    success: false,
    error: "Validation failed",
    details,
  };
}

/**
 * Jak validateBody, ale przy sukcesie zwraca SPARSOWANE dane (po transformacjach
 * schematu: null -> undefined, normalizacja telefonu). Trasa, której schemat
 * normalizuje wejście, musi czytać `data`, nie surowe body — inaczej
 * normalizacja nie dochodzi do logiki i zapisu.
 */
export function parseBody<T extends z.ZodType>(
  schema: T,
  data: unknown
): { ok: true; data: z.output<T> } | { ok: false; error: ValidationErrorBody } {
  const result = schema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: toValidationError(result.error) };
}

// ==========================================
// Reusable field schemas (Zod 4 compatible)
// ==========================================

const emailField = z
  .string()
  .email("Wprowadz poprawny adres email")
  .optional()
  .nullable()
  .or(z.literal(""));

const phoneField = z
  .string()
  .optional()
  .nullable()
  .or(z.literal(""))
  .refine(
    (val) => {
      if (!val || !val.trim()) return true;
      const trimmed = val.trim();
      if (/[^0-9\s+\-().]/.test(trimmed)) return false;
      const digits = trimmed.replace(/\D/g, "");
      return digits.length >= 7 && digits.length <= 15;
    },
    { message: "Numer telefonu musi miec 7-15 cyfr i zawierac tylko cyfry, spacje, +, -, (, )" }
  );

const requiredString = (fieldName: string) =>
  z
    .string({ message: `${fieldName} jest wymagane` })
    .min(1, `${fieldName} jest wymagane`)
    // UAT X-4: gorny limit dlugosci — bez tego np. imie 300 znakow przechodzilo
    .max(200, `${fieldName} jest zbyt dlugie (max 200 znakow)`);

/**
 * Parse a value to a positive number (> 0) with custom error messages.
 */
const positiveNumberField = (fieldName: string) =>
  z.preprocess(
    (val) => {
      if (typeof val === "number") return val;
      if (typeof val === "string" && val.trim() !== "") return Number(val);
      return undefined;
    },
    z.number({ message: `${fieldName} musi byc liczba` })
      .positive(`${fieldName} musi byc wieksza od 0`)
  );

/**
 * Kwota pieniezna: nieujemna i miesci sie w kolumnie numeric(10,2)
 * (max 99 999 999.99). Bez gornego limitu przepelnienie leci jako 500 z DB
 * (UAT C3).
 */
const priceField = (fieldName: string) =>
  z.preprocess(
    (val) => {
      if (typeof val === "number") return val;
      if (typeof val === "string" && val.trim() !== "") return Number(val);
      return undefined;
    },
    z
      .number({ message: `${fieldName} musi byc liczba` })
      .nonnegative(`${fieldName} nie moze byc ujemna`)
      .max(99999999.99, `${fieldName} jest zbyt duza (max 99 999 999.99)`)
  );

// ==========================================
// API Schemas
// ==========================================

export const createServiceSchema = z.object({
  salonId: requiredString("Salon ID"),
  categoryId: z.string().nullable().optional(),
  name: requiredString("Nazwa"),
  description: z.string().nullable().optional(),
  basePrice: priceField("Cena"),
  baseDuration: positiveNumberField("Czas trwania"),
});

export const createClientSchema = z.object({
  salonId: requiredString("Salon ID"),
  firstName: requiredString("Imie"),
  lastName: requiredString("Nazwisko"),
  phone: phoneField,
  email: emailField,
  notes: z.string().nullable().optional(),
  preferences: z.string().nullable().optional(),
  allergies: z.string().nullable().optional(),
  favoriteEmployeeId: z.string().nullable().optional(),
  requireDeposit: z.boolean().optional(),
  depositType: z.enum(["percentage", "fixed"]).optional(),
  depositValue: z.string().nullable().optional(),
});

// userId celowo NIE jest przyjmowany z body — łączenie konta wyłącznie przez
// PUT /api/employees/[id]/link-account (Faza 3, walidacje cross-tenant).
export const createEmployeeSchema = z.object({
  salonId: requiredString("Salon ID"),
  firstName: requiredString("Imie"),
  lastName: requiredString("Nazwisko"),
  phone: phoneField,
  email: emailField,
  photoUrl: z.string().url("Nieprawidlowy URL zdjecia").nullable().optional().or(z.literal("")),
  role: z.string().optional(),
  color: z.string().optional(),
});

// PUT /api/employees/[id]/link-account — email konta do podpięcia,
// null = odłączenie konta od pracownika.
export const linkEmployeeAccountSchema = z.object({
  email: z
    .string({ message: "Adres e-mail jest wymagany" })
    .email("Wprowadz poprawny adres email")
    .nullable(),
});

export const createProductSchema = z.object({
  salonId: requiredString("Salon ID"),
  name: requiredString("Nazwa"),
  category: z.string().nullable().optional(),
  quantity: z.union([
    z.string().refine(
      (val) => {
        if (!val || val === "") return true;
        const num = parseFloat(val);
        return !isNaN(num) && num >= 0;
      },
      { message: "Ilosc musi byc prawidlowa liczba nieujemna" }
    ),
    z.number().nonnegative("Ilosc musi byc prawidlowa liczba nieujemna"),
  ]).optional().nullable(),
  minQuantity: z.union([
    z.string().refine(
      (val) => {
        if (!val || val === "") return true;
        const num = parseFloat(val);
        return !isNaN(num) && num >= 0;
      },
      { message: "Minimalny stan musi byc prawidlowa liczba nieujemna" }
    ),
    z.number().nonnegative("Minimalny stan musi byc prawidlowa liczba nieujemna"),
  ]).optional().nullable(),
  unit: z.string().nullable().optional(),
  pricePerUnit: z.union([
    z.string().refine(
      (val) => {
        if (!val || val === "") return true;
        const num = parseFloat(val);
        return !isNaN(num) && num >= 0;
      },
      { message: "Cena musi byc prawidlowa liczba nieujemna" }
    ),
    z.number().nonnegative("Cena musi byc prawidlowa liczba nieujemna"),
  ]).optional().nullable(),
});

/**
 * Pole opcjonalne tolerujące każdego klienta: null, "" i same spacje znaczą "brak pola"
 * i wychodzą ze schematu jako undefined (dalsza logika nie widzi null).
 * Formularz portalu wysyła clientId: null, variantId: null (usługa bez
 * wariantu) i guestEmail: null (gość bez e-maila) — sam .optional()
 * odrzucał je 400 "Validation failed" (P0 od a00d059).
 */
function absentAsUndefined<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (v) => (v === null || (typeof v === "string" && v.trim() === "") ? undefined : v),
    schema.optional()
  );
}

/**
 * Telefon PL: spacje, myślniki i nawiasy zdejmowane PRZED walidacją, zapis
 * w E.164 przez normalizePolishPhoneNumber (ta sama funkcja co wysyłka SMS):
 * "+48 123 456 789" -> "+48123456789", "123-456-789" -> "+48123456789".
 * Ryan N1 / #64 pkt 4.
 */
function normalizedPlPhone(message: string) {
  return absentAsUndefined(
    z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/[\s\-()]/g, "") : v),
      z.string().transform((v, ctx) => {
        const e164 = normalizePolishPhoneNumber(v);
        if (!e164) {
          ctx.addIssue({ code: "custom", message });
          return z.NEVER;
        }
        return e164;
      })
    )
  );
}

/**
 * Data-czas ISO 8601 (np. z toISOString() frontu): kształt sprawdzany
 * regexem, bo Date.parse jest pobłażliwy ("jutro o 10" -> rok 2010), a potem
 * Date.parse odrzuca nieistniejące wartości (miesiąc 13, godzina 99).
 * Strefa (`Z` albo `±hh:mm`) jest WYMAGANA: wartość bez strefy Date.parse
 * czyta w strefie serwera (UTC na Vercelu), więc "10:00" z Polski byłoby
 * zapisane godzinę lub dwie później (Ethan, przegląd #71). Wszyscy nadawcy
 * wysyłają toISOString(), czyli `Z`.
 *
 * Godzina 00–23, minuty i sekundy 00–59 w samym regexie: Date.parse przyjmuje
 * "T24:00" jako północ następnego dnia. Dzień kalendarza sprawdza
 * isRealCalendarDate (#95).
 */
const ISO_DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Date.parse nie odrzuca nieistniejącego dnia, tylko go przewija:
 * "2026-02-30" => 2 marca, "2026-04-31" => 1 maja (#95). Dzień, miesiąc i rok
 * z napisu muszą przetrwać złożenie daty w UTC. Strefa nie ma tu znaczenia:
 * sprawdzamy kalendarzową część napisu, nie chwilę po przeliczeniu offsetu.
 */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function isIsoDateTime(v: string): boolean {
  const m = ISO_DATE_TIME_RE.exec(v);
  if (!m || Number.isNaN(Date.parse(v))) return false;
  return isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

const NOTES_TOO_LONG = `Uwagi mogą mieć maks. ${APPOINTMENT_NOTES_MAX_LENGTH} znaków`;

function isoDateString(field: string) {
  return z
    .string({ message: `${field} jest wymagane` })
    .min(1, `${field} jest wymagane`)
    .refine(
      (v) => isIsoDateTime(v),
      `${field}: nieprawidłowy format daty`
    );
}

const GUEST_NAME_TOO_SHORT = "Imię i nazwisko musi mieć min. 2 znaki (jedna litera to za mało)";

/** Pola gościa wspólne dla create-session i /api/appointments. */
const guestFields = {
  guestName: absentAsUndefined(
    z
      .string()
      .trim()
      .min(2, GUEST_NAME_TOO_SHORT)
      .max(200, "Imię i nazwisko może mieć maks. 200 znaków")
  ),
  guestPhone: normalizedPlPhone("Podaj prawidłowy numer telefonu (9 cyfr, opcjonalnie +48)"),
  guestEmail: absentAsUndefined(
    z.string().trim().max(254, "Adres e-mail jest zbyt długi").email("Podaj prawidłowy adres e-mail")
  ),
};



export const createAppointmentSchema = z.object({
  salonId: requiredString("Salon ID"),
  clientId: z.string().nullable().optional(),
  employeeId: requiredString("Pracownik"),
  serviceId: z.string().nullable().optional(),
  // #66 (P3 Ryana z #67): ISO 8601 jak w create-session — sam Date.parse
  // przyjmował np. "jutro o 10" (parsuje się jako rok 2010). Front portalu
  // i panelu wysyła toISOString().
  startTime: isoDateString("Czas rozpoczecia"),
  endTime: isoDateString("Czas zakonczenia"),
  // #66: limit jak w create-session; null/""/same spacje = brak uwag.
  notes: absentAsUndefined(z.string().max(APPOINTMENT_NOTES_MAX_LENGTH, NOTES_TOO_LONG)),
  depositAmount: z.string().nullable().optional(),
  bookedByUserId: z.string().nullable().optional(),
  promoCodeId: z.string().nullable().optional(),
  discountAmount: z.union([z.string(), z.number()]).nullable().optional(),
  // #63/#64: trasa czyta parsed.data — pola gościa i wariant muszą być
  // w schemacie (inaczej Zod je zdejmuje). Telefon zapisywany w E.164.
  variantId: absentAsUndefined(z.string().uuid("variantId musi byc poprawnym UUID")),
  ...guestFields,
}).refine(
  (data) => {
    if (!data.startTime || !data.endTime) return true;
    const start = new Date(data.startTime);
    const end = new Date(data.endTime);
    return end > start;
  },
  { message: "Czas zakonczenia musi byc pozniej niz czas rozpoczecia", path: ["endTime"] }
);

export const createPromotionSchema = z.object({
  salonId: requiredString("Salon ID"),
  name: requiredString("Nazwa"),
  type: z.enum(["percentage", "fixed", "package", "buy2get1", "happy_hours", "first_visit"], {
    message: "Nieprawidlowy typ promocji",
  }),
  value: z.preprocess(
    (val) => {
      if (typeof val === "number") return val;
      if (typeof val === "string" && val.trim() !== "") return Number(val);
      return undefined;
    },
    z.number({ message: "Wartosc musi byc liczba" })
  ),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  conditionsJson: z.any().optional(),
  isActive: z.boolean().optional(),
  applicableServiceIds: z.array(z.string()).optional(),
}).refine(
  // UAT X-3: data konca nie moze byc wczesniejsza niz rozpoczecia
  (data) => {
    if (!data.startDate || !data.endDate) return true;
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return true;
    return end >= start;
  },
  { message: "Data zakonczenia nie moze byc wczesniejsza niz rozpoczecia", path: ["endDate"] }
);

// ==========================================
// Update Schemas (for PUT/PATCH endpoints)
// All fields are optional since updates are partial.
// ==========================================

/**
 * Schema for PUT /api/appointments/[id] — reschedule or update an appointment.
 * All fields are optional; only provided fields are applied.
 */
export const updateAppointmentSchema = z.object({
  // #95: ta sama reguła co POST i create-session — ISO ze strefą. Luźne
  // new Date() czytało "2026-04-01T10:00" w strefie serwera (UTC na Vercelu),
  // więc przesunięcie wizyty zapisywało godzinę lub dwie później.
  startTime: isoDateString("Czas rozpoczecia").optional(),
  endTime: isoDateString("Czas zakonczenia").optional(),
  employeeId: z.string().optional(),
  clientId: z.string().nullable().optional(),
  serviceId: z.string().nullable().optional(),
  // PUT: null, "" i same spacje = wyczyść notatki (null), brak pola = bez zmian
  // (undefined). Inaczej niż w POST, gdzie brak uwag to undefined: tu null jest
  // poleceniem (edit-appointment-dialog wysyła `notes.trim() || null`).
  notes: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().max(APPOINTMENT_NOTES_MAX_LENGTH, NOTES_TOO_LONG).nullable().optional()
  ),
  status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"], {
    message: "Nieprawidlowy status wizyty",
  }).optional(),
  depositAmount: z.string().nullable().optional(),
  depositPaid: z.boolean().optional(),
});

/**
 * Schema for POST /api/appointments/[id]/complete — complete an appointment.
 */
export const completeAppointmentSchema = z.object({
  recipe: z.string().nullable().optional(),
  techniques: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  commissionPercentage: z.union([z.string(), z.number()]).nullable().optional(),
});

/**
 * Schema for POST /api/appointments/[id]/materials — add material to an appointment.
 */
export const addAppointmentMaterialSchema = z.object({
  productId: requiredString("Produkt"),
  quantityUsed: z.union([
    z.string().refine(
      (val) => {
        const num = parseFloat(val);
        return !isNaN(num) && num > 0;
      },
      { message: "Ilosc musi byc wieksza od 0" }
    ),
    z.number().positive("Ilosc musi byc wieksza od 0"),
  ]),
  notes: z.string().nullable().optional(),
});

/**
 * Schema for PUT /api/clients/[id] — update a client.
 * All fields are optional since updates are partial.
 */
export const updateClientSchema = z.object({
  firstName: z.string().min(1, "Imie jest wymagane").optional(),
  lastName: z.string().min(1, "Nazwisko jest wymagane").optional(),
  phone: phoneField,
  email: emailField,
  notes: z.string().nullable().optional(),
  preferences: z.string().nullable().optional(),
  allergies: z.string().nullable().optional(),
  favoriteEmployeeId: z.string().nullable().optional(),
  requireDeposit: z.boolean().optional(),
  depositType: z.enum(["percentage", "fixed"]).optional(),
  depositValue: z.string().nullable().optional(),
});

/**
 * Schema for PUT /api/employees/[id] — update an employee.
 */
export const updateEmployeeSchema = z.object({
  firstName: z.string().min(1, "Imie jest wymagane").optional(),
  lastName: z.string().min(1, "Nazwisko jest wymagane").optional(),
  phone: phoneField,
  email: emailField,
  role: z.string().optional(),
  isActive: z.boolean().optional(),
  serviceIds: z.array(z.string()).optional(),
});

/**
 * Schema for PUT /api/services/[id] — update a service.
 * All fields are optional since updates are partial.
 */
export const updateServiceSchema = z.object({
  name: z.string().min(1, "Nazwa jest wymagana").optional(),
  description: z.string().nullable().optional(),
  basePrice: z.union([z.string(), z.number()]).optional(),
  baseDuration: z.union([z.string(), z.number()]).optional(),
  isActive: z.boolean().optional(),
  categoryId: z.string().nullable().optional(),
  depositRequired: z.boolean().optional(),
  depositPercentage: z.union([z.string(), z.number()]).optional(),
});

/**
 * Schema for PUT /api/products/[id] — update a product.
 * All fields are optional since updates are partial.
 */
export const updateProductSchema = z.object({
  name: z.string().min(1, "Nazwa jest wymagana").optional(),
  category: z.string().nullable().optional(),
  quantity: z.union([
    z.string().refine(
      (val) => {
        if (!val || val === "") return true;
        const num = parseFloat(val);
        return !isNaN(num) && num >= 0;
      },
      { message: "Ilosc musi byc prawidlowa liczba nieujemna" }
    ),
    z.number().nonnegative("Ilosc musi byc prawidlowa liczba nieujemna"),
  ]).optional().nullable(),
  minQuantity: z.union([
    z.string().refine(
      (val) => {
        if (!val || val === "") return true;
        const num = parseFloat(val);
        return !isNaN(num) && num >= 0;
      },
      { message: "Minimalny stan musi byc prawidlowa liczba nieujemna" }
    ),
    z.number().nonnegative("Minimalny stan musi byc prawidlowa liczba nieujemna"),
  ]).optional().nullable(),
  unit: z.string().nullable().optional(),
  pricePerUnit: z.union([
    z.string().refine(
      (val) => {
        if (!val || val === "") return true;
        const num = parseFloat(val);
        return !isNaN(num) && num >= 0;
      },
      { message: "Cena musi byc prawidlowa liczba nieujemna" }
    ),
    z.number().nonnegative("Cena musi byc prawidlowa liczba nieujemna"),
  ]).optional().nullable(),
});

/**
 * Schema for PUT /api/salons/[id] — update salon basic data.
 */
export const updateSalonSchema = z.object({
  name: z.string().min(1, "Nazwa salonu jest wymagana").max(100, "Nazwa salonu moze miec maksymalnie 100 znakow"),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().max(100).nullable().optional(),
  address: z.string().max(200).nullable().optional(),
  industryType: z.enum(["hair_salon", "beauty_salon", "nails", "barbershop", "spa", "medical"], {
    message: "Nieprawidlowy typ branzy",
  }).nullable().optional(),
});

/**
 * Schema for PUT /api/promotions/[id] — update a promotion.
 * All fields are optional since updates are partial.
 */
export const updatePromotionSchema = z.object({
  name: z.string().min(1, "Nazwa jest wymagana").optional(),
  type: z.enum(["percentage", "fixed", "package", "buy2get1", "happy_hours", "first_visit"], {
    message: "Nieprawidlowy typ promocji",
  }).optional(),
  value: z.union([z.string(), z.number()]).optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  conditionsJson: z.any().optional(),
  isActive: z.boolean().optional(),
  applicableServiceIds: z.array(z.string()).optional(),
}).refine(
  // UAT X-3: data konca nie moze byc wczesniejsza niz rozpoczecia
  (data) => {
    if (!data.startDate || !data.endDate) return true;
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return true;
    return end >= start;
  },
  { message: "Data zakonczenia nie moze byc wczesniejsza niz rozpoczecia", path: ["endDate"] }
);

/**
 * Schema for POST /api/promo-codes — create a promo code.
 */
export const createPromoCodeSchema = z.object({
  salonId: requiredString("Salon ID"),
  code: z.string().optional(),
  promotionId: z.string().nullable().optional(),
  usageLimit: z.number().int().nonnegative("Limit uzycia nie moze byc ujemny").nullable().optional(),
  expiresAt: z.string().nullable().optional(),
});

/**
 * Schema for POST /api/waiting-list — add a client to the waiting list.
 *
 * Personel dodaje wpis tylko na prośbę klienta: `clientRequestConfirmed`
 * musi być dokładnie `true`. Schemat ścisły — źródło wpisu, czas potwierdzenia
 * i autora ustawia serwer, więc takie pola w treści są odrzucane.
 */
export const createWaitingListSchema = z.strictObject({
  clientId: requiredString("Klient"),
  serviceId: z.string().nullable().optional(),
  preferredEmployeeId: z.string().nullable().optional(),
  preferredDate: z.string().nullable().optional(),
  clientRequestConfirmed: z.literal(true, {
    message: "Potwierdź, że klient sam poprosił o zapis na listę oczekujących.",
  }),
});

/**
 * Schema for PUT /api/waiting-list/[id] — update a waiting list entry.
 */
export const updateWaitingListSchema = z.object({
  accepted: z.boolean().optional(),
  serviceId: z.string().nullable().optional(),
  preferredEmployeeId: z.string().nullable().optional(),
  preferredDate: z.string().nullable().optional(),
});

/**
 * Schema for PATCH /api/reviews/[id]/respond — owner response to a review.
 */
export const reviewRespondSchema = z.object({
  response: z.string().min(1, "Odpowiedz nie moze byc pusta").max(2000, "Odpowiedz nie moze byc dluzsza niz 2000 znakow"),
});

/**
 * Schema for PATCH /api/reviews/[id]/moderate — approve or reject a review.
 */
export const reviewModerateSchema = z.object({
  action: z.enum(["approve", "reject"], {
    message: "Akcja musi byc 'approve' lub 'reject'",
  }),
});

export const birthdaySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  giftType: z.enum(["discount", "product"]).optional(),
  discountPercentage: z.number().min(0).max(100).optional(),
  productName: z.string().optional(),
  customMessage: z.string().optional(),
  autoSend: z.boolean().optional(),
});

const rewardTierSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Nazwa nagrody jest wymagana"),
  pointsRequired: z.number().int().positive("Wymagane punkty musza byc wieksze od 0"),
  rewardType: z.enum(["discount", "free_service", "product"]),
  rewardValue: z.number().positive("Wartosc nagrody musi byc wieksza od 0"),
  description: z.string().optional().default(""),
});

export const loyaltySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  pointsPerCurrencyUnit: z.number().int().min(1).max(100).optional(),
  currencyUnit: z.number().int().min(1).max(100).optional(),
  pointsExpiryDays: z.number().int().min(30).max(3650).nullable().optional(),
  rewardTiers: z.array(rewardTierSchema).optional(),
});

export const notificationTypeSettingsSchema = z.object({
  smsReminders: z.boolean().optional(),
  pushReminders: z.boolean().optional(),
  birthdayNotifications: z.boolean().optional(),
  weMissYouNotifications: z.boolean().optional(),
  paymentConfirmations: z.boolean().optional(),
});

// Feature flags per salon (Ustawienia -> Moduły): mapa klucz modułu -> bool.
// Nieznane/hardOff klucze odfiltrowuje trasa (jedno źródło prawdy: features.ts).
export const salonModulesSchema = z.object({
  modules: z.record(z.string(), z.boolean()),
});

/**
 * Prefiksy (dwie pierwsze cyfry numeru krajowego) zakresów sieci ruchomych
 * w planie numeracji krajowej PL (rozporządzenie w sprawie planu numeracji
 * krajowej; przydziały prowadzi UKE): 45, 50, 51, 53, 57, 60, 66, 69, 72, 73,
 * 78, 79, 88. Źródło: wiedza o krajowym planie
 * numeracji bez dostępu do rejestru UKE — przy zmianie przydziałów UKE lista
 * do aktualizacji. Reguła „pierwsza cyfra 4–8” przepuszczała stacjonarne
 * (58, 61, 71, 81), dlatego lista zamknięta.
 */
export const POLISH_MOBILE_PREFIXES: readonly string[] = Object.freeze([
  "45", "50", "51", "53", "57", "60", "66", "69", "72", "73", "78", "79", "88",
]);

/** Czy numer w E.164 (+48 + 9 cyfr) należy do zakresu komórkowego. */
export function isPolishMobileNumber(e164: string): boolean {
  if (!/^\+48\d{9}$/.test(e164)) return false;
  return POLISH_MOBILE_PREFIXES.includes(e164.slice(3, 5));
}

const BLIK_PHONE_FORMAT_MESSAGE = "Podaj prawidlowy numer telefonu (9 cyfr, opcjonalnie +48)";
const BLIK_PHONE_MOBILE_MESSAGE = "Numer BLIK musi byc numerem komorkowym";
const BLIK_CONSENT_MESSAGE = "Zaznacz zgode na pokazywanie numeru klientom";
const BLIK_CONSENT_VERSION_MESSAGE = "Brak wersji tresci zgody. Odswiez strone";

/**
 * Numer BLIK salonu: ta sama normalizacja co `guestPhone` (spacje, myślniki,
 * nawiasy zdejmowane, zapis E.164 przez normalizePolishPhoneNumber), potem
 * zakres komórkowy. Pusty napis = null (wyłączenie zadatków BLIK).
 * Komunikaty błędów są stałe — numer nie trafia do odpowiedzi ani logów.
 */
const blikPhoneField = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    const stripped = v.replace(/[\s\-()]/g, "");
    return stripped === "" ? null : stripped;
  },
  z.union([
    z.null(),
    z.string().transform((v, ctx) => {
      const e164 = normalizePolishPhoneNumber(v);
      if (!e164) {
        ctx.addIssue({ code: "custom", message: BLIK_PHONE_FORMAT_MESSAGE });
        return z.NEVER;
      }
      if (!isPolishMobileNumber(e164)) {
        ctx.addIssue({ code: "custom", message: BLIK_PHONE_MOBILE_MESSAGE });
        return z.NEVER;
      }
      return e164;
    }),
  ])
);

/**
 * PUT /api/salon/blik-deposit. `blikPhone` wymagany (null czyści numer —
 * brak klucza nie może przypadkiem skasować ustawienia). Numer wymaga
 * `consent: true` (RODO: zgoda właściciela na pokazanie numeru klientom)
 * i `consentVersion` — wersji treści zgody, którą właściciel przeczytał
 * (trasa porównuje ją z bieżącą). Data i zapisywana wersja zgody NIE
 * pochodzą z body — nadaje je serwer; nieznane klucze (np. `blikConsentAt`,
 * `blikConsentVersion`) schemat pomija (strip), żądanie przechodzi.
 * `blikPhone: null` nie wymaga ani zgody, ani wersji.
 */
export const blikDepositSettingsSchema = z
  .object({
    blikPhone: blikPhoneField,
    consent: z.boolean().optional(),
    consentVersion: z.string().max(32).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.blikPhone !== null && v.consent !== true) {
      ctx.addIssue({ code: "custom", path: ["consent"], message: BLIK_CONSENT_MESSAGE });
    }
    if (v.blikPhone !== null && v.consentVersion === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["consentVersion"],
        message: BLIK_CONSENT_VERSION_MESSAGE,
      });
    }
  });

export const weMissYouSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  inactiveDays: z.number().int().min(1).max(365).optional(),
  customMessage: z.string().min(1).optional(),
  includeBookingLink: z.boolean().optional(),
  autoSend: z.boolean().optional(),
});

// ==========================================
// Service Sub-resource Schemas
// ==========================================

export const createServiceCategorySchema = z.object({
  salonId: requiredString("Salon ID"),
  name: requiredString("Nazwa kategorii"),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

export const updateServiceCategorySchema = z.object({
  name: z.string().min(1, "Nazwa kategorii jest wymagana").optional(),
  description: z.string().nullable().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});

export const employeeAssignmentSchema = z.object({
  employeeId: requiredString("Pracownik"),
});

export const employeePriceSchema = z.object({
  employeeId: requiredString("Pracownik"),
  variantId: z.string().nullable().optional(),
  customPrice: z.union([
    z.string().refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, { message: "Cena musi byc nieujemna" }),
    z.number().nonnegative("Cena musi byc nieujemna"),
  ]),
});

export const serviceProductLinkSchema = z.object({
  productId: requiredString("Produkt"),
  defaultQuantity: z.union([z.string(), z.number()]).optional(),
});

export const createServiceVariantSchema = z.object({
  name: requiredString("Nazwa wariantu"),
  priceModifier: z.union([z.string(), z.number()]).optional(),
  durationModifier: z.union([z.string(), z.number()]).optional(),
});

export const updateServiceVariantSchema = z.object({
  name: z.string().min(1, "Nazwa wariantu jest wymagana").optional(),
  priceModifier: z.union([z.string(), z.number()]).optional(),
  durationModifier: z.union([z.string(), z.number()]).optional(),
});

// ==========================================
// Appointment Sub-resource Schemas
// ==========================================

export const treatmentSchema = z.object({
  recipe: z.string().nullable().optional(),
  techniques: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  materialsJson: z.any().optional(),
});

export const invoiceSchema = z.object({
  buyerName: requiredString("Nazwa nabywcy"),
  buyerNip: z.string().optional(),
  buyerAddress: z.string().optional(),
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative(),
    vatRate: z.string().optional(),
  })).optional(),
  notes: z.string().nullable().optional(),
  dueDate: z.string().optional(),
  paymentMethod: z.string().optional(),
});

export const bookPackageSchema = z.object({
  salonId: requiredString("Salon ID"),
  clientId: requiredString("Klient"),
  employeeId: requiredString("Pracownik"),
  serviceId: requiredString("Usluga"),
  dates: z.array(z.string()).min(1, "Wymagana co najmniej jedna data"),
  notes: z.string().nullable().optional(),
});

// ==========================================
// Client Sub-resource Schemas
// ==========================================

// Zgody marketingowe RODO (P2, Ryan). Kontrakt = body z client-consents-card.tsx:
// { consents: { email|sms|phone: boolean } } (UI wysyła jeden typ na żądanie).
// Wartość wyłącznie boolean — bez koercji: "false" jako tekst to błąd, nie zgoda.
// .strict() na obu poziomach: nieznany typ zgody albo pole spoza kontraktu => 400.
export const CONSENT_TYPES = ["email", "sms", "phone"] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const clientConsentsSchema = z
  .object({
    consents: z
      .object({
        email: z.boolean().optional(),
        sms: z.boolean().optional(),
        phone: z.boolean().optional(),
      })
      .strict()
      .refine((c) => Object.keys(c).length > 0, {
        message: "Podaj co najmniej jeden typ zgody",
      }),
  })
  .strict();

// Kontrakt = body z client-loyalty-tab.tsx: { rewardTierId, salonId }.
// Punkty do odjęcia liczy trasa z progu nagrody (pointsRequired) — klient ich
// nie podaje. salonId ignorowany: trasa bierze salon z sesji.
export const loyaltyRedeemSchema = z.object({
  rewardTierId: requiredString("Nagroda"),
  salonId: z.string().nullable().optional(),
});

// Kontrakt = body z use-appointment-detail.ts: comment to trim() || null.
export const clientReviewSchema = z.object({
  rating: z.number().int().min(1).max(5, "Ocena musi byc od 1 do 5"),
  comment: z.string().max(2000).nullable().optional(),
});

export const clientWaitingListSchema = z.object({
  salonId: requiredString("Salon ID"),
  serviceId: z.string().nullable().optional(),
  preferredEmployeeId: z.string().nullable().optional(),
  preferredDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

// ==========================================
// Product Category Schemas
// ==========================================

export const createProductCategorySchema = z.object({
  salonId: requiredString("Salon ID"),
  name: requiredString("Nazwa kategorii"),
});

export const updateProductCategorySchema = z.object({
  name: z.string().min(1, "Nazwa kategorii jest wymagana").optional(),
});

// ==========================================
// Album & Gallery Schemas
// ==========================================

export const createAlbumSchema = z.object({
  salonId: requiredString("Salon ID"),
  name: requiredString("Nazwa albumu"),
  description: z.string().nullable().optional(),
});

export const updateAlbumSchema = z.object({
  name: z.string().min(1, "Nazwa albumu jest wymagana").optional(),
  description: z.string().nullable().optional(),
});

export const albumPhotosSchema = z.object({
  photoIds: z.array(z.string()).min(1, "Wymagane co najmniej jedno zdjecie"),
});

// Id pracownika/uslugi: kolumny uuid w bazie (defaultRandom = v4), wiec smiec
// dalby 500. Od #33 id z seeda tez sa v4 (00000000-0000-4000-8000-...), wiec
// scisly z.uuid() (wersja + wariant RFC) — jak reszta schematow tras.
const uuidId = z.uuid("Nieprawidlowy identyfikator");
const optionalUuidId = uuidId.nullable().optional();

// Adres zdjecia: wylacznie to, co zwrocil nasz upload galerii (lib/upload-url).
const galleryUploadUrl = z
  .string()
  .refine((url) => isOwnUploadUrl(url, { folder: "gallery" }).ok, "Adres zdjecia musi pochodzic z uploadu galerii")
  .nullable()
  .optional();

// Kontrakt = body z src/components/gallery/photo-upload-dialog.tsx.
export const createGalleryPhotoSchema = z
  .object({
    salonId: requiredString("Salon ID"),
    employeeId: optionalUuidId,
    serviceId: optionalUuidId,
    beforePhotoUrl: galleryUploadUrl,
    afterPhotoUrl: galleryUploadUrl,
    description: z.string().max(2000).nullable().optional(),
    productsUsed: z.string().max(1000).nullable().optional(),
    techniques: z.string().max(1000).nullable().optional(),
    duration: z.number().int().min(0).max(1440, "Czas trwania maksymalnie 1440 minut").nullable().optional(),
  })
  .refine((d) => Boolean(d.beforePhotoUrl || d.afterPhotoUrl), {
    message: "Wymagane co najmniej jedno zdjecie (przed lub po)",
    path: ["afterPhotoUrl"],
  });

// Kontrakt PATCH /api/gallery/[id] = body z src/components/gallery/
// photo-edit-dialog.tsx (pola formularza) i photo-link-dialog.tsx (jedno z
// beforePhotoUrl/afterPhotoUrl). .strict(): pole spoza kontraktu (salonId, id,
// stare title/tags) to 400, nie ciche pominięcie. Adresy zdjęć — ta sama
// allowlista co w POST (inaczej POST z dobrym adresem + PATCH z dowolnym
// omijał ją). Przynależność employeeId/serviceId do salonu sprawdza trasa
// (assertSalonRefs), bo schemat nie zna salonu sesji.
export const updateGalleryPhotoSchema = z
  .object({
    description: z.string().max(2000).nullable().optional(),
    techniques: z.string().max(1000).nullable().optional(),
    productsUsed: z.string().max(1000).nullable().optional(),
    employeeId: optionalUuidId,
    serviceId: optionalUuidId,
    duration: z.number().int().min(0).max(1440, "Czas trwania maksymalnie 1440 minut").nullable().optional(),
    showProductsToClients: z.boolean().optional(),
    beforePhotoUrl: galleryUploadUrl,
    afterPhotoUrl: galleryUploadUrl,
  })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "Brak pol do aktualizacji",
    path: ["_root"],
  });

// ==========================================
// Payment & Subscription Schemas
// ==========================================

export const depositCreateSessionSchema = z.object({
  salonId: z.string().uuid("salonId musi byc poprawnym UUID"),
  employeeId: z.string().uuid("employeeId musi byc poprawnym UUID"),
  serviceId: absentAsUndefined(z.string().uuid("serviceId musi byc poprawnym UUID")),
  variantId: absentAsUndefined(z.string().uuid("variantId musi byc poprawnym UUID")),
  clientId: absentAsUndefined(z.string().uuid("clientId musi byc poprawnym UUID")),
  startTime: isoDateString("startTime"),
  endTime: isoDateString("endTime"),
  depositAmount: z.preprocess(
    (v) => (typeof v === "string" ? parseFloat(v) : v),
    z.number().positive("Kwota zadatku musi byc wieksza od 0")
  ),
  paymentMethod: absentAsUndefined(
    z.enum(["stripe", "blik"], { message: "paymentMethod musi byc 'stripe' lub 'blik'" })
  ),
  blikPhoneNumber: normalizedPlPhone("Nieprawidlowy numer telefonu BLIK (9 cyfr)"),
  ...guestFields,
  notes: absentAsUndefined(z.string().max(APPOINTMENT_NOTES_MAX_LENGTH, NOTES_TOO_LONG)),
}).refine((d) => Date.parse(d.endTime) > Date.parse(d.startTime), {
  message: "Czas zakończenia musi być późniejszy niż czas rozpoczęcia",
  path: ["endTime"],
});

// Rezerwacja z zadatkiem płatnym BLIK-iem na telefon salonu
// (POST /api/deposits/blik-booking). Pola rezerwacji, kwoty i gościa jak w
// depositCreateSessionSchema, bez metody płatności i numeru BLIK: numer
// odbiorcy podaje serwer (ustawienia salonu), a klient płaci w swoim banku.
// Usługa jest wymagana, bo kwota zadatku wynika z usługi.
export const blikBookingSchema = z.object({
  salonId: z.string().uuid("salonId musi byc poprawnym UUID"),
  employeeId: z.string().uuid("employeeId musi byc poprawnym UUID"),
  serviceId: z.string().uuid("serviceId musi byc poprawnym UUID"),
  variantId: absentAsUndefined(z.string().uuid("variantId musi byc poprawnym UUID")),
  clientId: absentAsUndefined(z.string().uuid("clientId musi byc poprawnym UUID")),
  startTime: isoDateString("startTime"),
  endTime: isoDateString("endTime"),
  depositAmount: z.preprocess(
    (v) => (typeof v === "string" ? parseFloat(v) : v),
    z.number().positive("Kwota zadatku musi byc wieksza od 0")
  ),
  ...guestFields,
  notes: absentAsUndefined(z.string().max(APPOINTMENT_NOTES_MAX_LENGTH, NOTES_TOO_LONG)),
}).refine((d) => Date.parse(d.endTime) > Date.parse(d.startTime), {
  message: "Czas zakończenia musi być późniejszy niż czas rozpoczęcia",
  path: ["endTime"],
});

export const depositConfirmSchema = z.object({
  depositPaymentId: z.string().uuid("Nieprawidlowy identyfikator platnosci zadatku"),
  sessionId: requiredString("ID sesji"),
});

// Kontrakt = body z UI: src/app/(site)/pricing/page.tsx oraz
// src/app/dashboard/subscription/_hooks/use-subscription-data.ts → { planSlug }.
// Salon wylacznie z sesji (getUserSalonId), wiec salonId nie jest czescia body.
// Dozwolone wartosci planSlug to elementy PLANS_ON_SALE z @/lib/plan-catalog;
// trasa i tak sprawdza w bazie, czy plan jest aktywny.
export const CHECKOUT_PLAN_SLUGS = PLANS_ON_SALE;
export type CheckoutPlanSlug = (typeof CHECKOUT_PLAN_SLUGS)[number];

export const subscriptionCheckoutSchema = z.object({
  planSlug: z.enum(CHECKOUT_PLAN_SLUGS, {
    message: `planSlug musi byc jednym z: ${CHECKOUT_PLAN_SLUGS.join(", ")}`,
  }),
});

export const subscriptionConfirmSchema = z.object({
  sessionId: requiredString("ID sesji"),
});

// ==========================================
// Other Schemas
// ==========================================

export const commissionRateSchema = z.object({
  employeeId: requiredString("Pracownik"),
  commissionRate: z.union([
    z.string().refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0 && parseFloat(v) <= 100, { message: "Prowizja musi byc 0-100" }),
    z.number().min(0).max(100, "Prowizja musi byc 0-100"),
  ]),
});

export const favoriteSalonSchema = z.object({
  salonId: requiredString("Salon ID"),
});

export const updatePromoCodeSchema = z.object({
  code: z.string().optional(),
  promotionId: z.string().nullable().optional(),
  usageLimit: z.number().int().nonnegative().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const validatePromoCodeSchema = z.object({
  code: requiredString("Kod promocyjny"),
  salonId: requiredString("Salon ID"),
  serviceId: z.string().optional(),
});

// ==========================================
// Subscription Schemas (additional)
// ==========================================

export const downgradeSubscriptionSchema = z.object({
  targetPlanSlug: z.string().min(1, "targetPlanSlug is required"),
});

// ==========================================
// Client Portal Schemas (additional)
// ==========================================

export const clientWaitingListResponseSchema = z.object({
  accepted: z.boolean({ message: "Pole 'accepted' jest wymagane i musi byc wartoscia logiczna (true/false)" }),
});

// Konto bierze trasa z sesji. `email` zostaje opcjonalne tylko dla zgodnosci
// ze starszymi klientami (UI go wysyla), trasa go IGNORUJE.
// Dozwolone wartosci planSlug to elementy PLANS_ON_SALE z @/lib/plan-catalog.
export const registerSubscriptionSchema = z.object({
  planSlug: z.enum(PLANS_ON_SALE, {
    message: `planSlug musi byc jednym z: ${PLANS_ON_SALE.join(", ")}`,
  }),
  email: z.string().optional(),
});

export const sendInvoiceEmailSchema = z.object({
  email: z.string().email("Nieprawidlowy format adresu email").optional(),
});

// Endpoint: https + allowlista hostów usług push (lib/push-subscription.ts).
// Bez niej web-push robił POST na dowolny host:port z bazy (SSRF, P1).
export const pushSubscribeSchema = z.object({
  endpoint: z
    .string({ message: "Endpoint jest wymagane" })
    .min(1, "Endpoint jest wymagane")
    .max(PUSH_ENDPOINT_MAX_LENGTH, "Endpoint jest zbyt dlugi")
    .refine(isValidPushEndpoint, "Nieobslugiwany adres uslugi push"),
  keys: z.object({
    p256dh: requiredString("Klucz p256dh").refine(isValidP256dh, "Nieprawidlowy klucz p256dh"),
    auth: requiredString("Klucz auth").refine(isValidPushAuth, "Nieprawidlowy klucz auth"),
  }),
  salonId: z.string().optional(),
});

// Bez allowlisty: usunięcie własnego wiersza jest nieszkodliwe (także starego,
// nieważnego). Limit długości jak przy subscribe — inaczej długi endpoint
// WNS/APNs dałoby się zapisać, ale nie wypisać.
export const pushUnsubscribeSchema = z.object({
  endpoint: z
    .string({ message: "Endpoint jest wymagane" })
    .min(1, "Endpoint jest wymagane")
    .max(PUSH_ENDPOINT_MAX_LENGTH, "Endpoint jest zbyt dlugi"),
});

export const temporaryAccessSchema = z.object({
  userId: requiredString("Uzytkownik"),
  featureName: requiredString("Funkcja"),
  durationMinutes: z.number().int().positive().optional(),
});

// Kontrakt = body z block-time-dialog.tsx i use-schedule-data.ts. Salon
// trasa bierze z sesji (getSalonContext), wiec salonId nie jest czescia body.
const isoDateTime = (fieldName: string) =>
  requiredString(fieldName).refine(
    (v) => !Number.isNaN(Date.parse(v)),
    `${fieldName}: nieprawidlowa data`
  );

export const createTimeBlockSchema = z.object({
  employeeId: uuidId,
  startTime: isoDateTime("Czas rozpoczecia"),
  endTime: isoDateTime("Czas zakonczenia"),
  blockType: z.enum(["break", "vacation", "personal", "holiday", "other"], {
    message: "Nieprawidlowy typ blokady",
  }),
  reason: z.string().max(500).nullable().optional(),
});

export const createWorkScheduleSchema = z.object({
  employeeId: requiredString("Pracownik"),
  schedules: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6, "Dzien tygodnia musi byc 0-6"),
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    isDayOff: z.boolean().optional(),
  })),
});

// ==========================================
// Subscription Mutation Schemas
// ==========================================

export const cancelSubscriptionSchema = z.object({
  reason: z.string().max(500).optional(),
  immediate: z.boolean().default(false),
});

export const renewSubscriptionSchema = z.object({
  planId: z.string().uuid(),
});

// ==========================================
// Client Action Schemas
// ==========================================

export const clientCancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const sendReminderSchema = z.object({
  appointmentId: z.string().uuid(),
  type: z.enum(["sms", "push", "email"]).default("push"),
});

// ==========================================
// Notification Cron Schemas
// ==========================================

/**
 * Schema for POST /api/notifications/birthday — send birthday notifications.
 * Only salonId is required; other fields override saved salon settings.
 */
export const birthdayNotificationSchema = z.object({
  salonId: z.string().uuid("Nieprawidlowy salonId"),
  birthdayDiscount: z.number().min(0).max(100).optional(),
  customMessage: z.string().max(500).optional(),
  giftType: z.enum(["discount", "product"]).optional(),
  productName: z.string().max(200).optional(),
});

/**
 * Schema for POST /api/notifications/low-stock — create a low-stock notification.
 */
export const lowStockNotificationSchema = z.object({
  salonId: z.string().uuid("Nieprawidlowy salonId"),
  productId: z.string().uuid("Nieprawidlowy productId"),
  productName: z.string().min(1, "Nazwa produktu jest wymagana").max(200),
  quantity: z.union([z.string(), z.number()]).optional(),
  minQuantity: z.union([z.string(), z.number()]).optional(),
  unit: z.string().max(50).optional(),
});

/**
 * Schema for POST /api/notifications/we-miss-you — send re-engagement notifications.
 * Only salonId is required; notification settings come from salon's settingsJson.
 */
export const weMissYouNotificationSchema = z.object({
  salonId: z.string().uuid("Nieprawidlowy salonId"),
});

// ==========================================
// UUID Param Validation Helper
// ==========================================

/**
 * Validate a UUID string param. Returns true if valid.
 */
export function isValidUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}
