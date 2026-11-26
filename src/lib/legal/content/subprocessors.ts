/**
 * Treść dokumentu „Podprocesorzy” (prosty markdown, patrz `parseLegalMarkdown`).
 *
 * Znaczniki `[DO UZUPEŁNIENIA: …]` wypełnia właściciel produktu. Dopóki
 * zostają w treści, test bramki publikacji nie pozwoli włączyć flagi.
 */
export const SUBPROCESSORS_CONTENT = `Stan na: [DO UZUPEŁNIENIA: data publikacji]

Na tej liście są firmy, które przetwarzają dane osobowe w imieniu MyHelper, gdy świadczymy usługę. Ta sama lista jest załącznikiem A do [umowy powierzenia przetwarzania danych](/dpa).

O planowanej zmianie listy informujemy właścicieli salonów e-mailem co najmniej 14 dni wcześniej. Salon może zgłosić sprzeciw na kontakt@nordsignal.cc (umowa powierzenia, § 7).

| Firma | Gdzie przetwarza dane | Jakie dane | Po co | Podstawa przekazania poza EOG |
|---|---|---|---|---|
| Google Cloud (Google Cloud Poland sp. z o.o., Warszawa) | region europe-central2 (Warszawa, Polska) | wszystkie dane w aplikacji, w tym zdjęcia, kopie zapasowe i logi serwera | serwery, baza danych, przechowywanie plików, logi | brak przekazania |
| SMSAPI (LINK Mobility Poland sp. z o.o., Gliwice) | Polska | numer telefonu odbiorcy i treść SMS-a | wysyłka SMS-ów | brak przekazania |
| Resend (Plus Five Five, Inc.) | USA | adres e-mail odbiorcy, temat i treść wiadomości | e-maile z aplikacji | EU-U.S. Data Privacy Framework, jeśli firma jest na oficjalnej liście; w przeciwnym razie standardowe klauzule umowne (decyzja Komisji (UE) 2021/914) |
| Upstash, Inc. | dane w regionie eu-central-1 (Frankfurt, Niemcy); spółka w USA | adres IP, numer telefonu gościa (ostatnie 9 cyfr) albo identyfikator salonu jako klucz licznika | ochrona przed nadużyciami | dostęp z USA: jak wyżej |

**Czego nie ma na liście i dlaczego.** Nie korzystamy z narzędzi analitycznych ani reklamowych. Płatności kartą, funkcje AI, generowanie grafik i wideo, powiadomienia push i logowanie kontem Google są wyłączone. Ich dostawcy nie dostają danych. Jeśli którąś z tych funkcji włączymy, najpierw zmienimy tę listę w trybie opisanym wyżej.

Kontakt: kontakt@nordsignal.cc
`;
