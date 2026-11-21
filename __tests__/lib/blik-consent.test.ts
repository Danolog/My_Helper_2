/**
 * Treść zgody BLIK: dosłowne zdania i etykieta, skrót treści per wersja,
 * format wersji i zamknięty zapis numeru (adres polityki prywatności `null`).
 *
 * Mapa skrótów: nowa wersja treści = nowy wpis; istniejących wpisów się nie
 * edytuje. Zmiana zdania bez nowej wersji daje czerwony wynik.
 */
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  BLIK_CONSENT_LABEL,
  BLIK_CONSENT_SENTENCES,
  BLIK_CONSENT_VERSION,
  BLIK_CONSENT_VERSION_STALE,
  BLIK_PRIVACY_POLICY_HREF,
  BLIK_SETTINGS_NOT_AVAILABLE,
} from "@/lib/blik-consent";

const CONTENT_SHA256_BY_VERSION: Record<string, string> = {
  "2026-11-21": "9e41127a955cc8dc6910064cbcf828e475c0b244117703b407fa47f9553aecf9",
};

function contentSha256(): string {
  return createHash("sha256")
    .update([...BLIK_CONSENT_SENTENCES, BLIK_CONSENT_LABEL].join("\n"), "utf8")
    .digest("hex");
}

describe("blik-consent", () => {
  it("6 zdań zgody dosłownie", () => {
    expect([...BLIK_CONSENT_SENTENCES]).toEqual([
      "Ten numer telefonu będzie pokazywany jako numer do wpłaty zadatku BLIK.",
      "Zobaczy go każda osoba, która zarezerwuje w Twoim salonie wizytę z zadatkiem, także gość bez konta. MyHelper nie sprawdza, kim jest ta osoba.",
      "Numer pojawi się na ekranie po rezerwacji i w SMS-ie z danymi wpłaty, który dostaje osoba rezerwująca. SMS wysyłamy przez dostawcę bramki SMS (SMSAPI).",
      "Treść każdego takiego SMS-a, razem z numerem, zostaje zapisana w historii powiadomień salonu, którą widzi personel Twojego salonu.",
      "Numer możesz w każdej chwili usunąć w tym miejscu. Od tej chwili nie trafi do nowych rezerwacji. Nie usuniemy go z SMS-ów już wysłanych ani z historii powiadomień.",
      "Wpłaty przychodzą bezpośrednio na Twój telefon, poza MyHelper. Wpłatę oznaczasz w aplikacji sam.",
    ]);
  });

  it("etykieta pola zgody dosłownie", () => {
    expect(BLIK_CONSENT_LABEL).toBe(
      "Zgadzam się na pokazywanie tego numeru osobom rezerwującym wizytę z zadatkiem, na ekranie i w SMS-ie, na zasadach opisanych powyżej."
    );
  });

  it("treść bez cudzysłowów „” i bez zbędnych spacji na brzegach", () => {
    for (const text of [...BLIK_CONSENT_SENTENCES, BLIK_CONSENT_LABEL]) {
      expect(text).not.toMatch(/[„”"]/);
      expect(text).toBe(text.trim());
    }
  });

  it("wersja w formacie YYYY-MM-DD i będąca prawdziwą datą", () => {
    expect(BLIK_CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${BLIK_CONSENT_VERSION}T00:00:00.000Z`).toISOString().slice(0, 10)).toBe(
      BLIK_CONSENT_VERSION
    );
  });

  it("bieżąca wersja ma wpis w mapie skrótów, a skrót treści jest mu równy", () => {
    expect(CONTENT_SHA256_BY_VERSION).toHaveProperty(BLIK_CONSENT_VERSION);
    expect(contentSha256()).toBe(CONTENT_SHA256_BY_VERSION[BLIK_CONSENT_VERSION]);
  });

  it("adres polityki prywatności to null — zapis numeru zamknięty", () => {
    expect(BLIK_PRIVACY_POLICY_HREF === null).toBe(true);
  });

  it("kody odpowiedzi 409", () => {
    expect(BLIK_CONSENT_VERSION_STALE).toBe("BLIK_CONSENT_VERSION_STALE");
    expect(BLIK_SETTINGS_NOT_AVAILABLE).toBe("BLIK_SETTINGS_NOT_AVAILABLE");
  });
});
