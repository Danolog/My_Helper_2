"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { toast } from "sonner";
import { Ban, User, Clock } from "lucide-react";

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  color: string | null;
}

interface BlockTimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Employee[];
  defaultDate?: Date;
  onBlockCreated: () => void;
}

const BLOCK_TYPES = [
  { value: "break", label: "Przerwa" },
  { value: "vacation", label: "Urlop" },
  { value: "personal", label: "Osobiste" },
  { value: "holiday", label: "Swięto" },
  { value: "other", label: "Inne" },
] as const;

export function BlockTimeDialog({
  open,
  onOpenChange,
  employees,
  defaultDate,
  onBlockCreated,
}: BlockTimeDialogProps) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [blockType, setBlockType] = useState("break");
  const [blockDate, setBlockDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Set default date when dialog opens
  useEffect(() => {
    if (open) {
      const dateToUse = defaultDate || new Date();
      const yyyy = dateToUse.getFullYear();
      const mm = String(dateToUse.getMonth() + 1).padStart(2, "0");
      const dd = String(dateToUse.getDate()).padStart(2, "0");
      setBlockDate(`${yyyy}-${mm}-${dd}`);
    }
  }, [open, defaultDate]);

  const resetForm = () => {
    setSelectedEmployeeId("");
    setBlockType("break");
    setStartTime("");
    setEndTime("");
    setReason("");
  };

  const handleSubmit = async () => {
    // Validate required fields
    if (!selectedEmployeeId) {
      toast.error("Wybierz pracownika");
      return;
    }
    if (!blockDate) {
      toast.error("Wybierz date");
      return;
    }
    if (!startTime) {
      toast.error("Wybierz godzine rozpoczecia");
      return;
    }
    if (!endTime) {
      toast.error("Wybierz godzine zakonczenia");
      return;
    }

    // Validate time range
    if (startTime >= endTime) {
      toast.error("Godzina rozpoczecia musi byc wczesniejsza niz zakonczenia");
      return;
    }

    setSubmitting(true);
    try {
      const startDateTime = new Date(`${blockDate}T${startTime}:00`);
      const endDateTime = new Date(`${blockDate}T${endTime}:00`);

      const response = await fetch("/api/time-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: selectedEmployeeId,
          startTime: startDateTime.toISOString(),
          endTime: endDateTime.toISOString(),
          blockType,
          reason: reason.trim() || null,
        }),
      });

      const data = await response.json();

      if (data.success) {
        const typeLabel = BLOCK_TYPES.find((t) => t.value === blockType)?.label || blockType;
        toast.success("Czas zostal zablokowany", {
          description: `${typeLabel}: ${startTime} - ${endTime}`,
        });
        resetForm();
        onOpenChange(false);
        onBlockCreated();
      } else {
        toast.error("Nie udalo sie zablokowac czasu", {
          description: data.error,
        });
      }
    } catch (error) {
      console.error("Failed to create time block:", error);
      toast.error("Blad podczas blokowania czasu");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="max-w-md" data-testid="block-time-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5 text-destructive" />
            Zablokuj czas
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Employee Selection */}
          <div>
            <Label className="flex items-center gap-1.5 mb-1.5">
              <User className="h-3.5 w-3.5" />
              Pracownik *
            </Label>
            <Select
              value={selectedEmployeeId}
              onValueChange={setSelectedEmployeeId}
            >
              <SelectTrigger data-testid="block-employee-select">
                <SelectValue placeholder="Wybierz pracownika" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    <span className="flex items-center gap-2">
                      {emp.color && (
                        <span
                          className="inline-block w-3 h-3 rounded-full border"
                          style={{ backgroundColor: emp.color }}
                        />
                      )}
                      {emp.firstName} {emp.lastName}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Block Type */}
          <div>
            <Label className="mb-1.5 block">Typ blokady *</Label>
            <Select
              value={blockType}
              onValueChange={setBlockType}
            >
              <SelectTrigger data-testid="block-type-select">
                <SelectValue placeholder="Wybierz typ" />
              </SelectTrigger>
              <SelectContent>
                {BLOCK_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date and Time */}
          <div>
            <Label className="flex items-center gap-1.5 mb-1.5">
              <Clock className="h-3.5 w-3.5" />
              Data i godziny *
            </Label>
            <div className="space-y-3">
              <Input
                type="date"
                value={blockDate}
                onChange={(e) => setBlockDate(e.target.value)}
                data-testid="block-date-input"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Od</Label>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    step="900"
                    data-testid="block-start-time"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Do</Label>
                  <Input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    step="900"
                    data-testid="block-end-time"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Reason */}
          <div>
            <Label className="mb-1.5 block">Powod (opcjonalnie)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Np. wizyta lekarska, szkolenie..."
              data-testid="block-reason-input"
            />
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={() => { resetForm(); onOpenChange(false); }}
            data-testid="block-cancel-btn"
          >
            Anuluj
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !selectedEmployeeId || !blockDate || !startTime || !endTime}
            data-testid="block-save-btn"
          >
            {submitting ? "Zapisywanie..." : "Zablokuj"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
