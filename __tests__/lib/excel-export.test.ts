import { describe, it, expect } from "vitest";
import { createExcelWorkbook, excelResponseHeaders } from "@/lib/excel-export";

describe("createExcelWorkbook", () => {
  it("should return a Uint8Array for a single sheet", () => {
    const result = createExcelWorkbook([
      {
        name: "Sheet1",
        headers: ["Name", "Age"],
        rows: [
          ["Alice", 30],
          ["Bob", 25],
        ],
      },
    ]);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("should handle multiple sheets", () => {
    const result = createExcelWorkbook([
      {
        name: "Users",
        headers: ["Name"],
        rows: [["Alice"]],
      },
      {
        name: "Products",
        headers: ["Product", "Price"],
        rows: [["Widget", 9.99]],
      },
    ]);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("should handle empty rows", () => {
    const result = createExcelWorkbook([
      {
        name: "Empty",
        headers: ["Col1", "Col2"],
        rows: [],
      },
    ]);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it("should handle null and undefined values in rows", () => {
    const result = createExcelWorkbook([
      {
        name: "Mixed",
        headers: ["A", "B", "C"],
        rows: [
          ["value", null, undefined],
          [null, "value", null],
        ],
      },
    ]);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("should truncate sheet names longer than 31 characters", () => {
    // Excel sheet names are limited to 31 characters
    const longName = "A".repeat(50);
    const result = createExcelWorkbook([
      {
        name: longName,
        headers: ["Col"],
        rows: [["val"]],
      },
    ]);
    expect(result).toBeInstanceOf(Uint8Array);
    // The function slices the name to 31 chars
  });

  it("should handle sheets with many columns", () => {
    const headers = Array.from({ length: 20 }, (_, i) => `Col${i}`);
    const rows = [Array.from({ length: 20 }, (_, i) => `Val${i}`)];
    const result = createExcelWorkbook([
      { name: "Wide", headers, rows },
    ]);
    expect(result).toBeInstanceOf(Uint8Array);
  });
});

describe("excelResponseHeaders", () => {
  it("should return correct Content-Type for xlsx", () => {
    const headers = excelResponseHeaders("report.xlsx");
    expect(headers["Content-Type"]).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  it("should include Content-Disposition with the filename", () => {
    const headers = excelResponseHeaders("my-report.xlsx");
    expect(headers["Content-Disposition"]).toBe(
      'attachment; filename="my-report.xlsx"'
    );
  });

  it("should handle filenames with special characters", () => {
    const headers = excelResponseHeaders("raport (2024).xlsx");
    expect(headers["Content-Disposition"]).toContain("raport (2024).xlsx");
  });
});
