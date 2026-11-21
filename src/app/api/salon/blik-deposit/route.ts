import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { parseBody, blikDepositSettingsSchema } from "@/lib/api-validation";
import {
  BLIK_CONSENT_VERSION,
  BLIK_CONSENT_VERSION_STALE,
  BLIK_PRIVACY_POLICY_HREF,
  BLIK_SETTINGS_NOT_AVAILABLE,
} from "@/lib/blik-consent";
import { logger } from "@/lib/logger";
import { requireSalonStaff } from "@/lib/salon-context";
import { salons } from "@/lib/schema";
import { forSalon } from "@/lib/server/repository";

/**
 * /api/salon/blik-deposit — numer BLIK salonu dla zadatków.
 *
 * Zapis w `salons.settingsJson.deposits = { blikPhone, blikConsentAt,
 * blikConsentVersion }` (bez migracji, jak `modules`); usunięcie numeru
 * zapisuje `{ blikPhone: null, blikConsentAt: null }`. Datę i wersję zgody
 * nadaje serwer (`@/lib/blik-consent`). Zapis numeru jest zamknięty, dopóki
 * `BLIK_PRIVACY_POLICY_HREF` jest `null` (409 `BLIK_SETTINGS_NOT_AVAILABLE`);
 * usunięcie działa także przy zamkniętym zapisie. Dostęp wyłącznie
 * właściciel salonu z sesji — recepcja i pracownik 403, salonu nie bierzemy
 * z żądania (requireSalonStaff: 401 bez sesji, 404 konto bez salonu).
 *
 * Prywatność (RODO): numer to dane osobowe właściciela. Nie trafia do logów
 * (logujemy tylko salonId i to, czy numer jest ustawiony), a komunikaty
 * walidacji są stałe. Pełne ustawienia zwraca ta trasa tylko właścicielowi;
 * sam numer dostaje też klient w odpowiedzi 201 rezerwacji z zadatkiem BLIK.
 */

/** Kształt zapisu `settingsJson.deposits`. Wersja tylko przy zapisanym numerze. */
interface StoredBlikDeposit {
  blikPhone: string | null;
  blikConsentAt: string | null;
  blikConsentVersion?: string;
}

/** Odpowiedź GET: zapis plus to, czy zgoda dotyczy bieżącej treści. */
interface BlikDepositSettings {
  blikPhone: string | null;
  blikConsentAt: string | null;
  blikConsentVersion: string | null;
  consentCurrent: boolean;
}

const EMPTY_SETTINGS: StoredBlikDeposit = { blikPhone: null, blikConsentAt: null };

/** Tylko właściciel — `roles: []` wyklucza recepcję i pracownika. */
const OWNER_ONLY = { roles: [] } as const;

/** Odczyt `settingsJson.deposits` odporny na brak klucza i obcy kształt. */
function toSettings(raw: unknown): BlikDepositSettings {
  const { blikPhone, blikConsentAt, blikConsentVersion } =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const phone = typeof blikPhone === "string" ? blikPhone : null;
  const consentAt = typeof blikConsentAt === "string" ? blikConsentAt : null;
  const version = typeof blikConsentVersion === "string" ? blikConsentVersion : null;
  return {
    blikPhone: phone,
    blikConsentAt: consentAt,
    blikConsentVersion: version,
    consentCurrent: phone !== null && consentAt !== null && version === BLIK_CONSENT_VERSION,
  };
}

function salonNotFound() {
  return NextResponse.json({ success: false, error: "Salon not found" }, { status: 404 });
}

/** 409 z kodem do rozgałęzienia w UI — bez numeru w odpowiedzi i w logu. */
function conflict(salonId: string, code: string, error: string) {
  logger.info("[BlikDeposit API] BLIK phone save rejected", { salonId, code });
  return NextResponse.json({ success: false, code, error }, { status: 409 });
}

/**
 * GET — `{ blikPhone, blikConsentAt, blikConsentVersion, consentCurrent }`
 * salonu z sesji (null / false, gdy nie ustawiono).
 */
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
 * PUT — body `{ blikPhone: string | null, consent?: boolean, consentVersion?: string }`.
 * Numer: normalizacja do E.164, tylko zakres komórkowy, wymaga `consent: true`
 * i `consentVersion` równej bieżącej (inaczej 409 `BLIK_CONSENT_VERSION_STALE`);
 * `blikConsentAt` i `blikConsentVersion` nadaje serwer. Zapis numeru zamknięty
 * przy `BLIK_PRIVACY_POLICY_HREF === null` (409 `BLIK_SETTINGS_NOT_AVAILABLE`,
 * pierwszeństwo przed STALE). `blikPhone: null` czyści numer, datę i wersję.
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

    if (parsed.data.blikPhone !== null) {
      // Blokada liczona wyłącznie ze stałej w kodzie — nie z body, nagłówka ani env.
      if (BLIK_PRIVACY_POLICY_HREF === null) {
        return conflict(
          salonId,
          BLIK_SETTINGS_NOT_AVAILABLE,
          "Numer BLIK bedzie mozna zapisac po publikacji polityki prywatnosci"
        );
      }
      if (parsed.data.consentVersion !== BLIK_CONSENT_VERSION) {
        return conflict(
          salonId,
          BLIK_CONSENT_VERSION_STALE,
          "Tresc zgody zostala zaktualizowana. Odswiez strone"
        );
      }
    }

    const deposits: StoredBlikDeposit =
      parsed.data.blikPhone === null
        ? EMPTY_SETTINGS
        : {
            blikPhone: parsed.data.blikPhone,
            blikConsentAt: new Date().toISOString(),
            blikConsentVersion: BLIK_CONSENT_VERSION,
          };

    // Zapis atomowy jednym UPDATE (jsonb_set): podmienia tylko klucz `deposits`,
    // tak jak trasy pozostałych ustawień salonu, więc żaden równoległy zapis
    // innego klucza nie nadpisze go starą kopią ustawień.
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

    // Odpowiedź w kształcie GET (`toSettings`).
    return NextResponse.json({ success: true, data: toSettings(deposits) });
  } catch (error) {
    logger.error("[BlikDeposit API] PUT Error", { error });
    return NextResponse.json(
      { success: false, error: "Nie udalo sie zapisac ustawien zadatku BLIK" },
      { status: 500 }
    );
  }
}
