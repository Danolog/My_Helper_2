"use client";

import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import type {
  AcceptableLegalDocument,
  LegalAcceptanceChecks,
  LegalAcceptanceForm,
} from "@/lib/legal/documents";

interface LegalAcceptanceFieldsProps {
  /** Pola z `legalAcceptanceForm()`; przy `null` komponent nic nie renderuje. */
  form: LegalAcceptanceForm | null;
  checks: LegalAcceptanceChecks;
  onChange: (checks: LegalAcceptanceChecks) => void;
  /** Prefiks identyfikatorów pól (dwa formularze mogą być na jednej stronie). */
  idPrefix: string;
  disabled?: boolean;
}

interface FieldProps {
  id: string;
  document: AcceptableLegalDocument;
  linkText: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}

function AcceptanceField({ id, document, linkText, checked, disabled, onCheckedChange }: FieldProps) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        required
        className="mt-0.5"
      />
      <label htmlFor={id} className="text-sm leading-snug">
        Akceptuję{" "}
        {/* Nowa karta: przejście do dokumentu nie kasuje wypełnionego formularza. */}
        <Link
          href={document.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          {linkText}
        </Link>
      </label>
    </div>
  );
}

/**
 * Dwa osobne pola akceptacji: regulamin i umowa powierzenia (DPA). Każdy dokument
 * akceptuje się oddzielnie, bo trasa zapisuje dla każdego osobny wpis z wersją.
 */
export function LegalAcceptanceFields({
  form,
  checks,
  onChange,
  idPrefix,
  disabled = false,
}: LegalAcceptanceFieldsProps) {
  if (form === null) return null;

  return (
    <fieldset className="space-y-2" data-testid="legal-acceptance-fields">
      <legend className="sr-only">Akceptacja dokumentów</legend>
      <AcceptanceField
        id={`${idPrefix}-accept-terms`}
        document={form.terms}
        linkText="regulamin"
        checked={checks.terms}
        disabled={disabled}
        onCheckedChange={(terms) => onChange({ ...checks, terms })}
      />
      <AcceptanceField
        id={`${idPrefix}-accept-dpa`}
        document={form.dpa}
        linkText="umowę powierzenia przetwarzania danych (DPA)"
        checked={checks.dpa}
        disabled={disabled}
        onCheckedChange={(dpa) => onChange({ ...checks, dpa })}
      />
    </fieldset>
  );
}
