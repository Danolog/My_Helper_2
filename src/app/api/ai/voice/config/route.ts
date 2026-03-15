import { NextResponse } from "next/server";
import { isProPlan } from "@/lib/subscription";
import { db } from "@/lib/db";
import { salons } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getUserSalonId } from "@/lib/get-user-salon";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";

import { logger } from "@/lib/logger";
export type VoiceAiConfig = {
  enabled: boolean;
  greeting: string;
  businessHoursOnly: boolean;
  language: "pl" | "en";
  voiceStyle: "professional" | "friendly" | "warm";
  maxCallDuration: number; // seconds
  transferToHumanEnabled: boolean;
  transferPhoneNumber: string;
  capabilities: {
    bookAppointments: boolean;
    checkAvailability: boolean;
    cancelAppointments: boolean;
    rescheduleAppointments: boolean;
    answerFaq: boolean;
  };
};

const DEFAULT_CONFIG: VoiceAiConfig = {
  enabled: false,
  greeting: "Dzien dobry! Dzwonisz do naszego salonu. Jestem asystentem AI. W czym moge pomoc?",
  businessHoursOnly: true,
  language: "pl",
  voiceStyle: "friendly",
  maxCallDuration: 300,
  transferToHumanEnabled: true,
  transferPhoneNumber: "",
  capabilities: {
    bookAppointments: true,
    checkAvailability: true,
    cancelAppointments: true,
    rescheduleAppointments: true,
    answerFaq: true,
  },
};

export async function GET() {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const salonId = await getUserSalonId();
  if (!salonId) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  const hasPro = await isProPlan();
  if (!hasPro) {
    return NextResponse.json(
      { error: "Funkcje AI sa dostepne tylko w Planie Pro.", code: "PLAN_UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }

  try {
    const rows = await db
      .select({ settingsJson: salons.settingsJson })
      .from(salons)
      .where(eq(salons.id, salonId))
      .limit(1);

    const settings = (rows[0]?.settingsJson || {}) as Record<string, unknown>;
    const voiceConfig = (settings.voiceAi as VoiceAiConfig) || DEFAULT_CONFIG;

    return NextResponse.json({ config: voiceConfig });
  } catch (error) {
    logger.error("[Voice AI Config] Error", { error: error });
    return NextResponse.json({ error: "Blad serwera" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return authResult;

  const salonId = await getUserSalonId();
  if (!salonId) {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  const hasPro = await isProPlan();
  if (!hasPro) {
    return NextResponse.json(
      { error: "Funkcje AI sa dostepne tylko w Planie Pro.", code: "PLAN_UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const config: VoiceAiConfig = {
      enabled: Boolean(body.enabled),
      greeting: String(body.greeting || DEFAULT_CONFIG.greeting),
      businessHoursOnly: Boolean(body.businessHoursOnly ?? true),
      language: body.language === "en" ? "en" : "pl",
      voiceStyle: ["professional", "friendly", "warm"].includes(body.voiceStyle)
        ? body.voiceStyle
        : "friendly",
      maxCallDuration: Math.min(Math.max(Number(body.maxCallDuration) || 300, 60), 600),
      transferToHumanEnabled: Boolean(body.transferToHumanEnabled ?? true),
      transferPhoneNumber: String(body.transferPhoneNumber || ""),
      capabilities: {
        bookAppointments: Boolean(body.capabilities?.bookAppointments ?? true),
        checkAvailability: Boolean(body.capabilities?.checkAvailability ?? true),
        cancelAppointments: Boolean(body.capabilities?.cancelAppointments ?? true),
        rescheduleAppointments: Boolean(body.capabilities?.rescheduleAppointments ?? true),
        answerFaq: Boolean(body.capabilities?.answerFaq ?? true),
      },
    };

    // Get current settings and merge
    const rows = await db
      .select({ settingsJson: salons.settingsJson })
      .from(salons)
      .where(eq(salons.id, salonId))
      .limit(1);

    const currentSettings = (rows[0]?.settingsJson || {}) as Record<string, unknown>;
    const updatedSettings = { ...currentSettings, voiceAi: config };

    await db
      .update(salons)
      .set({ settingsJson: updatedSettings, updatedAt: new Date() })
      .where(eq(salons.id, salonId));

    return NextResponse.json({ config, message: "Konfiguracja zapisana" });
  } catch (error) {
    logger.error("[Voice AI Config] Error", { error: error });
    return NextResponse.json({ error: "Blad zapisu konfiguracji" }, { status: 500 });
  }
}
