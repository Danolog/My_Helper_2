import { describe, it, expect } from "vitest";
import {
  validateBody,
  createServiceSchema,
  createClientSchema,
  createEmployeeSchema,
  createProductSchema,
  createAppointmentSchema,
  createPromotionSchema,
} from "@/lib/api-validation";
import { z } from "zod";

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
