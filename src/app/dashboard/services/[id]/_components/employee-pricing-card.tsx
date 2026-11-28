"use client";

import { Plus, DollarSign, Users, Trash2, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPrice } from "../_types";
import type { ServiceDetail, Employee, EmployeePrice } from "../_types";

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
  editingEmpPrice: EmployeePrice | null;
  openEditEmployeePrice: (price: EmployeePrice) => void;
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
  editingEmpPrice,
  openEditEmployeePrice,
  resetEmpPriceForm,
  handleSaveEmployeePrice,
  handleDeleteEmployeePrice,
}: EmployeePricingCardProps) {
  // Employees that don't already have custom pricing (for the "add" dialog)
  const employeesWithoutCustomPrice = allEmployees.filter(
    (emp) =>
      !employeePrices.some((ep) => ep.employeeId === emp.id && !ep.variantId),
  );

  // Przy zmianie ceny lista ma tylko pracownika tej ceny (pole zablokowane).
  const editingEmployee = editingEmpPrice
    ? (allEmployees.find((emp) => emp.id === editingEmpPrice.employeeId) ??
      editingEmpPrice.employee)
    : null;
  const dialogEmployees: Employee[] = editingEmpPrice
    ? editingEmployee
      ? [editingEmployee]
      : []
    : employeesWithoutCustomPrice;

  return (
    <Card data-testid="employee-pricing-section">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">
            Ceny indywidualne pracowników
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
              Ustaw cenę
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[450px]">
            <DialogHeader>
              <DialogTitle>
                {editingEmpPrice
                  ? "Zmień cenę indywidualną"
                  : "Ustaw cenę indywidualną"}
              </DialogTitle>
              <DialogDescription>
                Ustaw indywidualną cenę za tę usługę dla wybranego pracownika.
                Ta cena będzie wyświetlana zamiast ceny bazowej przy rezerwacji
                wizyty u tego pracownika.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="emp-price-employee">Pracownik *</Label>
                <Select
                  value={empPriceEmployeeId}
                  onValueChange={setEmpPriceEmployeeId}
                  disabled={editingEmpPrice !== null}
                >
                  <SelectTrigger
                    id="emp-price-employee"
                    data-testid="employee-price-select"
                  >
                    <SelectValue placeholder="Wybierz pracownika" />
                  </SelectTrigger>
                  <SelectContent>
                    {editingEmpPrice && dialogEmployees.length === 0 ? (
                      <SelectItem value={editingEmpPrice.employeeId}>
                        Nieznany pracownik
                      </SelectItem>
                    ) : dialogEmployees.length === 0 ? (
                      <SelectItem value="__none" disabled>
                        Wszyscy pracownicy mają już ceny
                      </SelectItem>
                    ) : (
                      dialogEmployees.map((emp) => (
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
                                (właściciel)
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
                  Cena bazowa usługi: {formatPrice(service.basePrice)} PLN.
                  Wprowadź cenę, która będzie stosowana zamiast niej dla tego
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
                {savingEmpPrice ? "Zapisywanie..." : "Zapisz cenę"}
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
              Brak indywidualnych cen. Wszyscy pracownicy stosują cenę bazową (
              {formatPrice(service.basePrice)} PLN).
            </p>
            <Button
              variant="outline"
              onClick={() => setEmpPriceDialogOpen(true)}
              data-testid="empty-state-add-employee-price-btn"
            >
              <Plus className="h-4 w-4 mr-2" />
              Ustaw pierwszą cenę indywidualną
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
              const employeeName = ep.employee
                ? `${ep.employee.firstName} ${ep.employee.lastName}`
                : "Nieznany pracownik";

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
                        {employeeName}
                      </span>
                      {ep.employee?.role === "owner" && (
                        <Badge variant="outline" className="text-xs">
                          właściciel
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
                    {/* Panel ustawia tylko ceny bez wariantu i tylko takie zmienia. */}
                    {!ep.variantId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditEmployeePrice(ep)}
                        aria-label={`Zmień cenę: ${employeeName}`}
                        data-testid={`edit-employee-price-${ep.id}`}
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Zmień cenę
                      </Button>
                    )}
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
