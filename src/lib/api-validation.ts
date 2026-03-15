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

// ==========================================
// Salon Schemas
// ==========================================

export const createSalonSchema = z.object({
  name: requiredString("Nazwa salonu"),
  phone: z.string().nullable().optional(),
  email: emailField,
  address: z.string().nullable().optional(),
  industryType: z.enum(["hair_salon", "beauty_salon", "nails", "barbershop", "spa", "medical"], {
    message: "Nieprawidlowy typ branzy",
  }).nullable().optional(),
  ownerId: z.string().nullable().optional(),
});

export const birthdaySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  giftType: z.enum(["discount", "product"]).optional(),
  discountPercentage: z.number().min(0).max(100).optional(),
  productName: z.string().optional(),
  customMessage: z.string().optional(),
  autoSend: z.boolean().optional(),
});

export const fiscalSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  connectionType: z.enum(["network", "usb", "serial"]).optional(),
  printerModel: z.string().max(100).optional(),
  ipAddress: z.string().max(45).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  serialPort: z.string().max(50).optional(),
  baudRate: z.number().optional(),
  autoprint: z.boolean().optional(),
  printCopy: z.boolean().optional(),
  nip: z.string().max(13).optional(),
  headerLine1: z.string().max(40).optional(),
  headerLine2: z.string().max(40).optional(),
  headerLine3: z.string().max(40).optional(),
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

export const fiscalReceiptSchema = z.object({
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number().positive(),
    price: z.number().nonnegative(),
    vatRate: z.string().optional(),
  })).min(1, "Wymagana co najmniej jedna pozycja"),
  paymentMethod: z.enum(["cash", "card", "transfer", "mixed"]).optional(),
  nip: z.string().optional(),
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

export const clientConsentsSchema = z.object({
  marketingEmail: z.boolean().optional(),
  marketingSms: z.boolean().optional(),
  marketingPush: z.boolean().optional(),
});

export const loyaltyRedeemSchema = z.object({
  tierId: requiredString("Nagroda"),
  pointsToRedeem: z.number().int().positive("Liczba punktow musi byc wieksza od 0"),
});

export const clientReviewSchema = z.object({
  rating: z.number().int().min(1).max(5, "Ocena musi byc od 1 do 5"),
  comment: z.string().max(2000).optional(),
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

export const createGalleryPhotoSchema = z.object({
  salonId: requiredString("Salon ID"),
  employeeId: z.string().nullable().optional(),
  imageUrl: requiredString("URL zdjecia"),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export const updateGalleryPhotoSchema = z.object({
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  employeeId: z.string().nullable().optional(),
});

// ==========================================
// Payment & Subscription Schemas
// ==========================================

export const depositCreateSessionSchema = z.object({
  appointmentId: requiredString("Wizyta"),
  amount: z.number().positive("Kwota musi byc wieksza od 0"),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export const depositConfirmSchema = z.object({
  sessionId: requiredString("ID sesji"),
});

export const subscriptionCheckoutSchema = z.object({
  salonId: requiredString("Salon ID"),
  planId: requiredString("Plan"),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
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
// Voice AI Schemas
// ==========================================

export const voiceBookSchema = z.object({
  serviceId: z.string().min(1, "serviceId is required"),
  employeeId: z.string().optional(),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format daty: YYYY-MM-DD").optional(),
  preferredTime: z.string().regex(/^\d{2}:\d{2}$/, "Format czasu: HH:MM").optional(),
  callerPhone: z.string().min(1, "callerPhone is required"),
  callerName: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

export const voiceCancelSchema = z.object({
  appointmentId: z.string().optional(),
  callerPhone: z.string().min(1, "callerPhone is required"),
  callerName: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

export const voiceRescheduleSchema = z.object({
  appointmentId: z.string().optional(),
  callerPhone: z.string().min(1, "callerPhone is required"),
  callerName: z.string().max(100).optional(),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format daty: YYYY-MM-DD").optional(),
  preferredTime: z.string().regex(/^\d{2}:\d{2}$/, "Format czasu: HH:MM").optional(),
  notes: z.string().max(500).optional(),
});

export const voiceMessageSchema = z.object({
  callerPhone: z.string().min(1, "callerPhone is required"),
  callerName: z.string().max(100).optional(),
  message: z.string().min(1, "message is required").max(2000),
  conversationId: z.string().optional(),
});

export const voiceIncomingSchema = z.object({
  callerMessage: z.string().min(1, "callerMessage is required"),
  callerPhone: z.string().optional(),
});

export const voiceConfigSchema = z.object({
  enabled: z.boolean(),
  greeting: z.string().max(500).optional(),
  businessHoursOnly: z.boolean().optional(),
  language: z.enum(["pl", "en"]).optional(),
  voiceStyle: z.enum(["professional", "friendly", "warm"]).optional(),
  maxCallDuration: z.number().min(60).max(600).optional(),
  transferToHumanEnabled: z.boolean().optional(),
  transferPhoneNumber: z.string().max(20).optional(),
  capabilities: z.object({
    bookAppointments: z.boolean().optional(),
    checkAvailability: z.boolean().optional(),
    cancelAppointments: z.boolean().optional(),
    rescheduleAppointments: z.boolean().optional(),
    answerFaq: z.boolean().optional(),
  }).optional(),
});

// ==========================================
// Subscription Schemas (additional)
// ==========================================

export const downgradeSubscriptionSchema = z.object({
  targetPlanSlug: z.string().min(1, "targetPlanSlug is required"),
});

export const expirationWarningSchema = z.object({
  warningDays: z.number().int().min(1).max(30).optional(),
  simulate: z.boolean().optional(),
});

// ==========================================
// Client Portal Schemas (additional)
// ==========================================

export const clientWaitingListResponseSchema = z.object({
  accepted: z.boolean({ message: "Pole 'accepted' jest wymagane i musi byc wartoscia logiczna (true/false)" }),
});

export const registerSubscriptionSchema = z.object({
  planSlug: z.string().min(1, "planSlug is required"),
  email: z.string().email("Wprowadz poprawny adres email"),
});

export const sendInvoiceEmailSchema = z.object({
  email: z.string().email("Nieprawidlowy format adresu email").optional(),
});

export const pushSubscribeSchema = z.object({
  endpoint: requiredString("Endpoint"),
  keys: z.object({
    p256dh: requiredString("Klucz p256dh"),
    auth: requiredString("Klucz auth"),
  }),
  salonId: z.string().optional(),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: requiredString("Endpoint"),
});

export const temporaryAccessSchema = z.object({
  userId: requiredString("Uzytkownik"),
  featureName: requiredString("Funkcja"),
  durationMinutes: z.number().int().positive().optional(),
});

export const createTimeBlockSchema = z.object({
  salonId: requiredString("Salon ID"),
  employeeId: requiredString("Pracownik"),
  startTime: requiredString("Czas rozpoczecia"),
  endTime: requiredString("Czas zakonczenia"),
  reason: z.string().nullable().optional(),
  isRecurring: z.boolean().optional(),
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
// Fiscal Test Schema
// ==========================================

export const fiscalTestSchema = z.object({
  apiKey: z.string().min(1),
  endpoint: z.string().url(),
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
