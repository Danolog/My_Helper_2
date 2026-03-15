"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  Calendar,
  Clock,
  ChevronDown,
  ChevronUp,
  Scissors,
  History,
  FlaskConical,
  Wrench,
  FileText,
  Edit3,
  Check,
  Package,
  Plus,
  X,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { getStatusLabel, getStatusVariant, formatDuration } from "./utils";
import { mutationFetch } from "@/lib/api-client";
import type { AppointmentData } from "./types";

interface ClientHistoryTabProps {
  clientId: string;
}

/**
 * Visit history tab for the client detail page.
 * Fetches appointment history on mount, displays expandable appointment cards
 * with treatment record editing and materials usage display.
 */
export function ClientHistoryTab({ clientId }: ClientHistoryTabProps) {
  const [visitHistory, setVisitHistory] = useState<AppointmentData[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [expandedAppointmentId, setExpandedAppointmentId] = useState<string | null>(null);

  // Treatment form state
  const [editingTreatmentId, setEditingTreatmentId] = useState<string | null>(null);
  const [treatmentRecipe, setTreatmentRecipe] = useState("");
  const [treatmentTechniques, setTreatmentTechniques] = useState("");
  const [treatmentNotes, setTreatmentNotes] = useState("");
  const [savingTreatment, setSavingTreatment] = useState(false);

  const fetchVisitHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/appointments`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setVisitHistory(data.data as AppointmentData[]);
      } else {
        toast.error("Nie udalo sie zaladowac historii wizyt");
      }
    } catch {
      toast.error("Blad podczas ladowania historii wizyt");
    } finally {
      setLoadingHistory(false);
      setHasFetched(true);
    }
  }, [clientId]);

  // Fetch on first render (tab activation is handled by parent calling onTabActivate)
  // We use a ref-like pattern via hasFetched to avoid double-fetch
  if (!hasFetched && !loadingHistory) {
    fetchVisitHistory();
  }

  const toggleAppointmentExpanded = (appointmentId: string) => {
    setExpandedAppointmentId((prev) =>
      prev === appointmentId ? null : appointmentId
    );
  };

  const startEditingTreatment = (appointment: AppointmentData) => {
    setEditingTreatmentId(appointment.id);
    setTreatmentRecipe(appointment.treatment?.recipe || "");
    setTreatmentTechniques(appointment.treatment?.techniques || "");
    setTreatmentNotes(appointment.treatment?.notes || "");
  };

  const cancelEditingTreatment = () => {
    setEditingTreatmentId(null);
    setTreatmentRecipe("");
    setTreatmentTechniques("");
    setTreatmentNotes("");
  };

  const handleSaveTreatment = async (appointmentId: string) => {
    setSavingTreatment(true);
    try {
      const res = await mutationFetch(`/api/appointments/${appointmentId}/treatment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipe: treatmentRecipe.trim() || null,
          techniques: treatmentTechniques.trim() || null,
          notes: treatmentNotes.trim() || null,
          materialsJson: [],
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Karta zabiegu zostala zapisana");
        // Update the visit history with the new treatment data
        setVisitHistory((prev) =>
          prev.map((apt) =>
            apt.id === appointmentId
              ? {
                  ...apt,
                  status: apt.status === "scheduled" || apt.status === "confirmed" ? "completed" : apt.status,
                  treatment: {
                    id: data.data.id,
                    recipe: data.data.recipe,
                    techniques: data.data.techniques,
                    materialsJson: data.data.materialsJson || [],
                    notes: data.data.notes,
                    createdAt: data.data.createdAt,
                  },
                }
              : apt
          )
        );
        setEditingTreatmentId(null);
        setTreatmentRecipe("");
        setTreatmentTechniques("");
        setTreatmentNotes("");
      } else {
        toast.error(data.error || "Nie udalo sie zapisac karty zabiegu");
      }
    } catch {
      toast.error("Blad podczas zapisywania karty zabiegu");
    } finally {
      setSavingTreatment(false);
    }
  };

  return (
    <Card data-testid="visit-history-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Historia wizyt</CardTitle>
          </div>
          <Badge variant="secondary" data-testid="visit-count-badge">
            {visitHistory.length} {visitHistory.length === 1 ? "wizyta" : visitHistory.length >= 2 && visitHistory.length <= 4 ? "wizyty" : "wizyt"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {loadingHistory ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : visitHistory.length === 0 ? (
          <div className="text-center py-12" data-testid="no-visits-message">
            <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-muted-foreground text-lg font-medium">Brak historii wizyt</p>
            <p className="text-muted-foreground text-sm mt-1">
              Ten klient nie ma jeszcze zadnych wizyt
            </p>
          </div>
        ) : (
          <div className="space-y-3" data-testid="visit-history-list">
            {visitHistory.map((appointment) => {
              const isExpanded = expandedAppointmentId === appointment.id;
              const startDate = new Date(appointment.startTime);
              const endDate = new Date(appointment.endTime);
              const durationMs = endDate.getTime() - startDate.getTime();
              const durationMin = Math.round(durationMs / 60000);

              return (
                <div
                  key={appointment.id}
                  className="border rounded-lg overflow-hidden transition-all"
                  data-testid={`appointment-item-${appointment.id}`}
                >
                  {/* Appointment summary row - clickable */}
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors text-left"
                    onClick={() => toggleAppointmentExpanded(appointment.id)}
                    data-testid={`appointment-toggle-${appointment.id}`}
                  >
                    {/* Date column */}
                    <div className="flex flex-col items-center min-w-[60px]">
                      <span className="text-2xl font-bold text-primary">
                        {startDate.getDate()}
                      </span>
                      <span className="text-xs text-muted-foreground uppercase">
                        {startDate.toLocaleDateString("pl-PL", { month: "short" })}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {startDate.getFullYear()}
                      </span>
                    </div>

                    <Separator orientation="vertical" className="h-12" />

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {appointment.service ? (
                          <span className="font-medium truncate" data-testid="appointment-service-name">
                            {appointment.service.name}
                          </span>
                        ) : (
                          <span className="font-medium text-muted-foreground italic">
                            Brak uslugi
                          </span>
                        )}
                        <Badge
                          variant={getStatusVariant(appointment.status)}
                          className="text-xs shrink-0"
                          data-testid="appointment-status-badge"
                        >
                          {getStatusLabel(appointment.status)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {startDate.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                          {" - "}
                          {endDate.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        {appointment.employee && (
                          <span className="flex items-center gap-1" data-testid="appointment-employee-name">
                            <User className="h-3.5 w-3.5" />
                            {appointment.employee.firstName} {appointment.employee.lastName}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Expand/collapse icon */}
                    <div className="shrink-0">
                      {isExpanded ? (
                        <ChevronUp className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div
                      className="border-t bg-muted/30 p-4 space-y-3"
                      data-testid={`appointment-details-${appointment.id}`}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Date and time */}
                        <div>
                          <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Data i godzina</p>
                          <p className="text-sm flex items-center gap-1.5">
                            <Calendar className="h-4 w-4 text-primary" />
                            {startDate.toLocaleDateString("pl-PL", {
                              weekday: "long",
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                            })}
                          </p>
                          <p className="text-sm flex items-center gap-1.5 mt-1">
                            <Clock className="h-4 w-4 text-primary" />
                            {startDate.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                            {" - "}
                            {endDate.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                            {" "}
                            <span className="text-muted-foreground">({formatDuration(durationMin)})</span>
                          </p>
                        </div>

                        {/* Service */}
                        <div>
                          <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Usluga</p>
                          {appointment.service ? (
                            <div>
                              <p className="text-sm flex items-center gap-1.5">
                                <Scissors className="h-4 w-4 text-primary" />
                                {appointment.service.name}
                              </p>
                              <p className="text-sm text-muted-foreground mt-1">
                                Cena bazowa: {parseFloat(appointment.service.basePrice).toFixed(2)} PLN
                                {" | "}
                                Czas: {formatDuration(appointment.service.baseDuration)}
                              </p>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">Brak przypisanej uslugi</p>
                          )}
                        </div>

                        {/* Employee */}
                        <div>
                          <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Pracownik</p>
                          {appointment.employee ? (
                            <p className="text-sm flex items-center gap-1.5">
                              <User className="h-4 w-4 text-primary" />
                              {appointment.employee.firstName} {appointment.employee.lastName}
                              {appointment.employee.color && (
                                <span
                                  className="inline-block w-3 h-3 rounded-full border"
                                  style={{ backgroundColor: appointment.employee.color }}
                                />
                              )}
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">Brak pracownika</p>
                          )}
                        </div>

                        {/* Status */}
                        <div>
                          <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Status</p>
                          <Badge
                            variant={getStatusVariant(appointment.status)}
                            className="text-xs"
                          >
                            {getStatusLabel(appointment.status)}
                          </Badge>
                        </div>

                        {/* Deposit */}
                        {appointment.depositAmount && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Zadatek</p>
                            <p className="text-sm">
                              {parseFloat(appointment.depositAmount).toFixed(2)} PLN
                              {" - "}
                              <span className={appointment.depositPaid ? "text-green-600" : "text-orange-600"}>
                                {appointment.depositPaid ? "Oplacony" : "Nieoplacony"}
                              </span>
                            </p>
                          </div>
                        )}

                        {/* Notes */}
                        {appointment.notes && (
                          <div className="sm:col-span-2">
                            <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Notatki</p>
                            <p className="text-sm">{appointment.notes}</p>
                          </div>
                        )}
                      </div>

                      {/* Treatment History Section */}
                      <Separator />
                      <div data-testid={`treatment-section-${appointment.id}`}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <FlaskConical className="h-4 w-4 text-purple-500" />
                            <p className="text-sm font-semibold">Karta zabiegu</p>
                          </div>
                          {editingTreatmentId !== appointment.id && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => startEditingTreatment(appointment)}
                              data-testid={`edit-treatment-btn-${appointment.id}`}
                            >
                              {appointment.treatment ? (
                                <>
                                  <Edit3 className="h-3.5 w-3.5 mr-1" />
                                  Edytuj
                                </>
                              ) : (
                                <>
                                  <Plus className="h-3.5 w-3.5 mr-1" />
                                  Dodaj karte zabiegu
                                </>
                              )}
                            </Button>
                          )}
                        </div>

                        {/* Show existing treatment details (read-only) */}
                        {appointment.treatment && editingTreatmentId !== appointment.id && (
                          <div className="space-y-3 bg-purple-50 dark:bg-purple-950/20 rounded-lg p-3 border border-purple-200 dark:border-purple-800" data-testid={`treatment-details-${appointment.id}`}>
                            {appointment.treatment.recipe && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground uppercase mb-1 flex items-center gap-1">
                                  <FlaskConical className="h-3 w-3" />
                                  Receptura / Formula
                                </p>
                                <p className="text-sm whitespace-pre-wrap" data-testid={`treatment-recipe-${appointment.id}`}>
                                  {appointment.treatment.recipe}
                                </p>
                              </div>
                            )}
                            {appointment.treatment.techniques && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground uppercase mb-1 flex items-center gap-1">
                                  <Wrench className="h-3 w-3" />
                                  Zastosowane techniki
                                </p>
                                <p className="text-sm whitespace-pre-wrap" data-testid={`treatment-techniques-${appointment.id}`}>
                                  {appointment.treatment.techniques}
                                </p>
                              </div>
                            )}
                            {appointment.treatment.notes && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground uppercase mb-1 flex items-center gap-1">
                                  <FileText className="h-3 w-3" />
                                  Notatki zabiegu
                                </p>
                                <p className="text-sm whitespace-pre-wrap" data-testid={`treatment-notes-${appointment.id}`}>
                                  {appointment.treatment.notes}
                                </p>
                              </div>
                            )}
                            {!appointment.treatment.recipe && !appointment.treatment.techniques && !appointment.treatment.notes && (
                              <p className="text-sm text-muted-foreground italic">Karta zabiegu jest pusta</p>
                            )}
                          </div>
                        )}

                        {/* No treatment - show placeholder */}
                        {!appointment.treatment && editingTreatmentId !== appointment.id && (
                          <p className="text-sm text-muted-foreground italic" data-testid={`no-treatment-${appointment.id}`}>
                            Brak karty zabiegu - kliknij &quot;Dodaj karte zabiegu&quot; aby uzupelnic
                          </p>
                        )}

                        {/* Treatment edit form */}
                        {editingTreatmentId === appointment.id && (
                          <div className="space-y-4 bg-purple-50 dark:bg-purple-950/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800" data-testid={`treatment-form-${appointment.id}`}>
                            <div>
                              <Label htmlFor={`recipe-${appointment.id}`} className="text-sm font-medium flex items-center gap-1 mb-1.5">
                                <FlaskConical className="h-3.5 w-3.5 text-purple-500" />
                                Receptura / Formula
                              </Label>
                              <Textarea
                                id={`recipe-${appointment.id}`}
                                placeholder="np. Farba Wella Koleston 7/0 + 6% oksydant, proporcja 1:1, 30ml"
                                value={treatmentRecipe}
                                onChange={(e) => setTreatmentRecipe(e.target.value)}
                                rows={3}
                                data-testid={`treatment-recipe-input-${appointment.id}`}
                              />
                            </div>
                            <div>
                              <Label htmlFor={`techniques-${appointment.id}`} className="text-sm font-medium flex items-center gap-1 mb-1.5">
                                <Wrench className="h-3.5 w-3.5 text-purple-500" />
                                Zastosowane techniki
                              </Label>
                              <Textarea
                                id={`techniques-${appointment.id}`}
                                placeholder="np. Balayage, ombre, pasemka foliowe, tonowanie"
                                value={treatmentTechniques}
                                onChange={(e) => setTreatmentTechniques(e.target.value)}
                                rows={2}
                                data-testid={`treatment-techniques-input-${appointment.id}`}
                              />
                            </div>
                            <div>
                              <Label htmlFor={`treatment-notes-${appointment.id}`} className="text-sm font-medium flex items-center gap-1 mb-1.5">
                                <FileText className="h-3.5 w-3.5 text-purple-500" />
                                Notatki zabiegu
                              </Label>
                              <Textarea
                                id={`treatment-notes-${appointment.id}`}
                                placeholder="Dodatkowe informacje o zabiegu, reakcje klienta, zalecenia..."
                                value={treatmentNotes}
                                onChange={(e) => setTreatmentNotes(e.target.value)}
                                rows={2}
                                data-testid={`treatment-notes-input-${appointment.id}`}
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                onClick={() => handleSaveTreatment(appointment.id)}
                                disabled={savingTreatment}
                                data-testid={`save-treatment-btn-${appointment.id}`}
                              >
                                <Check className="h-3.5 w-3.5 mr-1" />
                                {savingTreatment ? "Zapisywanie..." : "Zapisz karte zabiegu"}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={cancelEditingTreatment}
                                disabled={savingTreatment}
                                data-testid={`cancel-treatment-btn-${appointment.id}`}
                              >
                                <X className="h-3.5 w-3.5 mr-1" />
                                Anuluj
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Materials Used Section */}
                      {appointment.materials && appointment.materials.length > 0 && (
                        <>
                          <Separator />
                          <div data-testid={`materials-section-${appointment.id}`}>
                            <div className="flex items-center gap-2 mb-3">
                              <Package className="h-4 w-4 text-green-600" />
                              <p className="text-sm font-semibold">Uzyte materialy</p>
                              <Badge variant="secondary" className="text-xs" data-testid={`materials-count-${appointment.id}`}>
                                {appointment.materials.length}
                              </Badge>
                            </div>
                            <div className="space-y-2 bg-green-50 dark:bg-green-950/20 rounded-lg p-3 border border-green-200 dark:border-green-800">
                              {appointment.materials.map((material) => {
                                const cost = material.product?.pricePerUnit
                                  ? (parseFloat(material.quantityUsed) * parseFloat(material.product.pricePerUnit)).toFixed(2)
                                  : null;
                                return (
                                  <div
                                    key={material.id}
                                    className="text-sm"
                                    data-testid={`material-row-${material.id}`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <Package className="h-3.5 w-3.5 text-green-600 shrink-0" />
                                        <span className="font-medium truncate" data-testid={`material-name-${material.id}`}>
                                          {material.product?.name || "Nieznany produkt"}
                                        </span>
                                        {material.product?.category && (
                                          <Badge variant="secondary" className="text-xs shrink-0">
                                            {material.product.category}
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-3 text-muted-foreground shrink-0 ml-2">
                                        <span data-testid={`material-qty-${material.id}`}>
                                          {material.quantityUsed} {material.product?.unit || "szt."}
                                        </span>
                                        {cost && (
                                          <span className="font-medium text-foreground">
                                            {cost} PLN
                                          </span>
                                        )}
                                        <Link
                                          href="/dashboard/products"
                                          className="text-primary hover:underline text-xs"
                                          data-testid={`material-product-link-${material.id}`}
                                        >
                                          Magazyn
                                        </Link>
                                      </div>
                                    </div>
                                    {material.notes && (
                                      <p className="text-xs text-muted-foreground ml-5.5 mt-0.5">
                                        {material.notes}
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                              {/* Total material cost */}
                              {(() => {
                                const totalCost = appointment.materials.reduce((sum, m) => {
                                  if (m.product?.pricePerUnit) {
                                    return sum + parseFloat(m.quantityUsed) * parseFloat(m.product.pricePerUnit);
                                  }
                                  return sum;
                                }, 0);
                                if (totalCost > 0) {
                                  return (
                                    <div className="flex justify-between items-center pt-2 mt-2 border-t border-green-300 dark:border-green-700">
                                      <span className="text-sm font-medium">Laczny koszt materialow:</span>
                                      <span className="text-sm font-bold" data-testid={`materials-total-cost-${appointment.id}`}>
                                        {totalCost.toFixed(2)} PLN
                                      </span>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          </div>
                        </>
                      )}

                      {/* Appointment ID */}
                      <div className="pt-2 border-t">
                        <p className="text-xs text-muted-foreground">
                          ID wizyty: {appointment.id}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Utworzono: {new Date(appointment.createdAt).toLocaleString("pl-PL")}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
