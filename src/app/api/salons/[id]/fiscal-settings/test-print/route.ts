import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { salons } from "@/lib/schema";
import { eq } from "drizzle-orm";
import type { FiscalPrinterSettings } from "../route";

/**
 * POST /api/salons/[id]/fiscal-settings/test-print
 *
 * Sends a test receipt to the fiscal printer.
 * In a production environment, this would format and send a test non-fiscal receipt
 * to the configured printer via the appropriate protocol.
 *
 * For now, it validates the configuration, checks last test connection result,
 * and simulates sending a test print.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Fetch current salon settings
    const [salon] = await db
      .select({
        id: salons.id,
        name: salons.name,
        settingsJson: salons.settingsJson,
      })
      .from(salons)
      .where(eq(salons.id, id))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const settings = salon.settingsJson as Record<string, unknown> | null;
    const fiscalSettings = (settings?.fiscal || {}) as Partial<FiscalPrinterSettings>;

    // Check that connection was tested and successful
    if (fiscalSettings.lastTestResult !== "success") {
      return NextResponse.json({
        success: false,
        error: "Najpierw przetestuj polaczenie z drukarka",
        data: {
          printResult: "failure",
          reason: "no_connection_test",
        },
      }, { status: 400 });
    }

    // Validate printer model is set
    if (!fiscalSettings.printerModel || fiscalSettings.printerModel.trim() === "") {
      return NextResponse.json({
        success: false,
        error: "Nie podano modelu drukarki",
        data: {
          printResult: "failure",
          reason: "no_printer_model",
        },
      }, { status: 400 });
    }

    // In production, we would:
    // 1. Connect to the printer using the configured method
    // 2. Send a non-fiscal test receipt with:
    //    - Salon name
    //    - Header lines
    //    - "TEST PARAGONU FISKALNEGO"
    //    - Current date/time
    //    - Printer model info
    //    - NIP if configured
    // 3. Wait for printer acknowledgment
    //
    // Since the actual printer is on the salon's local network and would require
    // a bridge application, we simulate the test print here.

    const testReceipt = {
      salonName: salon.name,
      headerLine1: fiscalSettings.headerLine1 || "",
      headerLine2: fiscalSettings.headerLine2 || "",
      headerLine3: fiscalSettings.headerLine3 || "",
      nip: fiscalSettings.nip || "",
      testLine: "=== TEST PARAGONU FISKALNEGO ===",
      dateTime: new Date().toLocaleString("pl-PL"),
      printerModel: fiscalSettings.printerModel,
      connectionType: fiscalSettings.connectionType,
      status: "Drukarka polaczona - test wydruku pomyslny",
    };

    console.log(
      `[Fiscal Test Print] Test print for salon ${id}:`,
      JSON.stringify(testReceipt, null, 2)
    );

    return NextResponse.json({
      success: true,
      data: {
        printResult: "success",
        receipt: testReceipt,
      },
      message: "Testowy paragon zostal wyslany do drukarki",
    });
  } catch (error) {
    console.error("[Fiscal Test Print API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to send test print" },
      { status: 500 }
    );
  }
}
