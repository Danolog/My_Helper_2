"use client";

import { Card, CardContent } from "@/components/ui/card";
import { ClientConsentsCard } from "./client-consents-card";
import { ClientContactCard } from "./client-contact-card";
import { ClientDepositCard } from "./client-deposit-card";
import { ClientFavoriteEmployeeCard } from "./client-favorite-employee-card";
import { ClientHealthPreferencesCard } from "./client-health-preferences-card";
import type { ClientData, Employee } from "./types";

interface ClientProfileTabProps {
  client: ClientData;
  clientId: string;
  /** Form state passed from the parent orchestrator */
  formFirstName: string;
  formLastName: string;
  formPhone: string;
  formEmail: string;
  formBirthday: string;
  formErrors: Record<string, string>;
  formNotes: string;
  allergiesList: string[];
  preferencesList: string[];
  employees: Employee[];
  selectedFavoriteEmployeeId: string;
  formRequireDeposit: boolean;
  formDepositType: string;
  formDepositValue: string;
  /** State setters passed from the parent orchestrator */
  onFirstNameChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onBirthdayChange: (value: string) => void;
  onClearFieldError: (field: string) => void;
  onNotesChange: (notes: string) => void;
  onAllergiesChange: (allergies: string[]) => void;
  onPreferencesChange: (preferences: string[]) => void;
  onFavoriteEmployeeChange: (value: string) => void;
  onRequireDepositChange: (value: boolean) => void;
  onDepositTypeChange: (value: string) => void;
  onDepositValueChange: (value: string) => void;
}

/**
 * Profile tab content for the client detail page.
 * Composes contact info, favorite employee, deposit settings,
 * health/preferences, marketing consents, and client metadata cards.
 */
export function ClientProfileTab({
  client,
  clientId,
  formFirstName,
  formLastName,
  formPhone,
  formEmail,
  formBirthday,
  formErrors,
  formNotes,
  allergiesList,
  preferencesList,
  employees,
  selectedFavoriteEmployeeId,
  formRequireDeposit,
  formDepositType,
  formDepositValue,
  onFirstNameChange,
  onLastNameChange,
  onPhoneChange,
  onEmailChange,
  onBirthdayChange,
  onClearFieldError,
  onNotesChange,
  onAllergiesChange,
  onPreferencesChange,
  onFavoriteEmployeeChange,
  onRequireDepositChange,
  onDepositTypeChange,
  onDepositValueChange,
}: ClientProfileTabProps) {
  return (
    <>
      <ClientContactCard
        formFirstName={formFirstName}
        formLastName={formLastName}
        formPhone={formPhone}
        formEmail={formEmail}
        formBirthday={formBirthday}
        formErrors={formErrors}
        onFirstNameChange={onFirstNameChange}
        onLastNameChange={onLastNameChange}
        onPhoneChange={onPhoneChange}
        onEmailChange={onEmailChange}
        onBirthdayChange={onBirthdayChange}
        onClearFieldError={onClearFieldError}
      />

      <ClientFavoriteEmployeeCard
        employees={employees}
        selectedFavoriteEmployeeId={selectedFavoriteEmployeeId}
        onFavoriteEmployeeChange={onFavoriteEmployeeChange}
      />

      <ClientDepositCard
        formRequireDeposit={formRequireDeposit}
        formDepositType={formDepositType}
        formDepositValue={formDepositValue}
        onRequireDepositChange={onRequireDepositChange}
        onDepositTypeChange={onDepositTypeChange}
        onDepositValueChange={onDepositValueChange}
      />

      <ClientHealthPreferencesCard
        allergiesList={allergiesList}
        preferencesList={preferencesList}
        formNotes={formNotes}
        onAllergiesChange={onAllergiesChange}
        onPreferencesChange={onPreferencesChange}
        onNotesChange={onNotesChange}
      />

      <ClientConsentsCard clientId={clientId} />

      {/* Client meta info */}
      <Card data-testid="client-meta-card">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>
              Dodano:{" "}
              {new Date(client.createdAt).toLocaleDateString("pl-PL", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
            <span>
              Ostatnia aktualizacja:{" "}
              {new Date(client.updatedAt).toLocaleDateString("pl-PL", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
