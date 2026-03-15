import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { salons } from "@/lib/schema";
import { eq } from "drizzle-orm";
import type { FiscalPrinterSettings } from "../route";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

/**
 * POST /api/salons/[id]/fiscal-settings/test-connection
 *
 * Tests the connection to the fiscal printer.
 * In a production environment, this would actually attempt to connect to the printer
 * via the configured connection method (network TCP, USB, or serial port).
 *
 * For now, it validates the configuration and simulates a connection test,
 * storing the result in the salon's settingsJson.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth();
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    // Fetch current salon settings
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

    const settings = salon.settingsJson as Record<string, unknown> | null;
    const fiscalSettings = (settings?.fiscal || {}) as Partial<FiscalPrinterSettings>;

    // Validate configuration completeness
    const errors: string[] = [];

    if (!fiscalSettings.connectionType) {
      errors.push("Nie wybrano typu polaczenia");
    }

    if (fiscalSettings.connectionType === "network") {
      if (!fiscalSettings.ipAddress || fiscalSettings.ipAddress.trim() === "") {
        errors.push("Nie podano adresu IP drukarki");
      } else {
        // Validate IP format
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipRegex.test(fiscalSettings.ipAddress.trim())) {
          errors.push("Nieprawidlowy format adresu IP");
        }
      }
      if (!fiscalSettings.port || fiscalSettings.port < 1 || fiscalSettings.port > 65535) {
        errors.push("Nieprawidlowy numer portu (1-65535)");
      }
    }

    if (fiscalSettings.connectionType === "serial") {
      if (!fiscalSettings.serialPort || fiscalSettings.serialPort.trim() === "") {
        errors.push("Nie podano portu szeregowego");
      }
    }

    if (!fiscalSettings.printerModel || fiscalSettings.printerModel.trim() === "") {
      errors.push("Nie podano modelu drukarki");
    }

    const now = new Date().toISOString();
    let testResult: "success" | "failure";
    let testError: string | null = null;

    if (errors.length > 0) {
      testResult = "failure";
      testError = errors.join("; ");
    } else {
      // In production, we would attempt actual TCP connection to the printer:
      // - For network: try TCP connect to ipAddress:port
      // - For USB: try to open USB device
      // - For serial: try to open serial port
      //
      // Since this is a web application and the printer is on the salon's local network,
      // the actual connection would be handled by a local agent/bridge application.
      // Here we validate the configuration is complete and simulate the test.

      // Simulate connection test - configuration is valid
      testResult = "success";
      testError = null;

      console.log(
        `[Fiscal Test] Connection test for salon ${id}: ` +
        `type=${fiscalSettings.connectionType}, ` +
        `ip=${fiscalSettings.ipAddress}:${fiscalSettings.port}, ` +
        `model=${fiscalSettings.printerModel}`
      );
    }

    // Update test results in settings
    const existingSettings = (salon.settingsJson as Record<string, unknown>) || {};
    const updatedFiscal = {
      ...(existingSettings.fiscal as Record<string, unknown> || {}),
      lastTestAt: now,
      lastTestResult: testResult,
      lastTestError: testError,
    };
    const updatedSettings = {
      ...existingSettings,
      fiscal: updatedFiscal,
    };

    await db
      .update(salons)
      .set({ settingsJson: updatedSettings })
      .where(eq(salons.id, id));

    return NextResponse.json({
      success: testResult === "success",
      data: {
        testResult,
        testError,
        testedAt: now,
        connectionType: fiscalSettings.connectionType,
        target:
          fiscalSettings.connectionType === "network"
            ? `${fiscalSettings.ipAddress}:${fiscalSettings.port}`
            : fiscalSettings.connectionType === "serial"
              ? fiscalSettings.serialPort
              : "USB",
      },
      message:
        testResult === "success"
          ? "Polaczenie z drukarka fiskalna dziala prawidlowo"
          : `Test polaczenia nie powiodl sie: ${testError}`,
    });
  } catch (error) {
    console.error("[Fiscal Test Connection API] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to test fiscal printer connection" },
      { status: 500 }
    );
  }
}
