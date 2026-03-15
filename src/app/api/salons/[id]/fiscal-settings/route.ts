import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { salons } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

export interface FiscalPrinterSettings {
  enabled: boolean;
  connectionType: "network" | "usb" | "serial";
  printerModel: string;
  ipAddress: string;
  port: number;
  serialPort: string;
  baudRate: number;
  autoprint: boolean;
  printCopy: boolean;
  nip: string; // NIP (tax ID) for fiscal receipts
  headerLine1: string;
  headerLine2: string;
  headerLine3: string;
  lastTestAt: string | null;
  lastTestResult: "success" | "failure" | null;
  lastTestError: string | null;
}

const DEFAULT_FISCAL_SETTINGS: FiscalPrinterSettings = {
  enabled: false,
  connectionType: "network",
  printerModel: "",
  ipAddress: "",
  port: 9100,
  serialPort: "",
  baudRate: 9600,
  autoprint: false,
  printCopy: false,
  nip: "",
  headerLine1: "",
  headerLine2: "",
  headerLine3: "",
  lastTestAt: null,
  lastTestResult: null,
  lastTestError: null,
};

/**
 * GET /api/salons/[id]/fiscal-settings
 *
 * Returns the fiscal printer configuration for a salon.
 * Reads from the salon's settingsJson field under the "fiscal" key.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    const [salon] = await db
      .select({ id: salons.id, settingsJson: salons.settingsJson })
      .from(salons)
      .where(eq(salons.id, id))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    // Extract fiscal settings from settingsJson, merge with defaults
    const settings = salon.settingsJson as Record<string, unknown> | null;
    const fiscalSettings: FiscalPrinterSettings = {
      ...DEFAULT_FISCAL_SETTINGS,
      ...((settings?.fiscal as Partial<FiscalPrinterSettings>) || {}),
    };

    return NextResponse.json({
      success: true,
      data: fiscalSettings,
    });
  } catch (error) {
    console.error("[Fiscal Settings API] GET Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch fiscal settings" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/salons/[id]/fiscal-settings
 *
 * Updates the fiscal printer configuration for a salon.
 * Saves into the salon's settingsJson field under the "fiscal" key.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;
    const body = await request.json();

    // Fetch current salon
    const [salon] = await db
      .select({ id: salons.id, settingsJson: salons.settingsJson })
      .from(salons)
      .where(eq(salons.id, id))
      .limit(1);

    if (!salon) {
      return NextResponse.json(
        { success: false, error: "Salon not found" },
        { status: 404 }
      );
    }

    const {
      enabled,
      connectionType,
      printerModel,
      ipAddress,
      port,
      serialPort,
      baudRate,
      autoprint,
      printCopy,
      nip,
      headerLine1,
      headerLine2,
      headerLine3,
    } = body;

    // Build validated settings
    const newFiscalSettings: FiscalPrinterSettings = {
      enabled: typeof enabled === "boolean" ? enabled : DEFAULT_FISCAL_SETTINGS.enabled,
      connectionType:
        typeof connectionType === "string" &&
        ["network", "usb", "serial"].includes(connectionType)
          ? (connectionType as "network" | "usb" | "serial")
          : DEFAULT_FISCAL_SETTINGS.connectionType,
      printerModel:
        typeof printerModel === "string"
          ? printerModel.trim().slice(0, 100)
          : DEFAULT_FISCAL_SETTINGS.printerModel,
      ipAddress:
        typeof ipAddress === "string"
          ? ipAddress.trim().slice(0, 45)
          : DEFAULT_FISCAL_SETTINGS.ipAddress,
      port:
        typeof port === "number" && port >= 1 && port <= 65535
          ? Math.round(port)
          : DEFAULT_FISCAL_SETTINGS.port,
      serialPort:
        typeof serialPort === "string"
          ? serialPort.trim().slice(0, 50)
          : DEFAULT_FISCAL_SETTINGS.serialPort,
      baudRate:
        typeof baudRate === "number" &&
        [9600, 19200, 38400, 57600, 115200].includes(baudRate)
          ? baudRate
          : DEFAULT_FISCAL_SETTINGS.baudRate,
      autoprint:
        typeof autoprint === "boolean"
          ? autoprint
          : DEFAULT_FISCAL_SETTINGS.autoprint,
      printCopy:
        typeof printCopy === "boolean"
          ? printCopy
          : DEFAULT_FISCAL_SETTINGS.printCopy,
      nip:
        typeof nip === "string"
          ? nip.replace(/[^0-9-]/g, "").slice(0, 13)
          : DEFAULT_FISCAL_SETTINGS.nip,
      headerLine1:
        typeof headerLine1 === "string"
          ? headerLine1.trim().slice(0, 40)
          : DEFAULT_FISCAL_SETTINGS.headerLine1,
      headerLine2:
        typeof headerLine2 === "string"
          ? headerLine2.trim().slice(0, 40)
          : DEFAULT_FISCAL_SETTINGS.headerLine2,
      headerLine3:
        typeof headerLine3 === "string"
          ? headerLine3.trim().slice(0, 40)
          : DEFAULT_FISCAL_SETTINGS.headerLine3,
      // Preserve test results from existing settings
      lastTestAt:
        (
          (
            (salon.settingsJson as Record<string, unknown>)?.fiscal as Partial<FiscalPrinterSettings>
          )?.lastTestAt
        ) || null,
      lastTestResult:
        (
          (
            (salon.settingsJson as Record<string, unknown>)?.fiscal as Partial<FiscalPrinterSettings>
          )?.lastTestResult
        ) || null,
      lastTestError:
        (
          (
            (salon.settingsJson as Record<string, unknown>)?.fiscal as Partial<FiscalPrinterSettings>
          )?.lastTestError
        ) || null,
    };

    // Merge into existing settingsJson
    const existingSettings =
      (salon.settingsJson as Record<string, unknown>) || {};
    const updatedSettings = {
      ...existingSettings,
      fiscal: newFiscalSettings,
    };

    // Save to database
    await db
      .update(salons)
      .set({ settingsJson: updatedSettings })
      .where(eq(salons.id, id))
      .returning();

    console.log(
      `[Fiscal Settings API] Updated fiscal settings for salon ${id}:`,
      newFiscalSettings
    );

    return NextResponse.json({
      success: true,
      data: newFiscalSettings,
      message: "Ustawienia drukarki fiskalnej zostaly zapisane",
    });
  } catch (error) {
    console.error("[Fiscal Settings API] PUT Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update fiscal settings" },
      { status: 500 }
    );
  }
}
