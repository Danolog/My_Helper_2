import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  validateBody,
  createServiceSchema,
  createClientSchema,
  createEmployeeSchema,
  createProductSchema,
  createAppointmentSchema,
  createPromotionSchema,
  depositCreateSessionSchema,
  updateAppointmentSchema,
  createWaitingListSchema,
  updateWaitingListSchema,
  blikDepositSettingsSchema,
  blikBookingSchema,
  isPolishMobileNumber,
  POLISH_MOBILE_PREFIXES,
} from "@/lib/api-validation";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APPOINTMENT_NOTES_MAX_LENGTH } from "@/lib/appointment-limits";

describe("validateBody", () => {
  const simpleSchema = z.object({
    name: z.string().min(1, "Name is required"),
    age: z.number().positive("Age must be positive"),
  });

  it("should return null for valid data", () => {
    const result = validateBody(simpleSchema, { name: "John", age: 25 });
    expect(result).toBeNull();
  });

  it("should return error details for invalid data", () => {
    const result = validateBody(simpleSchema, { name: "", age: -1 });
    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toBe("Validation failed");
    expect(result!.details).toBeDefined();
  });

  it("should return field-specific errors", () => {
    const result = validateBody(simpleSchema, { name: "", age: -1 });
    expect(result!.details.name).toBeDefined();
    expect(result!.details.age).toBeDefined();
  });

  it("should only keep the first error per field", () => {
    // A field that could trigger multiple errors
    const schema = z.object({
      value: z.string().min(3, "Too short").max(5, "Too long"),
    });
    const result = validateBody(schema, { value: "" });
    expect(result!.details.value).toBeDefined();
    // Should have exactly one message for the field
    expect(typeof result!.details.value).toBe("string");
  });

  it("should use _root path for root-level errors", () => {
    const schema = z
      .object({ a: z.string(), b: z.string() })
      .refine((data) => data.a !== data.b, {
        message: "a and b must be different",
      });
    const result = validateBody(schema, { a: "same", b: "same" });
    expect(result!.details._root).toBe("a and b must be different");
  });

  it("should handle nested field paths", () => {
    const schema = z.object({
      nested: z.object({
        field: z.string().min(1, "Required"),
      }),
    });
    const result = validateBody(schema, { nested: { field: "" } });
    expect(result!.details["nested.field"]).toBeDefined();
  });

  it("should return null for missing optional fields", () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });
    const result = validateBody(schema, { required: "yes" });
    expect(result).toBeNull();
  });
});

describe("createServiceSchema", () => {
  const validService = {
    salonId: "salon-123",
    name: "Haircut",
    basePrice: 50,
    baseDuration: 30,
  };

  it("should pass validation for valid service data", () => {
    const result = validateBody(createServiceSchema, validService);
    expect(result).toBeNull();
  });

  it("should fail when salonId is missing", () => {
    const result = validateBody(createServiceSchema, {
      ...validService,
      salonId: "",
    });
    expect(result).not.toBeNull();
    expect(result!.details.salonId).toBeDefined();
  });

  it("should fail when name is missing", () => {
    const result = validateBody(createServiceSchema, {
      ...validService,
      name: "",
    });
    expect(result).not.toBeNull();
    expect(result!.details.name).toBeDefined();
  });

  it("should fail when basePrice is negative", () => {
    const result = validateBody(createServiceSchema, {
      ...validService,
      basePrice: -10,
    });
    expect(result).not.toBeNull();
  });

  // UAT C3: cena poza zakresem numeric(10,2) powinna byc 400, nie 500 z DB
  it("should fail when basePrice exceeds the numeric(10,2) range", () => {
    const result = validateBody(createServiceSchema, {
      ...validService,
      basePrice: 999999999,
    });
    expect(result).not.toBeNull();
    expect(result!.details.basePrice).toBeDefined();
  });

  // UAT X-4: brak limitu dlugosci nazwy
  it("should fail when name is absurdly long", () => {
    const result = validateBody(createServiceSchema, {
      ...validService,
      name: "A".repeat(300),
    });
    expect(result).not.toBeNull();
    expect(result!.details.name).toBeDefined();
  });

  it("should fail when baseDuration is zero", () => {
    const result = validateBody(createServiceSchema, {
      ...validService,
      baseDuration: 0,
    });
    expect(result).not.toBeNull();
  });

  it("should accept string numbers for basePrice via preprocess", () => {
    const result = validateBody(createServiceSchema, {
      ...validService,
      basePrice: "50",
      baseDuration: "30",
    });
    expect(result).toBeNull();
  });

  it("should allow optional categoryId", () => {
    const result = validateBody(createServiceSchema, {
      ...validService,
      categoryId: null,
    });
    expect(result).toBeNull();
  });

  it("should fail when basePrice is empty string (preprocessor returns undefined)", () => {
    const result = validateBody(createServiceSchema, {
      ...validService,
      basePrice: "",
    });
    expect(result).not.toBeNull();
  });

  it("should fail when baseDuration is empty string (preprocessor returns undefined)", () => {
    const result = validateBody(createServiceSchema, {
      ...validService,
      baseDuration: "",
    });
    expect(result).not.toBeNull();
  });

  it("should fail when basePrice is boolean (preprocessor returns undefined for non-number/string)", () => {
    const result = validateBody(createServiceSchema, {
      ...validService,
      basePrice: true,
    });
    expect(result).not.toBeNull();
  });

  it("should fail when basePrice is null (preprocessor returns undefined)", () => {
    const result = validateBody(createServiceSchema, {
      ...validService,
      basePrice: null,
    });
    expect(result).not.toBeNull();
  });
});

describe("createClientSchema", () => {
  const validClient = {
    salonId: "salon-123",
    firstName: "Jan",
    lastName: "Kowalski",
  };

  it("should pass for valid client data", () => {
    expect(validateBody(createClientSchema, validClient)).toBeNull();
  });

  it("should fail when firstName is missing", () => {
    const result = validateBody(createClientSchema, {
      ...validClient,
      firstName: "",
    });
    expect(result).not.toBeNull();
    expect(result!.details.firstName).toBeDefined();
  });

  it("should fail when lastName is missing", () => {
    const result = validateBody(createClientSchema, {
      ...validClient,
      lastName: "",
    });
    expect(result).not.toBeNull();
  });

  it("should accept optional phone and email", () => {
    const result = validateBody(createClientSchema, {
      ...validClient,
      phone: "+48 123 456 789",
      email: "jan@example.com",
    });
    expect(result).toBeNull();
  });

  it("should accept null phone and email", () => {
    const result = validateBody(createClientSchema, {
      ...validClient,
      phone: null,
      email: null,
    });
    expect(result).toBeNull();
  });

  it("should accept empty string phone and email", () => {
    const result = validateBody(createClientSchema, {
      ...validClient,
      phone: "",
      email: "",
    });
    expect(result).toBeNull();
  });

  it("should reject invalid phone format", () => {
    const result = validateBody(createClientSchema, {
      ...validClient,
      phone: "abc",
    });
    expect(result).not.toBeNull();
  });

  it("should accept whitespace-only phone (refine returns true for untrimmed empty)", () => {
    const result = validateBody(createClientSchema, {
      ...validClient,
      phone: "   ",
    });
    expect(result).toBeNull();
  });

  it("should accept phone with dots (dots are allowed by regex)", () => {
    const result = validateBody(createClientSchema, {
      ...validClient,
      phone: "+48.123.456.789",
    });
    expect(result).toBeNull();
  });
});

describe("createEmployeeSchema", () => {
  const validEmployee = {
    salonId: "salon-123",
    firstName: "Anna",
    lastName: "Nowak",
  };

  it("should pass for valid employee data", () => {
    expect(validateBody(createEmployeeSchema, validEmployee)).toBeNull();
  });

  it("should fail when salonId is empty", () => {
    const result = validateBody(createEmployeeSchema, {
      ...validEmployee,
      salonId: "",
    });
    expect(result).not.toBeNull();
  });

  it("should accept optional photoUrl", () => {
    const result = validateBody(createEmployeeSchema, {
      ...validEmployee,
      photoUrl: "https://example.com/photo.jpg",
    });
    expect(result).toBeNull();
  });

  it("should accept empty string photoUrl", () => {
    const result = validateBody(createEmployeeSchema, {
      ...validEmployee,
      photoUrl: "",
    });
    expect(result).toBeNull();
  });

  it("should accept null photoUrl", () => {
    const result = validateBody(createEmployeeSchema, {
      ...validEmployee,
      photoUrl: null,
    });
    expect(result).toBeNull();
  });
});

describe("createProductSchema", () => {
  const validProduct = {
    salonId: "salon-123",
    name: "Shampoo",
  };

  it("should pass for minimal valid product data", () => {
    expect(validateBody(createProductSchema, validProduct)).toBeNull();
  });

  it("should accept numeric quantity", () => {
    const result = validateBody(createProductSchema, {
      ...validProduct,
      quantity: 10,
    });
    expect(result).toBeNull();
  });

  it("should accept string quantity", () => {
    const result = validateBody(createProductSchema, {
      ...validProduct,
      quantity: "10",
    });
    expect(result).toBeNull();
  });

  it("should reject negative quantity", () => {
    const result = validateBody(createProductSchema, {
      ...validProduct,
      quantity: -5,
    });
    expect(result).not.toBeNull();
  });

  it("should accept null quantity", () => {
    const result = validateBody(createProductSchema, {
      ...validProduct,
      quantity: null,
    });
    expect(result).toBeNull();
  });

  it("should accept empty string quantity (refine returns true for empty)", () => {
    const result = validateBody(createProductSchema, {
      ...validProduct,
      quantity: "",
    });
    expect(result).toBeNull();
  });

  it("should reject non-numeric string quantity 'abc'", () => {
    const result = validateBody(createProductSchema, {
      ...validProduct,
      quantity: "abc",
    });
    expect(result).not.toBeNull();
  });

  it("should reject negative string quantity '-5'", () => {
    const result = validateBody(createProductSchema, {
      ...validProduct,
      quantity: "-5",
    });
    expect(result).not.toBeNull();
  });

  it("should accept empty string minQuantity", () => {
    const result = validateBody(createProductSchema, {
      ...validProduct,
      minQuantity: "",
    });
    expect(result).toBeNull();
  });

  it("should reject non-numeric string minQuantity 'abc'", () => {
    const result = validateBody(createProductSchema, {
      ...validProduct,
      minQuantity: "abc",
    });
    expect(result).not.toBeNull();
  });

  it("should accept empty string pricePerUnit", () => {
    const result = validateBody(createProductSchema, {
      ...validProduct,
      pricePerUnit: "",
    });
    expect(result).toBeNull();
  });

  it("should reject non-numeric string pricePerUnit 'abc'", () => {
    const result = validateBody(createProductSchema, {
      ...validProduct,
      pricePerUnit: "abc",
    });
    expect(result).not.toBeNull();
  });

  it("should reject negative string pricePerUnit '-1'", () => {
    const result = validateBody(createProductSchema, {
      ...validProduct,
      pricePerUnit: "-1",
    });
    expect(result).not.toBeNull();
  });
});

describe("createAppointmentSchema", () => {
  const validAppointment = {
    salonId: "salon-123",
    employeeId: "emp-456",
    startTime: "2024-01-15T10:00:00Z",
    endTime: "2024-01-15T11:00:00Z",
  };

  it("should pass for valid appointment data", () => {
    expect(validateBody(createAppointmentSchema, validAppointment)).toBeNull();
  });

  it("should fail when endTime is before startTime", () => {
    const result = validateBody(createAppointmentSchema, {
      ...validAppointment,
      startTime: "2024-01-15T11:00:00Z",
      endTime: "2024-01-15T10:00:00Z",
    });
    expect(result).not.toBeNull();
    expect(result!.details.endTime).toBeDefined();
  });

  it("should fail when employeeId is missing", () => {
    const result = validateBody(createAppointmentSchema, {
      ...validAppointment,
      employeeId: "",
    });
    expect(result).not.toBeNull();
  });

  it("should fail when startTime is invalid date", () => {
    const result = validateBody(createAppointmentSchema, {
      ...validAppointment,
      startTime: "not-a-date",
    });
    expect(result).not.toBeNull();
  });

  it("should accept optional clientId", () => {
    const result = validateBody(createAppointmentSchema, {
      ...validAppointment,
      clientId: null,
    });
    expect(result).toBeNull();
  });

  it("should accept optional notes", () => {
    const result = validateBody(createAppointmentSchema, {
      ...validAppointment,
      notes: "Special request",
    });
    expect(result).toBeNull();
  });

  it("should fail on startTime required check when startTime is missing but endTime is present", () => {
    // The refine on line 198 returns true early when startTime is falsy,
    // but the field-level required check on startTime still fails.
    const result = validateBody(createAppointmentSchema, {
      salonId: "salon-123",
      employeeId: "emp-456",
      endTime: "2024-01-15T11:00:00Z",
    });
    expect(result).not.toBeNull();
    expect(result!.details.startTime).toBeDefined();
  });
});

describe("createPromotionSchema", () => {
  const validPromotion = {
    salonId: "salon-123",
    name: "Weekend Special",
    type: "percentage" as const,
    value: 20,
  };

  it("should pass for valid promotion data", () => {
    expect(validateBody(createPromotionSchema, validPromotion)).toBeNull();
  });

  // UAT X-3: data konca wczesniejsza niz startu musi byc odrzucona
  it("should fail when endDate is before startDate", () => {
    const result = validateBody(createPromotionSchema, {
      ...validPromotion,
      startDate: "2026-08-31",
      endDate: "2026-08-01",
    });
    expect(result).not.toBeNull();
    expect(result!.details.endDate).toBeDefined();
  });

  it("should pass when endDate is after startDate", () => {
    const result = validateBody(createPromotionSchema, {
      ...validPromotion,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    expect(result).toBeNull();
  });

  it("should fail for invalid promotion type", () => {
    const result = validateBody(createPromotionSchema, {
      ...validPromotion,
      type: "invalid_type",
    });
    expect(result).not.toBeNull();
  });

  it("should accept all valid promotion types", () => {
    const types = [
      "percentage",
      "fixed",
      "package",
      "buy2get1",
      "happy_hours",
      "first_visit",
    ];
    for (const type of types) {
      const result = validateBody(createPromotionSchema, {
        ...validPromotion,
        type,
      });
      expect(result).toBeNull();
    }
  });

  it("should accept string value via preprocess", () => {
    const result = validateBody(createPromotionSchema, {
      ...validPromotion,
      value: "20",
    });
    expect(result).toBeNull();
  });

  it("should fail when value is not a number", () => {
    const result = validateBody(createPromotionSchema, {
      ...validPromotion,
      value: "abc",
    });
    expect(result).not.toBeNull();
  });

  it("should accept optional dates", () => {
    const result = validateBody(createPromotionSchema, {
      ...validPromotion,
      startDate: "2024-01-01",
      endDate: "2024-01-31",
    });
    expect(result).toBeNull();
  });

  it("should accept optional applicableServiceIds array", () => {
    const result = validateBody(createPromotionSchema, {
      ...validPromotion,
      applicableServiceIds: ["svc-1", "svc-2"],
    });
    expect(result).toBeNull();
  });
});

// #66 (P3 Ryana z #67): daty ISO 8601 i limit uwag — jak w create-session.
describe("createAppointmentSchema — daty ISO i limit uwag (#66)", () => {
  const base = {
    salonId: "salon-123",
    employeeId: "emp-456",
    startTime: "2026-12-01T10:00:00.000Z",
    endTime: "2026-12-01T11:00:00.000Z",
  };
  const parse = (extra: Record<string, unknown>) => createAppointmentSchema.safeParse({ ...base, ...extra });

  it.each([
    "2026-12-01T10:00:00.000Z", // toISOString() — portal i panel
    "2026-12-01T10:00:00Z",
    "2026-12-01T10:00:00+01:00",
    "2026-12-01T10:00+01:00",
  ])("przyjmuje ISO %s", (startTime) => {
    expect(parse({ startTime }).success).toBe(true);
  });

  it.each([
    "jutro o 10", // Date.parse: rok 2010 — przechodziło przed #66
    "December 1, 2026 10:00",
    "2026-12-01", // sama data, bez godziny
    "01.12.2026 10:00",
    "2026-13-45T10:00:00Z", // kształt ISO, ale nie data
    // Follow-up #71 (Ethan): bez strefy Date.parse czyta czas serwera (UTC na Vercelu).
    "2026-12-01T10:00",
    "2026-12-01T10:00:00",
    "2026-12-01T10:00:00.000",
    "2026-12-01T10:00:00+0100", // offset bez dwukropka
  ])("odrzuca nie-ISO %s (startTime i endTime)", (value) => {
    const start = parse({ startTime: value });
    const end = parse({ endTime: value });
    expect(start.success).toBe(false);
    expect(end.success).toBe(false);
    expect(start.error!.issues[0]!.path).toEqual(["startTime"]);
    expect(start.error!.issues[0]!.message).toMatch(/nieprawidłowy format daty/);
  });

  it("brak startTime → 'jest wymagane'", () => {
    const r = parse({ startTime: undefined });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toMatch(/jest wymagane/);
  });

  it("uwagi: 1000 znaków przechodzi, 1001 nie", () => {
    expect(parse({ notes: "a".repeat(1000) }).success).toBe(true);
    const r = parse({ notes: "a".repeat(1001) });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(["notes"]);
    expect(r.error!.issues[0]!.message).toBe("Uwagi mogą mieć maks. 1000 znaków");
  });

  it("uwagi: null, '' i same spacje = brak uwag (undefined)", () => {
    for (const notes of [null, "", "   "]) {
      const r = parse({ notes });
      expect(r.success).toBe(true);
      expect(r.data!.notes).toBeUndefined();
    }
  });
});

// Follow-up #71: strefa wymagana także w create-session (ten sam isoDateString).
describe("depositCreateSessionSchema — data bez strefy (follow-up #71)", () => {
  const base = {
    salonId: "11111111-1111-4111-8111-111111111111",
    employeeId: "22222222-2222-4222-8222-222222222222",
    startTime: "2026-12-01T10:00:00.000Z",
    endTime: "2026-12-01T11:00:00.000Z",
    depositAmount: 30,
  };

  it("toISOString() przechodzi (kontrola, że baza testu jest poprawna)", () => {
    expect(depositCreateSessionSchema.safeParse(base).success).toBe(true);
  });

  it.each(["startTime", "endTime"])("%s bez strefy → błąd na tym polu", (field) => {
    const r = depositCreateSessionSchema.safeParse({ ...base, [field]: "2026-12-01T10:00:00" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual([field]);
  });
});

// Follow-up #71 (Ethan): PUT /api/appointments/[id] — limit i normalizacja notatek.
describe("updateAppointmentSchema — notatki (follow-up #71)", () => {
  const parse = (body: Record<string, unknown>) => updateAppointmentSchema.safeParse(body);

  it("limit to ta sama stała co w POST i w polach dialogów", () => {
    expect(APPOINTMENT_NOTES_MAX_LENGTH).toBe(1000);
  });

  it("1000 znaków przechodzi, 1001 nie (komunikat jak w POST)", () => {
    expect(parse({ notes: "a".repeat(1000) }).success).toBe(true);
    const r = parse({ notes: "a".repeat(1001) });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(["notes"]);
    expect(r.error!.issues[0]!.message).toBe("Uwagi mogą mieć maks. 1000 znaków");
  });

  it.each([null, "", "   "])("notes = %j → null (wyczyść notatki)", (notes) => {
    const r = parse({ notes });
    expect(r.success).toBe(true);
    expect(r.data!.notes).toBeNull();
  });

  it("brak pola notes → undefined (trasa nie dotyka notatek)", () => {
    const r = parse({ status: "confirmed" });
    expect(r.success).toBe(true);
    expect(r.data!.notes).toBeUndefined();
    expect("notes" in r.data!).toBe(false);
  });

  it("notatka z treścią zapisuje się bez zmian (bez trim)", () => {
    const r = parse({ notes: "  alergia na lateks " });
    expect(r.success).toBe(true);
    expect(r.data!.notes).toBe("  alergia na lateks ");
  });

  it("notes nie-napis → błąd", () => {
    expect(parse({ notes: 123 }).success).toBe(false);
  });
});

// Follow-up #71 (Ethan): pola notatek w panelu nie przepuszczą tekstu, który API odrzuci.
describe("dialogi wizyt — maxLength notatek (follow-up #71)", () => {
  it.each([
    ["src/components/appointments/new-appointment-dialog.tsx", "appointment-notes-input"],
    ["src/components/appointments/edit-appointment-dialog.tsx", "edit-appointment-notes-input"],
  ])("%s: pole %s ma maxLength = APPOINTMENT_NOTES_MAX_LENGTH", (file, testId) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    const field = src.slice(0, src.indexOf(`data-testid="${testId}"`));
    const tag = field.slice(Math.max(field.lastIndexOf("<Input"), field.lastIndexOf("<Textarea")));
    expect(tag).toMatch(/maxLength=\{APPOINTMENT_NOTES_MAX_LENGTH\}/);
    expect(src).toMatch(/import \{ APPOINTMENT_NOTES_MAX_LENGTH \} from "@\/lib\/appointment-limits"/);
  });
});

// #95: PUT /api/appointments/[id] — daty jak w POST (ISO ze strefą).
describe("updateAppointmentSchema — startTime/endTime ze strefą (#95)", () => {
  const parse = (body: Record<string, unknown>) => updateAppointmentSchema.safeParse(body);

  it.each(["2026-04-01T10:00:00Z", "2026-04-01T10:00:00.000Z", "2026-04-01T10:00+02:00", "2026-04-01T10:00:00-05:30"])(
    "%s przechodzi",
    (v) => {
      expect(parse({ startTime: v, endTime: v }).success).toBe(true);
    }
  );

  it.each([
    ["bez strefy", "2026-04-01T10:00:00"],
    ["bez strefy, bez sekund", "2026-04-01T10:00"],
    ["sama data", "2026-04-01"],
    ["tekst daty", "April 1, 2026 10:00"],
    ["pusty", ""],
    ["niemożliwa godzina", "2026-04-01T25:00:00Z"],
  ])("startTime %s => błąd na polu startTime", (_name, v) => {
    const r = parse({ startTime: v });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(["startTime"]);
  });

  it("endTime bez strefy => błąd na polu endTime, komunikat jak w POST", () => {
    const r = parse({ startTime: "2026-04-01T10:00:00Z", endTime: "2026-04-01T11:00:00" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(["endTime"]);
    expect(r.error!.issues[0]!.message).toBe("Czas zakonczenia: nieprawidłowy format daty");
  });

  it("brak dat (np. zmiana samych notatek) przechodzi", () => {
    expect(parse({ notes: "x" }).success).toBe(true);
  });
});

// #95: nieistniejący dzień i godzina 24 — Date.parse je przewija zamiast odrzucić.
// Ten sam isoDateString w POST, create-session i PUT, więc test na każdym schemacie.
describe("isoDateString — nieistniejące daty (#95)", () => {
  const post = {
    salonId: "salon-123",
    employeeId: "emp-456",
    startTime: "2026-12-01T10:00:00.000Z",
    endTime: "2026-12-01T11:00:00.000Z",
  };
  const session = {
    salonId: "11111111-1111-4111-8111-111111111111",
    employeeId: "22222222-2222-4222-8222-222222222222",
    startTime: "2026-12-01T10:00:00.000Z",
    endTime: "2026-12-01T11:00:00.000Z",
    depositAmount: 30,
  };
  const schemas = [
    ["POST", (b: Record<string, unknown>) => createAppointmentSchema.safeParse({ ...post, ...b })],
    ["create-session", (b: Record<string, unknown>) => depositCreateSessionSchema.safeParse({ ...session, ...b })],
    ["PUT", (b: Record<string, unknown>) => updateAppointmentSchema.safeParse(b)],
  ] as const;

  const impossible = [
    "2026-02-30T10:00:00Z", // Date.parse => 2 marca
    "2026-04-31T10:00:00.000Z", // => 1 maja
    "2026-13-01T10:00:00Z",
    "2026-00-10T10:00:00Z",
    "2026-04-00T10:00:00Z",
    "2027-02-29T10:00:00Z", // 2027 nie jest przestępny
    "2026-04-01T24:00:00Z", // Date.parse => północ 2 kwietnia
    "2026-04-01T23:60:00Z",
    "2026-04-01T23:59:60Z",
  ];

  for (const [name, parse] of schemas) {
    it.each(impossible)(`${name}: %s => błąd na startTime i endTime`, (value) => {
      for (const field of ["startTime", "endTime"]) {
        const r = parse({ [field]: value });
        expect(r.success).toBe(false);
        expect(r.error!.issues[0]!.path).toEqual([field]);
        expect(r.error!.issues[0]!.message).toMatch(/nieprawidłowy format daty/);
      }
    });

    it.each([
      "2028-02-29T10:00:00Z", // przestępny
      "2026-04-30T23:59:59.999Z",
      "2026-12-31T00:00:00Z",
      // Dzień w napisie istnieje, choć w UTC to już inny dzień — offset nie myli kontroli.
      "2026-03-01T00:30:00+02:00",
      "2026-02-28T23:30:00-05:00",
    ])(`${name}: %s przechodzi jako startTime i jako endTime`, (value) => {
      // Druga data poza zakresem przypadków, żeby nie złapać refine end > start.
      expect(parse({ startTime: value, endTime: "2030-01-01T00:00:00Z" }).success).toBe(true);
      expect(parse({ startTime: "2020-01-01T00:00:00Z", endTime: value }).success).toBe(true);
    });
  }
});

describe("createWaitingListSchema — potwierdzenie prośby klienta (#221)", () => {
  const CONFIRM_MESSAGE = "Potwierdź, że klient sam poprosił o zapis na listę oczekujących.";
  const base = {
    clientId: "33333333-3333-4333-8333-333333333333",
    serviceId: "44444444-4444-4444-8444-444444444444",
    preferredEmployeeId: null,
    preferredDate: "2026-12-01T10:00:00Z",
  };

  it("komplet pól z clientRequestConfirmed: true przechodzi", () => {
    expect(validateBody(createWaitingListSchema, { ...base, clientRequestConfirmed: true })).toBeNull();
  });

  it("samo clientId z potwierdzeniem przechodzi", () => {
    expect(
      validateBody(createWaitingListSchema, { clientId: base.clientId, clientRequestConfirmed: true })
    ).toBeNull();
  });

  it.each([
    ["brak pola", undefined],
    ["false", false],
    ['"true"', "true"],
    ["1", 1],
    ["null", null],
  ])("clientRequestConfirmed: %s → błąd z komunikatem potwierdzenia", (_label, value) => {
    const body: Record<string, unknown> = { ...base };
    if (value !== undefined) body.clientRequestConfirmed = value;
    const result = validateBody(createWaitingListSchema, body);
    expect(result).not.toBeNull();
    expect(result!.details.clientRequestConfirmed).toBe(CONFIRM_MESSAGE);
  });

  it.each([
    ["source", "client_portal"],
    ["source", "staff"],
    ["createdByUserId", "inny-uzytkownik"],
    ["clientRequestConfirmedAt", "2026-11-01T10:00:00Z"],
    ["nieznanePole", "x"],
  ])("pole %s = %s w treści → błąd", (field, value) => {
    const result = validateBody(createWaitingListSchema, {
      ...base,
      clientRequestConfirmed: true,
      [field]: value,
    });
    expect(result).not.toBeNull();
  });
});

describe("updateWaitingListSchema — bez pól źródła i potwierdzenia (#221)", () => {
  it("wynik parsowania nie zawiera pól źródła ani potwierdzenia", () => {
    const result = updateWaitingListSchema.safeParse({
      accepted: true,
      source: "client_portal",
      clientRequestConfirmedAt: null,
      createdByUserId: "inny",
      clientRequestConfirmed: false,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ accepted: true });
  });
});

describe("blikDepositSettingsSchema — numer BLIK salonu", () => {
  // Numery fikcyjne; pozytywne muszą być w zakresie komórkowym.
  it.each(POLISH_MOBILE_PREFIXES)("prefiks komórkowy %s przechodzi", (prefix) => {
    const result = blikDepositSettingsSchema.safeParse({
      blikPhone: `${prefix}0 000 000`,
      consent: true,
    });
    expect(result.success).toBe(true);
    expect(result.data?.blikPhone).toBe(`+48${prefix}0000000`);
  });

  it.each(["22", "58", "61", "71", "81", "70", "80", "00", "52"])(
    "prefiks %s (stacjonarny/specjalny) jest odrzucany",
    (prefix) => {
      const result = blikDepositSettingsSchema.safeParse({
        blikPhone: `+48 ${prefix}0 000 000`,
        consent: true,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(["blikPhone"]);
    }
  );

  it("normalizuje spacje, myślniki i nawiasy jak guestPhone", () => {
    const result = blikDepositSettingsSchema.safeParse({
      blikPhone: "(+48) 600-100-200",
      consent: true,
    });
    expect(result.data?.blikPhone).toBe("+48600100200");
  });

  it("null i pusty napis = wyłączenie, bez wymogu zgody", () => {
    expect(blikDepositSettingsSchema.safeParse({ blikPhone: null }).data).toEqual({
      blikPhone: null,
    });
    expect(blikDepositSettingsSchema.safeParse({ blikPhone: "  " }).data).toEqual({
      blikPhone: null,
    });
  });

  it("numer bez consent: true jest odrzucany na polu consent", () => {
    const result = blikDepositSettingsSchema.safeParse({ blikPhone: "600100200" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path)).toEqual([["consent"]]);
  });

  it("brak klucza blikPhone jest błędem (nie kasuje po cichu)", () => {
    expect(blikDepositSettingsSchema.safeParse({ consent: true }).success).toBe(false);
  });

  it("blikConsentAt z body jest wycinany ze sparsowanych danych", () => {
    const result = blikDepositSettingsSchema.safeParse({
      blikPhone: "600100200",
      consent: true,
      blikConsentAt: "2020-01-01T00:00:00.000Z",
    });
    expect(result.data).not.toHaveProperty("blikConsentAt");
  });

  it("komunikaty błędów nie zawierają numeru", () => {
    const result = blikDepositSettingsSchema.safeParse({ blikPhone: "+48 71 000 00 00" });
    expect(JSON.stringify(result.error?.issues)).not.toMatch(/71\s?000/);
  });

  it("isPolishMobileNumber przyjmuje tylko E.164 +48", () => {
    expect(isPolishMobileNumber("+48600100200")).toBe(true);
    expect(isPolishMobileNumber("600100200")).toBe(false);
    expect(isPolishMobileNumber("+4860010020")).toBe(false);
  });
});

describe("blikBookingSchema — rezerwacja z zadatkiem BLIK", () => {
  const valid = {
    salonId: "11111111-1111-4111-8111-111111111111",
    employeeId: "22222222-2222-4222-8222-222222222222",
    serviceId: "44444444-4444-4444-8444-444444444444",
    startTime: "2026-12-01T10:00:00.000Z",
    endTime: "2026-12-01T11:00:00.000Z",
    depositAmount: 50,
    guestName: "Jan Testowy",
    guestPhone: "+48 000 600 700",
  };

  it("poprawna rezerwacja: telefon gościa w E.164, null/\"\" → undefined", () => {
    const result = blikBookingSchema.safeParse({ ...valid, variantId: null, clientId: "", guestEmail: null });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ guestPhone: "+48000600700", depositAmount: 50 });
    expect(result.data?.variantId).toBeUndefined();
    expect(result.data?.clientId).toBeUndefined();
  });

  it("kwota jako napis jest parsowana do liczby", () => {
    expect(blikBookingSchema.safeParse({ ...valid, depositAmount: "50.00" }).data?.depositAmount).toBe(50);
  });

  it("paymentMethod i blikPhoneNumber nie należą do kontraktu (wycinane)", () => {
    const result = blikBookingSchema.safeParse({ ...valid, paymentMethod: "blik", blikPhoneNumber: "000600701" });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("paymentMethod");
    expect(result.data).not.toHaveProperty("blikPhoneNumber");
  });

  it.each([
    ["brak serviceId", { serviceId: undefined }, "serviceId"],
    ["zły employeeId", { employeeId: "abc" }, "employeeId"],
    ["kwota ujemna", { depositAmount: -1 }, "depositAmount"],
    ["data spoza ISO", { startTime: "jutro o 10" }, "startTime"],
    ["koniec = początek", { endTime: "2026-12-01T10:00:00.000Z" }, "endTime"],
    ["zły telefon gościa", { guestPhone: "12345" }, "guestPhone"],
  ])("%s → błąd na polu %s", (_n, patch, field) => {
    const result = blikBookingSchema.safeParse({ ...valid, ...patch });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0])).toContain(field);
  });
});
