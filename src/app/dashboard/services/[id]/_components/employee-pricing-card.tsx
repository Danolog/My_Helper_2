"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, DollarSign, Users, Trash2 } from "lucide-react";
import type { ServiceDetail, Employee, EmployeePrice } from "../_types";
import { formatPrice } from "../_types";

interface EmployeePricingCardProps {
  service: ServiceDetail;
  employeePrices: EmployeePrice[];
  allEmployees: Employee[];
  empPriceDialogOpen: boolean;
  setEmpPriceDialogOpen: (open: boolean) => void;
  empPriceEmployeeId: string;
  setEmpPriceEmployeeId: (value: string) => void;
  empPriceCustomPrice: string;
  setEmpPriceCustomPrice: (value: string) => void;
  savingEmpPrice: boolean;
  resetEmpPriceForm: () => void;
  handleSaveEmployeePrice: () => Promise<void>;
  handleDeleteEmployeePrice: (price: EmployeePrice) => Promise<void>;
}

export function EmployeePricingCard({
  service,
  employeePrices,
  allEmployees,
  empPriceDialogOpen,
  setEmpPriceDialogOpen,
  empPriceEmployeeId,
  setEmpPriceEmployeeId,
  empPriceCustomPrice,
  setEmpPriceCustomPrice,
  savingEmpPrice,
  resetEmpPriceForm,
  handleSaveEmployeePrice,
  handleDeleteEmployeePrice,
}: EmployeePricingCardProps) {
  // Employees that don't already have custom pricing (for the "add" dialog)
  const employeesWithoutCustomPrice = allEmployees.filter(
    (emp) =>
      !employeePrices.some((ep) => ep.employeeId === emp.id && !ep.variantId),
  );

  return (
    <Card data-testid="employee-pricing-section">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">
            Ceny indywidualne pracownikow
          </CardTitle>
          <Badge variant="outline" data-testid="employee-prices-count">
            {employeePrices.length}
          </Badge>
        </div>
        <Dialog
          open={empPriceDialogOpen}
          onOpenChange={(open) => {
            setEmpPriceDialogOpen(open);
            if (!open) resetEmpPriceForm();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" data-testid="add-employee-price-btn">
              <Plus className="h-4 w-4 mr-2" />
              Ustaw cene
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[450px]">
            <DialogHeader>
              <DialogTitle>Ustaw cene indywidualna</DialogTitle>
              <DialogDescription>
                Ustaw indywidualna cene za ta usluge dla wybranego pracownika.
                Cena ta bedzie wyswietlana zamiast ceny bazowej przy rezerwacji
                wizyty u tego pracownika.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="emp-price-employee">Pracownik *</Label>
                <Select
                  value={empPriceEmployeeId}
                  onValueChange={setEmpPriceEmployeeId}
                >
                  <SelectTrigger
                    id="emp-price-employee"
                    data-testid="employee-price-select"
                  >
                    <SelectValue placeholder="Wybierz pracownika" />
                  </SelectTrigger>
                  <SelectContent>
                    {employeesWithoutCustomPrice.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        Wszyscy pracownicy maja juz ceny
                      </SelectItem>
                    ) : (
                      employeesWithoutCustomPrice.map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          <div className="flex items-center gap-2">
                            {emp.color && (
                              <span
                                className="inline-block w-3 h-3 rounded-full"
                                style={{ backgroundColor: emp.color }}
                              />
                            )}
                            {emp.firstName} {emp.lastName}
                            {emp.role === "owner" && (
                              <span className="text-xs text-muted-foreground">
                                (wlasciciel)
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="emp-price-value">
                  Cena indywidualna (PLN) *
                </Label>
                <Input
                  id="emp-price-value"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={service.basePrice}
                  value={empPriceCustomPrice}
                  onChange={(e) => setEmpPriceCustomPrice(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      !/[0-9]/.test(e.key) &&
                      ![
                        "Backspace",
                        "Delete",
                        "Tab",
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                        "Home",
                        "End",
                        ".",
                        ",",
                      ].includes(e.key) &&
                      !e.ctrlKey &&
                      !e.metaKey
                    ) {
                      e.preventDefault();
                    }
                    if (e.key === "-") e.preventDefault();
                  }}
                  data-testid="employee-price-input"
                />
                <p className="text-xs text-muted-foreground">
                  Cena bazowa uslugi: {formatPrice(service.basePrice)} PLN.
                  Wprowadz cene, ktora zamiast niej bedzie stosowana dla tego
                  pracownika.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  resetEmpPriceForm();
                  setEmpPriceDialogOpen(false);
                }}
              >
                Anuluj
              </Button>
              <Button
                onClick={handleSaveEmployeePrice}
                disabled={savingEmpPrice}
                data-testid="save-employee-price-btn"
              >
                {savingEmpPrice ? "Zapisywanie..." : "Zapisz cene"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {employeePrices.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p
              className="text-muted-foreground mb-4"
              data-testid="no-employee-prices-message"
            >
              Brak indywidualnych cen. Wszyscy pracownicy stosuja cene bazowa (
              {formatPrice(service.basePrice)} PLN).
            </p>
            <Button
              variant="outline"
              onClick={() => setEmpPriceDialogOpen(true)}
              data-testid="empty-state-add-employee-price-btn"
            >
              <Plus className="h-4 w-4 mr-2" />
              Ustaw pierwsza cene indywidualna
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {employeePrices.map((ep) => {
              const basePrice = parseFloat(service.basePrice);
              const customPrice = parseFloat(ep.customPrice);
              const diff = customPrice - basePrice;
              const diffPercent =
                basePrice > 0
                  ? ((diff / basePrice) * 100).toFixed(0)
                  : "0";

              return (
                <div
                  key={ep.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                  data-testid={`employee-price-card-${ep.id}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {ep.employee?.color && (
                        <span
                          className="inline-block w-3 h-3 rounded-full"
                          style={{ backgroundColor: ep.employee.color }}
                        />
                      )}
                      <span
                        className="font-medium"
                        data-testid={`employee-price-name-${ep.id}`}
                      >
                        {ep.employee
                          ? `${ep.employee.firstName} ${ep.employee.lastName}`
                          : "Nieznany pracownik"}
                      </span>
                      {ep.employee?.role === "owner" && (
                        <Badge variant="outline" className="text-xs">
                          wlasciciel
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <DollarSign className="h-3.5 w-3.5" />
                        <span
                          className="font-medium text-foreground"
                          data-testid={`employee-price-value-${ep.id}`}
                        >
                          {formatPrice(ep.customPrice)} PLN
                        </span>
                      </span>
                      <span
                        className={`text-xs ${
                          diff > 0
                            ? "text-red-500"
                            : diff < 0
                              ? "text-green-500"
                              : "text-muted-foreground"
                        }`}
                        data-testid={`employee-price-diff-${ep.id}`}
                      >
                        {diff > 0 ? "+" : ""}
                        {diff.toFixed(2)} PLN ({diff >= 0 ? "+" : ""}
                        {diffPercent}% od ceny bazowej)
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteEmployeePrice(ep)}
                      data-testid={`delete-employee-price-${ep.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
