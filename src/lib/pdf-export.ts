"use client";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface PDFReportOptions {
  title: string;
  subtitle?: string;
  dateRange?: { from: string; to: string } | undefined;
  summaryCards?: Array<{ label: string; value: string }>;
  tables?: Array<{
    title: string;
    headers: string[];
    rows: string[][];
    footerRow?: string[];
  }>;
  filename: string;
}

/**
 * Generate a PDF report from structured data.
 * Uses jsPDF + jspdf-autotable for table rendering.
 */
export function generateReportPDF(options: PDFReportOptions): void {
  const {
    title,
    subtitle,
    dateRange,
    summaryCards,
    tables,
    filename,
  } = options;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let yPos = 15;

  // Title
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(title, pageWidth / 2, yPos, { align: "center" });
  yPos += 8;

  // Subtitle
  if (subtitle) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text(subtitle, pageWidth / 2, yPos, { align: "center" });
    doc.setTextColor(0, 0, 0);
    yPos += 6;
  }

  // Date range
  if (dateRange) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 80);
    const dateText = `Okres: ${formatDatePL(dateRange.from)} - ${formatDatePL(dateRange.to)}`;
    doc.text(dateText, pageWidth / 2, yPos, { align: "center" });
    doc.setTextColor(0, 0, 0);
    yPos += 4;
  }

  // Generation timestamp
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(
    `Wygenerowano: ${new Date().toLocaleString("pl-PL")}`,
    pageWidth / 2,
    yPos,
    { align: "center" }
  );
  doc.setTextColor(0, 0, 0);
  yPos += 8;

  // Separator line
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.line(14, yPos, pageWidth - 14, yPos);
  yPos += 8;

  // Summary cards
  if (summaryCards && summaryCards.length > 0) {
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Podsumowanie", 14, yPos);
    yPos += 6;

    const cardWidth = (pageWidth - 28 - (summaryCards.length - 1) * 4) / Math.min(summaryCards.length, 4);
    const cardsPerRow = Math.min(summaryCards.length, 4);

    for (let i = 0; i < summaryCards.length; i += cardsPerRow) {
      const rowCards = summaryCards.slice(i, i + cardsPerRow);

      for (const card of rowCards) {
        const j = rowCards.indexOf(card);
        const x = 14 + j * (cardWidth + 4);

        // Card background
        doc.setFillColor(245, 245, 245);
        doc.roundedRect(x, yPos, cardWidth, 18, 2, 2, "F");

        // Card label
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 100, 100);
        doc.text(card.label, x + cardWidth / 2, yPos + 6, { align: "center" });

        // Card value
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(0, 0, 0);
        doc.text(card.value, x + cardWidth / 2, yPos + 14, { align: "center" });
      }

      yPos += 24;
    }

    yPos += 4;
  }

  // Tables
  if (tables && tables.length > 0) {
    for (const table of tables) {
      // Check if we need a new page
      if (yPos > 250) {
        doc.addPage();
        yPos = 15;
      }

      // Table title
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0, 0, 0);
      doc.text(table.title, 14, yPos);
      yPos += 4;

      // Generate table
      autoTable(doc, {
        startY: yPos,
        head: [table.headers],
        body: table.rows,
        ...(table.footerRow ? { foot: [table.footerRow] } : {}),
        theme: "striped",
        headStyles: {
          fillColor: [41, 128, 185],
          textColor: [255, 255, 255],
          fontStyle: "bold",
          fontSize: 9,
          halign: "center",
        },
        bodyStyles: {
          fontSize: 9,
          cellPadding: 3,
        },
        footStyles: {
          fillColor: [220, 220, 220],
          textColor: [0, 0, 0],
          fontStyle: "bold",
          fontSize: 9,
        },
        alternateRowStyles: {
          fillColor: [248, 249, 250],
        },
        columnStyles: getColumnStyles(table.headers.length),
        margin: { left: 14, right: 14 },
        didDrawPage: () => {
          // Footer on each page
          const pageCount = doc.getNumberOfPages();
          doc.setFontSize(8);
          doc.setTextColor(150, 150, 150);
          doc.text(
            `Strona ${pageCount}`,
            pageWidth / 2,
            doc.internal.pageSize.getHeight() - 10,
            { align: "center" }
          );
          doc.text(
            "MyHelper - Raport",
            14,
            doc.internal.pageSize.getHeight() - 10
          );
        },
      });

      // Get the final Y position after the table
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      yPos = (doc as any).lastAutoTable?.finalY + 10 || yPos + 40;
    }
  }

  // Save
  doc.save(filename);
}

function formatDatePL(dateStr: string): string {
  if (!dateStr) return "-";
  try {
    return new Date(dateStr + "T12:00:00").toLocaleDateString("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function getColumnStyles(columnCount: number): Record<number, { halign: "left" | "center" | "right" }> {
  const styles: Record<number, { halign: "left" | "center" | "right" }> = {};
  // First column left-aligned, rest right-aligned
  styles[0] = { halign: "left" };
  for (let i = 1; i < columnCount; i++) {
    styles[i] = { halign: "right" };
  }
  return styles;
}
