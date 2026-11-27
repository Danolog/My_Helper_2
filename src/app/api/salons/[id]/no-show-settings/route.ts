import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { noShowSettingsSchema, validateBody } from "@/lib/api-validation";
import { requireAuth, isAuthError } from "@/lib/auth-middleware";
import { parseNoShowAutoBlockThreshold } from "@/lib/client-block";
import { logger } from "@/lib/logger";
import { noShowAutoBlockThresholdColumn } from "@/lib/server/client-auto-block";
import { toErrorIdentity } from "@/lib/safe-error";
import { getSalonContext } from "@/lib/salon-context";
import { salons } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";
import { isValidUuid } from "@/lib/validations";

/**
 * Ustawienie salonu „Automatyczna blokada rezerwacji online”
 * (`settingsJson.noShowAutoBlockThreshold`: 1, 2, 3 albo null = wyłączone).
 * Tylko właściciel salonu z sesji; recepcja i pracownik 403.
 *
 * Kolejność: sesja (401) → format id (400) → kontekst salonu (404) → salon
 * z żądania = salon sesji i rola właściciela (403) → odczyt/zapis w
 * `forSalon(ctx.salonId).raw` z jawnym `eq(salons.id)`.
 */
type Guard = { ok: true; salonId: string } | { ok: false; response: NextResponse };

async function requireSalonOwner(params: Promise<{ id: string }>): Promise<Guard> {
  const authResult = await requireAuth();
  if (isAuthError(authResult)) return { ok: false, response: authResult };

  const { id } = await params;
  if (!isValidUuid(id)) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Nieprawidłowy identyfikator salonu" }, { status: 400 }),
    };
  }

  const ctx = await getSalonContext();
  if (!ctx) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Nie znaleziono salonu" }, { status: 404 }),
    };
  }
  if (ctx.salonId !== id || ctx.role !== "owner") {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: "Brak uprawnień" }, { status: 403 }),
    };
  }
  return { ok: true, salonId: ctx.salonId };
}

const NOT_FOUND = () => NextResponse.json({ success: false, error: "Nie znaleziono salonu" }, { status: 404 });

/** GET /api/salons/[id]/no-show-settings — bieżący próg (null = wyłączony). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let salonId: string | undefined;
  try {
    const guard = await requireSalonOwner(params);
    if (!guard.ok) return guard.response;
    salonId = guard.salonId;
    const scopedSalonId = guard.salonId;

    const [row] = await forSalon(scopedSalonId).raw((tx) =>
      tx
        .select({ threshold: noShowAutoBlockThresholdColumn() })
        .from(salons)
        .where(eq(salons.id, scopedSalonId))
        .limit(1)
    );
    if (!row) return NOT_FOUND();

    return NextResponse.json({
      success: true,
      data: { noShowAutoBlockThreshold: parseNoShowAutoBlockThreshold(row.threshold) },
    });
  } catch (error) {
    logger.error("[NoShowSettings API] GET failed", { salonId, ...toErrorIdentity(error) });
    return NextResponse.json(
      { success: false, error: "Nie udało się pobrać ustawień nieobecności" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/salons/[id]/no-show-settings — body `{ noShowAutoBlockThreshold: 1 | 2 | 3 | null }`.
 * Zmiana progu nie zakłada ani nie zdejmuje blokad z istniejących kart: próg
 * działa od następnego oznaczenia „Nie przyszedł”.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let salonId: string | undefined;
  try {
    const guard = await requireSalonOwner(params);
    if (!guard.ok) return guard.response;
    salonId = guard.salonId;
    const scopedSalonId = guard.salonId;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "Nieprawidłowe dane żądania" }, { status: 400 });
    }
    const validationError = validateBody(noShowSettingsSchema, body);
    if (validationError) return NextResponse.json(validationError, { status: 400 });
    const threshold = parseNoShowAutoBlockThreshold(
      (body as { noShowAutoBlockThreshold: unknown }).noShowAutoBlockThreshold
    );

    // Zapis atomowy jednym UPDATE (jsonb_set): podmienia tylko ten klucz,
    // inne ustawienia salonu zostają (wzorzec tras ustawień salonu).
    // Baza zapisu to obiekt ustawień; SQL NULL, JSON-owe `null` albo skalar
    // (ręczny SQL, stare wiersze) zastępuje pusty obiekt — jsonb_set na
    // skalarze kończy się błędem bazy, a nie ma tam ustawień do zachowania.
    const updated = await forSalon(scopedSalonId).raw((tx) =>
      tx
        .update(salons)
        .set({
          settingsJson: sql`jsonb_set(case when jsonb_typeof(${salons.settingsJson}) = 'object' then ${salons.settingsJson} else '{}'::jsonb end, '{noShowAutoBlockThreshold}', ${JSON.stringify(threshold)}::jsonb)`,
        })
        .where(eq(salons.id, scopedSalonId))
        .returning({ id: salons.id })
    );
    if (updated.length === 0) return NOT_FOUND();

    logger.info("[NoShowSettings API] Threshold updated", { salonId: scopedSalonId, threshold });
    return NextResponse.json({ success: true, data: { noShowAutoBlockThreshold: threshold } });
  } catch (error) {
    logger.error("[NoShowSettings API] PUT failed", { salonId, ...toErrorIdentity(error) });
    return NextResponse.json(
      { success: false, error: "Nie udało się zapisać ustawień nieobecności" },
      { status: 500 }
    );
  }
}
