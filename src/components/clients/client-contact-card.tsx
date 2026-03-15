"use client";

import {
  Edit3,
  User,
  Phone,
  Mail,
  Cake,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ClientContactCardProps {
  formFirstName: string;
  formLastName: string;
  formPhone: string;
  formEmail: string;
  formBirthday: string;
  formErrors: Record<string, string>;
  onFirstNameChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onBirthdayChange: (value: string) => void;
  onClearFieldError: (field: string) => void;
}

/**
 * Editable contact information card for the client profile.
 * Includes first name, last name, phone, email, and birthday fields
 * with inline validation error display.
 */
export function ClientContactCard({
  formFirstName,
  formLastName,
  formPhone,
  formEmail,
  formBirthday,
  formErrors,
  onFirstNameChange,
  onLastNameChange,
  onPhoneChange,
  onEmailChange,
  onBirthdayChange,
  onClearFieldError,
}: ClientContactCardProps) {
  return (
    <Card className="mb-6" data-testid="client-info-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Edit3 className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Dane kontaktowe</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="client-firstName" className="text-sm font-medium flex items-center gap-1.5 mb-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              Imie *
            </Label>
            <Input
              id="client-firstName"
              placeholder="Imie klienta"
              value={formFirstName}
              onChange={(e) => { onFirstNameChange(e.target.value); onClearFieldError("firstName"); }}
              aria-invalid={!!formErrors.firstName}
              className={formErrors.firstName ? "border-destructive" : ""}
              data-testid="client-firstName-input"
            />
            {formErrors.firstName && (
              <p className="text-sm text-destructive mt-1">{formErrors.firstName}</p>
            )}
          </div>
          <div>
            <Label htmlFor="client-lastName" className="text-sm font-medium flex items-center gap-1.5 mb-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              Nazwisko *
            </Label>
            <Input
              id="client-lastName"
              placeholder="Nazwisko klienta"
              value={formLastName}
              onChange={(e) => { onLastNameChange(e.target.value); onClearFieldError("lastName"); }}
              aria-invalid={!!formErrors.lastName}
              className={formErrors.lastName ? "border-destructive" : ""}
              data-testid="client-lastName-input"
            />
            {formErrors.lastName && (
              <p className="text-sm text-destructive mt-1">{formErrors.lastName}</p>
            )}
          </div>
          <div>
            <Label htmlFor="client-phone" className="text-sm font-medium flex items-center gap-1.5 mb-1.5">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              Numer telefonu
            </Label>
            <Input
              id="client-phone"
              type="tel"
              placeholder="np. +48 123 456 789"
              value={formPhone}
              onChange={(e) => {
                onPhoneChange(e.target.value);
                onClearFieldError("phone");
              }}
              aria-invalid={!!formErrors.phone}
              className={formErrors.phone ? "border-destructive" : ""}
              data-testid="client-phone-input"
            />
            {formErrors.phone && (
              <p className="text-sm text-destructive mt-1">{formErrors.phone}</p>
            )}
          </div>
          <div>
            <Label htmlFor="client-email" className="text-sm font-medium flex items-center gap-1.5 mb-1.5">
              <Mail className="h-3.5 w-3.5 text-muted-foreground" />
              Email
            </Label>
            <Input
              id="client-email"
              type="email"
              placeholder="np. klient@example.com"
              value={formEmail}
              onChange={(e) => {
                onEmailChange(e.target.value);
                onClearFieldError("email");
              }}
              aria-invalid={!!formErrors.email}
              data-testid="client-email-input"
            />
            {formErrors.email && (
              <p className="text-sm text-destructive mt-1">{formErrors.email}</p>
            )}
          </div>
          <div>
            <Label htmlFor="client-birthday" className="text-sm font-medium flex items-center gap-1.5 mb-1.5">
              <Cake className="h-3.5 w-3.5 text-muted-foreground" />
              Data urodzin
            </Label>
            <Input
              id="client-birthday"
              type="date"
              placeholder="np. 1990-03-15"
              value={formBirthday}
              onChange={(e) => onBirthdayChange(e.target.value)}
              data-testid="client-birthday-input"
            />
            {formBirthday && (() => {
              const today = new Date();
              const bday = new Date(formBirthday + "T00:00:00");
              const isBirthdayToday = bday.getMonth() === today.getMonth() && bday.getDate() === today.getDate();
              if (isBirthdayToday) {
                return (
                  <p className="text-xs text-green-600 mt-1 flex items-center gap-1" data-testid="birthday-today-badge">
                    <Cake className="h-3 w-3" />
                    Dzisiaj urodziny!
                  </p>
                );
              }
              return null;
            })()}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
