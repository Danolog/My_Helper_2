"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Package, Clock } from "lucide-react";
import { FormRecoveryBanner } from "@/components/form-recovery-banner";
import type { Promotion, Service } from "../_types";
import { DAY_NAMES_PL, DAY_FULL_NAMES_PL } from "../_types";

interface PromotionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingPromotion: Promotion | null;
  formName: string;
  formType: string;
  formValue: string;
  formStartDate: string;
  formEndDate: string;
  formIsActive: boolean;
  formSelectedServiceIds: string[];
  formHappyHoursStart: string;
  formHappyHoursEnd: string;
  formHappyHoursDays: number[];
  formValueError: string;
  saving: boolean;
  promoWasRecovered: boolean;
  servicesList: Service[];
  onNameChange: (name: string) => void;
  onTypeChange: (type: string) => void;
  onValueChange: (value: string) => void;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onIsActiveChange: (active: boolean) => void;
  onToggleHappyHoursDay: (day: number) => void;
  onToggleServiceSelection: (serviceId: string) => void;
  onHappyHoursStartChange: (time: string) => void;
  onHappyHoursEndChange: (time: string) => void;
  onSave: () => void;
  onRestoreForm: () => void;
  onDismissRecovery: () => void;
}

export function PromotionDialog({
  open,
  onOpenChange,
  editingPromotion,
  formName,
  formType,
  formValue,
  formStartDate,
  formEndDate,
  formIsActive,
  formSelectedServiceIds,
  formHappyHoursStart,
  formHappyHoursEnd,
  formHappyHoursDays,
  formValueError,
  saving,
  promoWasRecovered,
  servicesList,
  onNameChange,
  onTypeChange,
  onValueChange,
  onStartDateChange,
  onEndDateChange,
  onIsActiveChange,
  onToggleHappyHoursDay,
  onToggleServiceSelection,
  onHappyHoursStartChange,
  onHappyHoursEndChange,
  onSave,
  onRestoreForm,
  onDismissRecovery,
}: PromotionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingPromotion ? "Edytuj promocje" : "Nowa promocja"}
          </DialogTitle>
        </DialogHeader>
        {promoWasRecovered && !editingPromotion && (
          <FormRecoveryBanner
            onRestore={onRestoreForm}
            onDismiss={onDismissRecovery}
          />
        )}
        <div className="space-y-4 py-4">
          {/* Name field */}
          <div>
            <Label htmlFor="promo-name">Nazwa promocji *</Label>
            <Input
              id="promo-name"
              value={formName}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={formType === "buy2get1" ? "np. Kup 2, 3. gratis" : "np. Znizka letnia 20%"}
            />
          </div>

          {/* Type selector */}
          <TypeSelector
            formType={formType}
            onTypeChange={onTypeChange}
          />

          {/* Value field */}
          <ValueField
            formType={formType}
            formValue={formValue}
            formValueError={formValueError}
            onValueChange={onValueChange}
          />

          {/* Service selection for buy2get1 */}
          {formType === "buy2get1" && (
            <ServiceCheckboxList
              servicesList={servicesList}
              selectedServiceIds={formSelectedServiceIds}
              onToggle={onToggleServiceSelection}
              label="Wybierz uslugi objete promocja *"
              idPrefix="svc"
            />
          )}

          {/* Package configuration */}
          {formType === "package" && (
            <PackageConfiguration
              servicesList={servicesList}
              selectedServiceIds={formSelectedServiceIds}
              formValue={formValue}
              onToggle={onToggleServiceSelection}
            />
          )}

          {/* Happy Hours configuration */}
          {formType === "happy_hours" && (
            <HappyHoursConfiguration
              happyHoursStart={formHappyHoursStart}
              happyHoursEnd={formHappyHoursEnd}
              happyHoursDays={formHappyHoursDays}
              onStartChange={onHappyHoursStartChange}
              onEndChange={onHappyHoursEndChange}
              onToggleDay={onToggleHappyHoursDay}
            />
          )}

          {/* Date fields */}
          <div>
            <Label htmlFor="promo-start">Data rozpoczecia</Label>
            <Input
              id="promo-start"
              type="date"
              value={formStartDate}
              onChange={(e) => onStartDateChange(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="promo-end">Data zakonczenia</Label>
            <Input
              id="promo-end"
              type="date"
              value={formEndDate}
              onChange={(e) => onEndDateChange(e.target.value)}
            />
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between">
            <Label htmlFor="promo-active">Aktywna</Label>
            <Switch
              id="promo-active"
              checked={formIsActive}
              onCheckedChange={onIsActiveChange}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Zapisywanie..." : editingPromotion ? "Zapisz zmiany" : "Utworz promocje"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Type selector with help text                                        */
/* ------------------------------------------------------------------ */

function TypeSelector({
  formType,
  onTypeChange,
}: {
  formType: string;
  onTypeChange: (type: string) => void;
}) {
  return (
    <div>
      <Label htmlFor="promo-type">Typ promocji *</Label>
      <Select value={formType} onValueChange={onTypeChange}>
        <SelectTrigger id="promo-type">
          <SelectValue placeholder="Wybierz typ" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="percentage">Procentowa (%)</SelectItem>
          <SelectItem value="fixed">Kwotowa (PLN)</SelectItem>
          <SelectItem value="package">Pakiet</SelectItem>
          <SelectItem value="buy2get1">2+1 gratis</SelectItem>
          <SelectItem value="happy_hours">Happy Hours</SelectItem>
          <SelectItem value="first_visit">Pierwsza wizyta</SelectItem>
        </SelectContent>
      </Select>
      {formType === "buy2get1" && (
        <p className="text-xs text-muted-foreground mt-1">
          Klient kupuje 2 wizyty tej samej uslugi, 3. wizyta z rabatem
        </p>
      )}
      {formType === "package" && (
        <p className="text-xs text-muted-foreground mt-1">
          Pakiet kilku uslug w obnizanej cenie. Klient rezerwuje wszystkie uslugi naraz.
        </p>
      )}
      {formType === "happy_hours" && (
        <p className="text-xs text-muted-foreground mt-1">
          Rabat procentowy obowiazujacy w wybranych godzinach i dniach tygodnia
        </p>
      )}
      {formType === "first_visit" && (
        <p className="text-xs text-muted-foreground mt-1">
          Rabat procentowy dla nowych klientow przy pierwszej wizycie w salonie
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Value input with contextual label and validation                    */
/* ------------------------------------------------------------------ */

function ValueField({
  formType,
  formValue,
  formValueError,
  onValueChange,
}: {
  formType: string;
  formValue: string;
  formValueError: string;
  onValueChange: (value: string) => void;
}) {
  const isPercentageType = formType === "percentage" || formType === "buy2get1" || formType === "happy_hours" || formType === "first_visit";

  return (
    <div>
      <Label htmlFor="promo-value">
        {formType === "buy2get1"
          ? "Znizka na 3. wizyte * (%)"
          : formType === "happy_hours"
            ? "Rabat happy hours * (%)"
            : formType === "first_visit"
              ? "Znizka na pierwsza wizyte * (%)"
              : formType === "package"
                ? "Cena pakietu * (PLN)"
                : `Wartosc rabatu * ${formType === "percentage" ? "(%)" : formType === "fixed" ? "(PLN)" : ""}`
        }
      </Label>
      <Input
        id="promo-value"
        type="number"
        min="0"
        max={isPercentageType ? "100" : undefined}
        step={isPercentageType ? "1" : "0.01"}
        value={formValue}
        onChange={(e) => onValueChange(e.target.value)}
        aria-invalid={!!formValueError}
        className={formValueError ? "border-destructive" : ""}
        placeholder={
          formType === "buy2get1"
            ? "100 = calkowicie gratis"
            : formType === "happy_hours"
              ? "np. 20"
              : formType === "first_visit"
                ? "np. 15"
                : formType === "package"
                  ? "np. 150.00"
                  : formType === "percentage"
                    ? "np. 20"
                    : "np. 50.00"
        }
      />
      {formValueError && (
        <p className="text-sm text-destructive mt-1">{formValueError}</p>
      )}
      {formType === "buy2get1" && !formValueError && (
        <p className="text-xs text-muted-foreground mt-1">
          100 = 3. wizyta calkowicie za darmo, 50 = 50% znizki na 3. wizyte
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Service checkbox list (used by buy2get1)                            */
/* ------------------------------------------------------------------ */

function ServiceCheckboxList({
  servicesList,
  selectedServiceIds,
  onToggle,
  label,
  idPrefix,
}: {
  servicesList: Service[];
  selectedServiceIds: string[];
  onToggle: (serviceId: string) => void;
  label: string;
  idPrefix: string;
}) {
  return (
    <div>
      <Label className="mb-2 block">{label}</Label>
      {servicesList.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Brak dostepnych uslug. Dodaj uslugi w panelu uslug.
        </p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-3">
          {servicesList.map((svc) => (
            <div
              key={svc.id}
              className="flex items-center space-x-2 cursor-pointer"
              onClick={() => onToggle(svc.id)}
            >
              <Checkbox
                id={`${idPrefix}-${svc.id}`}
                checked={selectedServiceIds.includes(svc.id)}
                onCheckedChange={() => onToggle(svc.id)}
              />
              <label
                htmlFor={`${idPrefix}-${svc.id}`}
                className="text-sm cursor-pointer flex-1"
              >
                {svc.name}{" "}
                <span className="text-muted-foreground">
                  ({parseFloat(svc.basePrice).toFixed(2)} PLN, {svc.baseDuration} min)
                </span>
              </label>
            </div>
          ))}
        </div>
      )}
      {selectedServiceIds.length > 0 && (
        <p className="text-xs text-muted-foreground mt-1">
          Wybrano: {selectedServiceIds.length} uslug(i)
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Package configuration section                                       */
/* ------------------------------------------------------------------ */

function PackageConfiguration({
  servicesList,
  selectedServiceIds,
  formValue,
  onToggle,
}: {
  servicesList: Service[];
  selectedServiceIds: string[];
  formValue: string;
  onToggle: (serviceId: string) => void;
}) {
  const selectedServices = servicesList.filter((s) =>
    selectedServiceIds.includes(s.id)
  );
  const totalPrice = selectedServices.reduce(
    (sum, s) => sum + parseFloat(s.basePrice),
    0
  );
  const totalDuration = selectedServices.reduce(
    (sum, s) => sum + s.baseDuration,
    0
  );
  const packagePrice = parseFloat(formValue) || 0;
  const savings = totalPrice - packagePrice;

  return (
    <div className="space-y-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
      <div className="flex items-center gap-2 mb-2">
        <Package className="w-4 h-4 text-blue-600" />
        <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
          Uslugi w pakiecie (min. 2) *
        </p>
      </div>
      {servicesList.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Brak dostepnych uslug. Dodaj uslugi w panelu uslug.
        </p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-3 bg-background">
          {servicesList.map((svc) => (
            <div
              key={svc.id}
              className="flex items-center space-x-2 cursor-pointer"
              onClick={() => onToggle(svc.id)}
            >
              <Checkbox
                id={`pkg-svc-${svc.id}`}
                checked={selectedServiceIds.includes(svc.id)}
                onCheckedChange={() => onToggle(svc.id)}
              />
              <label
                htmlFor={`pkg-svc-${svc.id}`}
                className="text-sm cursor-pointer flex-1"
              >
                {svc.name}{" "}
                <span className="text-muted-foreground">
                  ({parseFloat(svc.basePrice).toFixed(2)} PLN, {svc.baseDuration} min)
                </span>
              </label>
            </div>
          ))}
        </div>
      )}
      {selectedServiceIds.length > 0 && (
        <div className="mt-2 p-3 bg-background rounded-md border space-y-1">
          <p className="text-sm">
            <span className="text-muted-foreground">Wybrano: </span>
            <span className="font-medium">{selectedServiceIds.length} uslug</span>
          </p>
          <p className="text-sm">
            <span className="text-muted-foreground">Laczna cena indywidualna: </span>
            <span className="font-medium">{totalPrice.toFixed(2)} PLN</span>
          </p>
          <p className="text-sm">
            <span className="text-muted-foreground">Laczny czas: </span>
            <span className="font-medium">{totalDuration} min</span>
          </p>
          {packagePrice > 0 && (
            <p className="text-sm font-semibold text-green-600">
              Oszczednosc klienta: {savings.toFixed(2)} PLN
              ({totalPrice > 0 ? Math.round((savings / totalPrice) * 100) : 0}%)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Happy Hours configuration section                                   */
/* ------------------------------------------------------------------ */

function HappyHoursConfiguration({
  happyHoursStart,
  happyHoursEnd,
  happyHoursDays,
  onStartChange,
  onEndChange,
  onToggleDay,
}: {
  happyHoursStart: string;
  happyHoursEnd: string;
  happyHoursDays: number[];
  onStartChange: (time: string) => void;
  onEndChange: (time: string) => void;
  onToggleDay: (day: number) => void;
}) {
  return (
    <div className="space-y-4 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-amber-600" />
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          Konfiguracja Happy Hours
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="hh-start">Od godziny *</Label>
          <Input
            id="hh-start"
            type="time"
            value={happyHoursStart}
            onChange={(e) => onStartChange(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="hh-end">Do godziny *</Label>
          <Input
            id="hh-end"
            type="time"
            value={happyHoursEnd}
            onChange={(e) => onEndChange(e.target.value)}
          />
        </div>
      </div>

      <div>
        <Label className="mb-2 block">Dni tygodnia *</Label>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6, 0].map((day) => (
            <button
              key={day}
              type="button"
              className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                happyHoursDays.includes(day)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted border-input"
              }`}
              onClick={() => onToggleDay(day)}
              title={DAY_FULL_NAMES_PL[day]}
            >
              {DAY_NAMES_PL[day]}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Wybrano: {happyHoursDays.length} dni
        </p>
      </div>
    </div>
  );
}
