import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clients, notifications, salons } from "@/lib/schema";
import { eq, sql, and, isNotNull, inArray, like } from "drizzle-orm";
import { requireCronSecret } from "@/lib/auth-middleware";
import { isValidUuid } from "@/lib/api-validation";

import { logger } from "@/lib/logger";
interface BirthdaySettings {
  enabled: boolean;
  giftType: "discount" | "product";
  discountPercentage: number;
  productName: string;
  customMessage: string;
  autoSend: boolean;
}

/**
 * GET /api/notifications/birthday?salonId=...
 *
 * Check for clients with birthdays today and return the list.
 * Also returns the saved birthday gift settings for the salon.
 */
export async function GET(request: Request) {
  try {
    const cronError = await requireCronSecret(request);
    if (cronError) return cronError;
    const { searchParams } = new URL(request.url);
    const salonId = searchParams.get("salonId");

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    if (!isValidUuid(salonId)) {
      return NextResponse.json(
        { success: false, error: "Nieprawidłowy salonId" },
        { status: 400 }
      );
    }

    // Get salon with settings
    const [salon] = await db
      .select({ id: salons.id, settingsJson: salons.settingsJson })
      .from(salons)
      .where(eq(salons.id, salonId))
      .limit(1);

    // Extract birthday settings
    const salonSettings = salon?.settingsJson as Record<string, unknown> | null;
    const birthdayGiftSettings = (salonSettings?.birthdayGift || null) as BirthdaySettings | null;

    // Find clients whose birthday month and day match today
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const todayMonthDay = `-${month}-${day}`;

    const birthdayClients = await db
      .select({
        id: clients.id,
        firstName: clients.firstName,
        lastName: clients.lastName,
        phone: clients.phone,
        email: clients.email,
        birthday: clients.birthday,
      })
      .from(clients)
      .where(
        and(
          eq(clients.salonId, salonId),
          isNotNull(clients.birthday),
          like(clients.birthday, `%${todayMonthDay}`)
        )
      );

    return NextResponse.json({
      success: true,
      data: {
        clients: birthdayClients,
        count: birthdayClients.length,
        todayDate: today.toISOString().split("T")[0],
        birthdaySettings: birthdayGiftSettings,
      },
    });
  } catch (error) {
    logger.error("[Birthday Notifications API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to check birthday notifications" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/notifications/birthday
 *
 * Send birthday wish notifications to all clients with birthdays today.
 * Creates notification records in the database.
 *
 * Uses saved birthday gift settings from the salon's settingsJson.
 * Body params can override saved settings:
 *   - salonId: string (required)
 *   - birthdayDiscount: number (optional) - override discount percentage
 *   - customMessage: string (optional) - override message template
 *   - giftType: string (optional) - override gift type
 *   - productName: string (optional) - override product name
 */
export async function POST(request: Request) {
  try {
    const cronError = await requireCronSecret(request);
    if (cronError) return cronError;
    const body = await request.json();
    const { salonId } = body;

    if (!salonId) {
      return NextResponse.json(
        { success: false, error: "salonId is required" },
        { status: 400 }
      );
    }

    if (!isValidUuid(salonId)) {
      return NextResponse.json(
        { success: false, error: "Nieprawidłowy salonId" },
        { status: 400 }
      );
    }

    // Get salon name and settings
    const [salon] = await db
      .select({ name: salons.name, settingsJson: salons.settingsJson })
      .from(salons)
      .where(eq(salons.id, salonId))
      .limit(1);

    const salonName = salon?.name || "Nasz salon";

    // Get saved birthday gift settings
    const salonSettings = salon?.settingsJson as Record<string, unknown> | null;
    const savedSettings = (salonSettings?.birthdayGift || {}) as Partial<BirthdaySettings>;

    // Merge saved settings with any overrides from the request body
    const giftType = body.giftType || savedSettings.giftType || "discount";
    const birthdayDiscount =
      body.birthdayDiscount !== undefined
        ? body.birthdayDiscount
        : savedSettings.discountPercentage || 0;
    const productName = body.productName || savedSettings.productName || "";
    const customMessage = body.customMessage || savedSettings.customMessage || "";

    // Find clients with birthday today
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const todayMonthDay = `-${month}-${day}`;

    const birthdayClients = await db
      .select({
        id: clients.id,
        firstName: clients.firstName,
        lastName: clients.lastName,
        phone: clients.phone,
        email: clients.email,
        birthday: clients.birthday,
      })
      .from(clients)
      .where(
        and(
          eq(clients.salonId, salonId),
          isNotNull(clients.birthday),
          like(clients.birthday, `%${todayMonthDay}`)
        )
      );

    if (birthdayClients.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          notificationsSent: 0,
          message: "Brak klientow z urodzinami dzisiaj",
        },
      });
    }

    // Batch-check for existing birthday notifications sent today for this salon
    // (single query instead of N individual checks per client)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartISO = todayStart.toISOString();

    const clientIds = birthdayClients.map((c) => c.id);
    const alreadyNotifiedIds = new Set<string>();

    if (clientIds.length > 0) {
      const existingNotifications = await db
        .select({ clientId: notifications.clientId })
        .from(notifications)
        .where(
          and(
            eq(notifications.salonId, salonId),
            inArray(notifications.clientId, clientIds),
            sql`${notifications.message} LIKE '%urodzin%'`,
            sql`${notifications.createdAt} >= ${todayStartISO}::timestamp`
          )
        );
      for (const row of existingNotifications) {
        if (row.clientId) {
          alreadyNotifiedIds.add(row.clientId);
        }
      }
    }

    // Build notification values for batch insert
    const notificationValues: Array<{
      salonId: string;
      clientId: string;
      type: string;
      message: string;
      status: string;
      sentAt: Date;
    }> = [];
    // Track client metadata for the response
    const clientMetadata: Array<{
      clientId: string;
      clientName: string;
      clientPhone: string | null;
    }> = [];

    for (const client of birthdayClients) {
      if (alreadyNotifiedIds.has(client.id)) {
        logger.info(`[Birthday Notifications] Already sent birthday notification to ${client.firstName} ${client.lastName} today, skipping`);
        continue;
      }

      // Build the birthday message
      let message: string;
      if (customMessage) {
        message = customMessage
          .replace("{imie}", client.firstName)
          .replace("{nazwisko}", client.lastName)
          .replace("{salon}", salonName);
      } else {
        message = `Wszystkiego najlepszego z okazji urodzin, ${client.firstName}! ${salonName} zyczy Ci wspanialego dnia!`;
      }

      // Add gift mention based on type
      if (giftType === "discount" && birthdayDiscount && birthdayDiscount > 0) {
        message += ` Z tej okazji przygotowalismy dla Ciebie ${birthdayDiscount}% rabatu na nastepna wizyte. Zapraszamy!`;
      } else if (giftType === "product" && productName) {
        message += ` Z tej okazji przygotowalismy dla Ciebie prezent: ${productName}. Zapraszamy!`;
      }

      // Append booking link so the client can directly book their next visit
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      message += ` Zarezerwuj wizyte: ${appUrl}/salons/${salonId}/book`;

      // Determine notification channel - send via SMS if phone is available, otherwise email
      const notificationType = client.phone
        ? "sms"
        : client.email
          ? "email"
          : "push";

      notificationValues.push({
        salonId,
        clientId: client.id,
        type: notificationType,
        message,
        status: "sent",
        sentAt: new Date(),
      });

      clientMetadata.push({
        clientId: client.id,
        clientName: `${client.firstName} ${client.lastName}`,
        clientPhone: client.phone,
      });

      logger.info(`[Birthday Notifications] Queued birthday notification for ${client.firstName} ${client.lastName} (${notificationType})`);
    }

    // Batch-insert all notifications in a single query instead of N individual INSERTs
    const createdNotifications: Array<Record<string, unknown>> = [];
    if (notificationValues.length > 0) {
      const inserted = await db
        .insert(notifications)
        .values(notificationValues)
        .returning();

      for (let i = 0; i < inserted.length; i++) {
        const meta = clientMetadata[i]!;
        createdNotifications.push({
          ...inserted[i],
          clientName: meta.clientName,
          clientPhone: meta.clientPhone,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        notificationsSent: createdNotifications.length,
        notifications: createdNotifications,
        message: `Wyslano ${createdNotifications.length} powiadomien urodzinowych`,
      },
    });
  } catch (error) {
    logger.error("[Birthday Notifications API] Error", { error: error });
    return NextResponse.json(
      { success: false, error: "Failed to send birthday notifications" },
      { status: 500 }
    );
  }
}
