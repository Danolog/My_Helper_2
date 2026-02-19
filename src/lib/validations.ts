/**
 * Shared validation utilities for form fields
 */

/**
 * Validate a phone number.
 * Accepts formats like:
 *   +48 123 456 789
 *   +48123456789
 *   123456789
 *   123 456 789
 *   +1 (555) 123-4567
 *
 * Rules:
 * - Must contain at least 7 digits (shortest valid phone numbers)
 * - Must not exceed 15 digits (ITU-T E.164 max)
 * - Only digits, spaces, +, -, (, ) are allowed
 * - Must not be only letters
 *
 * @param phone - The phone number string to validate
 * @returns Error message string if invalid, or null if valid
 */
export function validatePhone(phone: string): string | null {
  if (!phone || !phone.trim()) {
    return null // Phone is typically optional; return null for empty
  }

  const trimmed = phone.trim()

  // Check for invalid characters (only allow digits, spaces, +, -, (, ))
  if (/[^0-9\s+\-().]/.test(trimmed)) {
    return "Numer telefonu moze zawierac tylko cyfry, spacje i znaki +, -, (, ). Przyklad: +48 123 456 789"
  }

  // Extract just the digits
  const digits = trimmed.replace(/\D/g, "")

  // Must have at least 7 digits
  if (digits.length < 7) {
    return "Numer telefonu jest za krotki - wpisz co najmniej 7 cyfr, np. 123 456 789"
  }

  // Must not exceed 15 digits (E.164 standard)
  if (digits.length > 15) {
    return "Numer telefonu jest za dlugi - maksymalnie 15 cyfr (standard E.164)"
  }

  return null
}

/**
 * Validate an email address.
 * @param email - The email string to validate
 * @returns Error message string if invalid, or null if valid
 */
export function validateEmail(email: string): string | null {
  if (!email || !email.trim()) {
    return null // Email is typically optional
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return "Nieprawidlowy format email. Wpisz adres w formacie: nazwa@domena.pl"
  }

  return null
}
