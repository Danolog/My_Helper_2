import * as XLSX from "xlsx";

export interface ExcelSheet {
  name: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
}

/**
 * Creates an Excel workbook buffer from multiple sheets.
 * Each sheet has a name, headers row, and data rows.
 */
export function createExcelWorkbook(sheets: ExcelSheet[]): Uint8Array {
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    // Create data array with headers first
    const data: (string | number | null | undefined)[][] = [
      sheet.headers,
      ...sheet.rows,
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths based on content
    const colWidths: number[] = sheet.headers.map((h) => h.length);
    for (const row of sheet.rows) {
      for (let i = 0; i < row.length; i++) {
        const cellLen = String(row[i] ?? "").length;
        if (cellLen > (colWidths[i] ?? 0)) {
          colWidths[i] = cellLen;
        }
      }
    }
    ws["!cols"] = colWidths.map((w) => ({ wch: Math.min(w + 2, 50) }));

    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31)); // Sheet name max 31 chars
  }

  // Write to Uint8Array (compatible with NextResponse body)
  const buf: Uint8Array = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Uint8Array(buf);
}

/**
 * Creates Excel response headers for download.
 */
export function excelResponseHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${filename}"`,
  };
}
