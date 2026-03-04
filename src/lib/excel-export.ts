import ExcelJS from "exceljs";

export interface ExcelSheet {
  name: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
}

/**
 * Creates an Excel workbook buffer from multiple sheets.
 * Each sheet has a name, headers row, and data rows.
 */
export async function createExcelWorkbook(sheets: ExcelSheet[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31)); // Sheet name max 31 chars

    // Add headers
    ws.addRow(sheet.headers);

    // Add data rows
    for (const row of sheet.rows) {
      ws.addRow(row);
    }

    // Set column widths based on content
    ws.columns = sheet.headers.map((h, i) => {
      let maxLen = h.length;
      for (const row of sheet.rows) {
        const cellLen = String(row[i] ?? "").length;
        if (cellLen > maxLen) maxLen = cellLen;
      }
      return { width: Math.min(maxLen + 2, 50) };
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer);
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
