/**
 * Cena planu: netGrosze, grossGrosze, planPriceText i planGrossText przyjmują
 * cenę netto planu w złotych — napis (np. "49.00") albo liczbę (np. 49);
 * vatSplitFromGross i formatZl przyjmują kwotę w groszach. Rachunek idzie na groszach jako
 * liczbach całkowitych: kwota netto powstaje z części całkowitej
 * i ułamkowej napisu. Brutto i netto z podziału brutto to Math.floor
 * z ilorazu, w którego liczniku dodana jest połowa dzielnika (w podziale
 * brutto licznik i dzielnik są podwojone), więc połówka grosza jest
 * zaokrąglana w górę.
 */
import { DEFAULT_VAT_RATE } from "@/lib/constants";

const NET_PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

function assertGrosze(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name}: oczekiwano nieujemnej liczby całkowitej groszy, otrzymano ${value}`);
  }
}

function assertRate(rate: number): void {
  if (!Number.isInteger(rate) || rate < 0 || rate > 100) {
    throw new Error(`Stawka VAT musi być liczbą całkowitą od 0 do 100, otrzymano ${rate}`);
  }
}

/** Cena netto w złotych → grosze, np. "49.00" → 4900, 49 → 4900, "49.5" → 4950. */
export function netGrosze(price: string | number): number {
  const text = String(price).trim();
  if (!NET_PRICE_PATTERN.test(text)) {
    throw new Error(`Nieprawidłowa cena netto: "${String(price)}"`);
  }
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (result > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Cena netto poza zakresem: "${String(price)}"`);
  }
  return result;
}

/** Cena brutto w groszach, np. "49.00" przy 23% → 6027. */
export function grossGrosze(
  price: string | number,
  rate: number = DEFAULT_VAT_RATE
): number {
  assertRate(rate);
  return Math.floor((netGrosze(price) * (100 + rate) + 50) / 100);
}

/** Podział kwoty brutto w groszach na netto i VAT, np. 6027 przy 23% → { net: 4900, vat: 1127 }. */
export function vatSplitFromGross(
  grossGr: number,
  rate: number = DEFAULT_VAT_RATE
): { net: number; vat: number } {
  assertGrosze(grossGr, "Kwota brutto");
  assertRate(rate);
  const net = Math.floor(
    (grossGr * 200 + (100 + rate)) / (2 * (100 + rate))
  );
  return { net, vat: grossGr - net };
}

/** Grosze → tekst kwoty: 4900 → "49 zł", 6027 → "60,27 zł", 5 → "0,05 zł". */
export function formatZl(grosze: number): string {
  assertGrosze(grosze, "Kwota");
  const zl = Math.floor(grosze / 100);
  const gr = grosze % 100;
  if (gr === 0) {
    return `${zl} zł`;
  }
  return `${zl},${String(gr).padStart(2, "0")} zł`;
}

/** Tekst ceny netto, np. "49 zł netto + 23% VAT". */
export function planPriceText(
  price: string | number,
  rate: number = DEFAULT_VAT_RATE
): string {
  assertRate(rate);
  return `${formatZl(netGrosze(price))} netto + ${rate}% VAT`;
}

/** Tekst ceny brutto, np. "60,27 zł brutto". */
export function planGrossText(
  price: string | number,
  rate: number = DEFAULT_VAT_RATE
): string {
  return `${formatZl(grossGrosze(price, rate))} brutto`;
}
