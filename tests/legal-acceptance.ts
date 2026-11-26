import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Pola akceptacji dokumentów prawnych w formularzach:
 *   - rejestracja właściciela i zakładanie salonu: „Akceptuję regulamin”
 *     i „Akceptuję umowę powierzenia przetwarzania danych (DPA)”
 *     (src/components/legal/legal-acceptance-fields.tsx),
 *   - konto klienta: „Akceptuję regulamin i politykę prywatności”
 *     (src/components/auth/sign-up-form.tsx).
 * Wszystkie etykiety zaczynają się od „Akceptuję”.
 */
export const LEGAL_ACCEPTANCE_CHECKBOX = /^Akceptuję/;

/**
 * Zaznacza wszystkie widoczne pola akceptacji dokumentów w `scope`.
 *
 * Pola są tylko po publikacji dokumentów (LEGAL_DOCS_PUBLISHED w
 * src/lib/legal/documents.ts); przed publikacją pomocnik nic nie robi, więc
 * test działa przy obu wartościach flagi. Do tego czasu przycisk wysłania
 * formularza jest nieaktywny.
 *
 * Wywoływać, gdy formularz jest już wyrenderowany (pola akceptacji renderują
 * się razem z resztą formularza). Pole wyboru to przycisk Radix: kliknięcie
 * przed hydratacją nie zmienia stanu, więc zaznaczenie jest ponawiane do skutku.
 *
 * Zwraca liczbę zaznaczonych pól.
 */
export async function acceptLegalDocuments(scope: Page | Locator): Promise<number> {
  const boxes = await scope.getByRole('checkbox', { name: LEGAL_ACCEPTANCE_CHECKBOX }).all();
  let accepted = 0;
  for (const box of boxes) {
    if (!(await box.isVisible())) continue;
    await expect(async () => {
      await box.check({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await expect(box).toBeChecked();
    accepted += 1;
  }
  return accepted;
}
