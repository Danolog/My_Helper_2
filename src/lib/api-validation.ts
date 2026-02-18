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
