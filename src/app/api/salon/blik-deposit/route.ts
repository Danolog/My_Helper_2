import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { parseBody, blikDepositSettingsSchema } from "@/lib/api-validation";
import { logger } from "@/lib/logger";
import { requireSalonStaff } from "@/lib/salon-context";
import { salons } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

/**
 * /api/salon/blik-deposit — numer BLIK salonu dla zadatków.
 *
 * Zapis w `salons.settingsJson.deposits = { blikPhone, blikConsentAt }`
 * (bez migracji, jak `modules`). Dostęp wyłącznie
 * właściciel salonu z sesji — recepcja i pracownik 403, salonu nie bierzemy
 * z żądania (requireSalonStaff: 401 bez sesji, 404 konto bez salonu).
 *
 * Prywatność (RODO): numer to dane osobowe właściciela. Nie trafia do logów
 * (logujemy tylko salonId i to, czy numer jest ustawiony), a komunikaty
 * walidacji są stałe. Numer zwraca tylko ta trasa i tylko właścicielowi.
 */

interface BlikDepositSettings {
  blikPhone: string | null;
  blikConsentAt: string | null;
}

const EMPTY_SETTINGS: BlikDepositSettings = { blikPhone: null, blikConsentAt: null };

/** Tylko właściciel — `roles: []` wyklucza recepcję i pracownika. */
const OWNER_ONLY = { roles: [] } as const;

/** Odczyt `settingsJson.deposits` odporny na brak klucza i obcy kształt. */
function toSettings(raw: unknown): BlikDepositSettings {
  if (!raw || typeof raw !== "object") return EMPTY_SETTINGS;
  const { blikPhone, blikConsentAt } = raw as Record<string, unknown>;
  return {
    blikPhone: typeof blikPhone === "string" ? blikPhone : null,
    blikConsentAt: typeof blikConsentAt === "string" ? blikConsentAt : null,
  };
}

function salonNotFound() {
  return NextResponse.json({ success: false, error: "Salon not found" }, { status: 404 });
}

/** GET — `{ blikPhone, blikConsentAt }` salonu z sesji (null, gdy nie ustawiono). */
export async function GET() {
  try {
    const guard = await requireSalonStaff(OWNER_ONLY);
    if (guard.error) return guard.error;
    const { salonId } = guard.ctx;

    // Czytamy tylko poddrzewo `deposits` — reszta ustawień salonu jest tu zbędna.
    const [salon] = await forSalon(salonId).raw((tx) =>
      tx
        .select({ deposits: sql<unknown>`${salons.settingsJson} -> 'deposits'` })
        .from(salons)
        .where(eq(salons.id, salonId))
        .limit(1)
    );
    if (!salon) return salonNotFound();

    return NextResponse.json({ success: true, data: toSettings(salon.deposits) });
  } catch (error) {
    logger.error("[BlikDeposit API] GET Error", { error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie pobrac ustawien zadatku BLIK" },
      { status: 500 }
    );
  }
}

/**
 * PUT — body `{ blikPhone: string | null, consent?: boolean }`.
 * Numer: normalizacja do E.164, tylko zakres komórkowy, wymaga `consent: true`;
 * `blikConsentAt` nadaje serwer. `blikPhone: null` czyści oba pola.
 */
export async function PUT(request: Request) {
  try {
    const guard = await requireSalonStaff(OWNER_ONLY);
    if (guard.error) return guard.error;
    const { salonId } = guard.ctx;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Nieprawidlowe dane zadania" },
        { status: 400 }
      );
    }

    const parsed = parseBody(blikDepositSettingsSchema, body);
    if (!parsed.ok) return NextResponse.json(parsed.error, { status: 400 });

    const deposits: BlikDepositSettings =
      parsed.data.blikPhone === null
        ? EMPTY_SETTINGS
        : { blikPhone: parsed.data.blikPhone, blikConsentAt: new Date().toISOString() };

    // Zapis atomowy jednym UPDATE (jsonb_set): podmienia tylko klucz `deposits`,
    // więc równoległy zapis `modules`/`loyalty` nie zostanie nadpisany starą
    // kopią ustawień (inaczej niż odczyt-scalenie-zapis w salons/[id]/modules).
    const updated = await forSalon(salonId).raw((tx) =>
      tx
        .update(salons)
        .set({
          settingsJson: sql`jsonb_set(coalesce(${salons.settingsJson}, '{}'::jsonb), '{deposits}', ${JSON.stringify(deposits)}::jsonb)`,
        })
        .where(eq(salons.id, salonId))
        .returning({ id: salons.id })
    );
    if (updated.length === 0) return salonNotFound();

    logger.info("[BlikDeposit API] Updated BLIK deposit settings", {
      salonId,
      configured: deposits.blikPhone !== null,
    });

    return NextResponse.json({ success: true, data: deposits });
  } catch (error) {
    logger.error("[BlikDeposit API] PUT Error", { error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie zapisac ustawien zadatku BLIK" },
      { status: 500 }
    );
  }
}
