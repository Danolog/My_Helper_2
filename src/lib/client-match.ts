// Strażnik dopasowania konta z sesji do rekordów `clients` po e-mailu.
//
// Rekord klienta w salonie zakłada personel (albo portal), wpisując e-mail.
// Konto użytkownika może mieć ten sam e-mail, ale dopóki go nie potwierdzi,
// nie wiemy, że to ta sama osoba: każdy może założyć konto na cudzy adres
// (gdy wymóg weryfikacji jest wyłączony, np. bez RESEND_API_KEY). Dlatego
// dopasowanie po e-mailu działa TYLKO dla zweryfikowanego e-maila. W każdym
// innym przypadku wynik to „nie znaleziono” (null), a nie błąd.
//
// Konta Google mają emailVerified = true (Better Auth ustawia to przy OAuth).
// Ocena Ryana: https://github.com/Danolog/My_Helper_2/pull/29#issuecomment-6883470917

export interface SessionUserLike {
  email?: string | null;
  emailVerified?: boolean | null;
}

/**
 * E-mail, po którym wolno dopasować konto do rekordów `clients`, albo null.
 * Null, gdy: brak użytkownika, e-mail niezweryfikowany (także brak flagi)
 * albo pusty e-mail. Porównanie z `clients.email` pozostaje dokładne, jak dotąd.
 */
export function verifiedClientMatchEmail(
  user: SessionUserLike | null | undefined
): string | null {
  if (!user || user.emailVerified !== true) return null;
  const email = typeof user.email === "string" ? user.email : "";
  return email.trim() === "" ? null : email;
}
