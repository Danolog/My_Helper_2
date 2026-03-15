/**
 * Server-side validation utilities using Zod 4.
 *
 * Provides structured validation for API endpoints with detailed error responses.
 * Returns field-level error messages in Polish for consistency with the UI.
 */
import { z } from "zod";

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
): { success: false; error: string; details: Record<string, string> } | null {
  const result = schema.safeParse(data);
  if (result.success) return null;

  const details: Record<string, string> = {};
  for (const issue of result.error.issues) {
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
  z.string({ message: `${fieldName} jest wymagane` }).min(1, `${fieldName} jest wymagane`);

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
 * Parse a value to a non-negative number (>= 0) with custom error messages.
 */
const nonNegativeNumberField = (fieldName: string) =>
  z.preprocess(
    (val) => {
      if (typeof val === "number") return val;
      if (typeof val === "string" && val.trim() !== "") return Number(val);
      return undefined;
    },
    z.number({ message: `${fieldName} musi byc liczba` })
      .nonnegative(`${fieldName} nie moze byc ujemna`)
  );

// ==========================================
// API Schemas
// ==========================================

export const createServiceSchema = z.object({
  salonId: requiredString("Salon ID"),
  categoryId: z.string().nullable().optional(),
  name: requiredString("Nazwa"),
  description: z.string().nullable().optional(),
  basePrice: nonNegativeNumberField("Cena"),
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

export const createEmployeeSchema = z.object({
  salonId: requiredString("Salon ID"),
  userId: z.string().nullable().optional(),
  firstName: requiredString("Imie"),
  lastName: requiredString("Nazwisko"),
  phone: phoneField,
  email: emailField,
  photoUrl: z.string().url("Nieprawidlowy URL zdjecia").nullable().optional().or(z.literal("")),
  role: z.string().optional(),
  color: z.string().optional(),
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

export const createAppointmentSchema = z.object({
  salonId: requiredString("Salon ID"),
  clientId: z.string().nullable().optional(),
  employeeId: requiredString("Pracownik"),
  serviceId: z.string().nullable().optional(),
  startTime: requiredString("Czas rozpoczecia").refine(
    (val) => !isNaN(new Date(val).getTime()),
    { message: "Nieprawidlowy format daty rozpoczecia" }
  ),
  endTime: requiredString("Czas zakonczenia").refine(
    (val) => !isNaN(new Date(val).getTime()),
    { message: "Nieprawidlowy format daty zakonczenia" }
  ),
  notes: z.string().nullable().optional(),
  depositAmount: z.string().nullable().optional(),
  bookedByUserId: z.string().nullable().optional(),
  promoCodeId: z.string().nullable().optional(),
  discountAmount: z.union([z.string(), z.number()]).nullable().optional(),
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
});

// ==========================================
// Update Schemas (for PUT/PATCH endpoints)
// All fields are optional since updates are partial.
// ==========================================

/**
 * Schema for PUT /api/appointments/[id] — reschedule or update an appointment.
 * All fields are optional; only provided fields are applied.
 */
export const updateAppointmentSchema = z.object({
  startTime: z.string().refine(
    (val) => !isNaN(new Date(val).getTime()),
    { message: "Nieprawidlowy format daty rozpoczecia" }
  ).optional(),
  endTime: z.string().refine(
    (val) => !isNaN(new Date(val).getTime()),
    { message: "Nieprawidlowy format daty zakonczenia" }
  ).optional(),
  employeeId: z.string().optional(),
  clientId: z.string().nullable().optional(),
  serviceId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
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
});

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
 */
export const createWaitingListSchema = z.object({
  clientId: requiredString("Klient"),
  serviceId: z.string().nullable().optional(),
  preferredEmployeeId: z.string().nullable().optional(),
  preferredDate: z.string().nullable().optional(),
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
