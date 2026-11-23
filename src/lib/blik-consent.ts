/**
 * Treść potwierdzenia, którym właściciel salonu włącza pokazywanie numeru
 * BLIK, i jej wersja (w kodzie nazwy z „consent” zostają dla zgodności
 * z kolumnami i kontraktem trasy).
 *
 * Moduł bez importów — bezpieczny dla klienta i serwera (trasa
 * `/api/salon/blik-deposit` porównuje wersję).
 *
 * Zmiana któregokolwiek zdania albo etykiety wymaga nowej wersji
 * (`BLIK_CONSENT_VERSION`) i ponownej zgody właściciela. Test
 * `__tests__/lib/blik-consent.test.ts` trzyma skrót treści per wersja:
 * zmiana treści bez nowej wersji daje czerwony wynik.
 */

/** Wersja treści zgody zapisywana przez serwer obok `blikConsentAt`. */
export const BLIK_CONSENT_VERSION = "2026-11-23";

/**
 * Zdania, które właściciel czyta przed zaznaczeniem pola (kolejność wiąże).
 * Zdanie o administratorze jest ostatnie, bo bezpośrednio pod nim komponent
 * pokazuje link do polityki prywatności (gdy `BLIK_PRIVACY_POLICY_HREF`
 * nie jest `null`).
 */
export const BLIK_CONSENT_SENTENCES = [
  "Ten numer telefonu będzie pokazywany jako numer do wpłaty zadatku BLIK.",
  "Zobaczy go każda osoba, która zarezerwuje w Twoim salonie wizytę z zadatkiem, także gość bez konta. MyHelper nie sprawdza, kim jest ta osoba.",
  "Numer pojawi się na ekranie po rezerwacji i w SMS-ie z danymi wpłaty, który dostaje osoba rezerwująca. SMS wysyłamy przez dostawcę bramki SMS (SMSAPI).",
  "Treść każdego takiego SMS-a, razem z numerem, zostaje zapisana w historii powiadomień salonu, którą widzi personel Twojego salonu.",
  "Numer możesz w każdej chwili usunąć w tym miejscu. Od tej chwili nie trafi do nowych rezerwacji. Nie usuniemy go z SMS-ów już wysłanych ani z historii powiadomień.",
  "Wpłaty przychodzą bezpośrednio na Twój telefon, poza MyHelper. Wpłatę oznaczasz w aplikacji sam.",
  "Najlepiej podaj numer służbowy, nie prywatny.",
  "W zakresie pokazywania numeru osobom rezerwującym administratorem danych jest MyHelper. Więcej informacji znajdziesz w polityce prywatności.",
] as const;

/**
 * Etykieta pola (checkbox wymagany do zapisu numeru). Podstawą pokazywania
 * numeru jest wykonanie usługi, którą właściciel sam włącza, więc pole jest
 * potwierdzeniem zapoznania się z zasadami i włączenia funkcji, a nie
 * zgodą w rozumieniu przepisów o ochronie danych.
 */
export const BLIK_CONSENT_LABEL =
  "Rozumiem, że ten numer zobaczy każda osoba rezerwująca wizytę z zadatkiem, i chcę włączyć wpłaty BLIK na ten numer.";

/**
 * Adres polityki prywatności. Dopóki stała jest `null`, serwer odrzuca zapis
 * numeru BLIK (409 `BLIK_SETTINGS_NOT_AVAILABLE`); usunięcie numeru działa
 * także przy zamkniętym zapisie. Ta stała otwiera zapis numeru — jej zmiana
 * wymaga recenzji bezpieczeństwa i zgody właściciela produktu na treść
 * polityki prywatności. Stała nie wynika z rejestru dokumentów: publikacja
 * polityki sama niczego tu nie otwiera. Test `__tests__/lib/blik-consent.test.ts`
 * pilnuje, że wartość inna niż `null` wymaga opublikowanej polityki i adresu
 * równego adresowi z rejestru (bez linku do strony 404).
 */
export const BLIK_PRIVACY_POLICY_HREF: string | null = null;

/** 409: wersja zgody z żądania inna niż bieżąca (karta otwarta przed zmianą treści). */
export const BLIK_CONSENT_VERSION_STALE = "BLIK_CONSENT_VERSION_STALE";

/** 409: zapis numeru zamknięty do czasu publikacji polityki prywatności. */
export const BLIK_SETTINGS_NOT_AVAILABLE = "BLIK_SETTINGS_NOT_AVAILABLE";
