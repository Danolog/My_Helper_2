"use client";

import { Palmtree, Plus, Trash2, CalendarDays, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BLOCK_TYPE_LABELS, BLOCK_TYPE_COLORS } from "../_hooks/use-schedule-data";
import type { TimeBlock } from "../_hooks/use-schedule-data";

interface ScheduleTimeBlocksProps {
  timeBlocksList: TimeBlock[];
  loadingBlocks: boolean;
  showAddVacation: boolean;
  newVacation: {
    startDate: string;
    endDate: string;
    blockType: string;
    reason: string;
  };
  savingVacation: boolean;
  deletingBlockId: string | null;
  upcomingBlocks: TimeBlock[];
  pastBlocks: TimeBlock[];
  onShowAddVacation: (show: boolean) => void;
  onNewVacationChange: React.Dispatch<React.SetStateAction<{
    startDate: string;
    endDate: string;
    blockType: string;
    reason: string;
  }>>;
  onAddVacation: () => Promise<void>;
  onDeleteBlock: (blockId: string) => Promise<void>;
  formatBlockDateRange: (startStr: string, endStr: string) => string;
}

export function ScheduleTimeBlocks({
  timeBlocksList,
  loadingBlocks,
  showAddVacation,
  newVacation,
  savingVacation,
  deletingBlockId,
  upcomingBlocks,
  pastBlocks,
  onShowAddVacation,
  onNewVacationChange,
  onAddVacation,
  onDeleteBlock,
  formatBlockDateRange,
}: ScheduleTimeBlocksProps) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Palmtree className="h-5 w-5 text-orange-500" />
            <div>
              <CardTitle>Urlopy i dni wolne</CardTitle>
              <CardDescription>
                Zaplanuj urlopy, dni wolne i inne blokady czasu.
                Rezerwacje nie beda mozliwe w wybranych terminach.
              </CardDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onShowAddVacation(!showAddVacation)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Dodaj urlop
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Add vacation form */}
        {showAddVacation && (
          <div className="mb-6 p-4 rounded-lg border border-dashed border-primary/50 bg-primary/5">
            <h4 className="font-medium mb-3">Nowy urlop / dzien wolny</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <Label htmlFor="vacationStart">Data rozpoczecia</Label>
                <Input
                  id="vacationStart"
                  type="date"
                  value={newVacation.startDate}
                  onChange={(e) =>
                    onNewVacationChange((prev) => ({ ...prev, startDate: e.target.value }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="vacationEnd">Data zakonczenia</Label>
                <Input
                  id="vacationEnd"
                  type="date"
                  value={newVacation.endDate}
                  onChange={(e) =>
                    onNewVacationChange((prev) => ({ ...prev, endDate: e.target.value }))
                  }
                  className="mt-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <Label htmlFor="blockType">Typ</Label>
                <select
                  id="blockType"
                  value={newVacation.blockType}
                  onChange={(e) =>
                    onNewVacationChange((prev) => ({ ...prev, blockType: e.target.value }))
                  }
                  className="mt-1 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="vacation">Urlop</option>
                  <option value="holiday">Dzien wolny</option>
                  <option value="personal">Czas osobisty</option>
                  <option value="other">Inne</option>
                </select>
              </div>
              <div>
                <Label htmlFor="vacationReason">Powod (opcjonalnie)</Label>
                <Input
                  id="vacationReason"
                  type="text"
                  placeholder="np. Urlop wypoczynkowy"
                  value={newVacation.reason}
                  onChange={(e) =>
                    onNewVacationChange((prev) => ({ ...prev, reason: e.target.value }))
                  }
                  className="mt-1"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={onAddVacation} disabled={savingVacation} size="sm">
                {savingVacation ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Zapisywanie...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    Potwierdz
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onShowAddVacation(false);
                  onNewVacationChange({ startDate: "", endDate: "", blockType: "vacation", reason: "" });
                }}
              >
                Anuluj
              </Button>
            </div>
          </div>
        )}

        {/* Time blocks list */}
        {loadingBlocks ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        ) : timeBlocksList.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Palmtree className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>Brak zaplanowanych urlopow i dni wolnych</p>
            <p className="text-sm mt-1">
              Kliknij &quot;Dodaj urlop&quot; aby dodac nowy
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingBlocks.length > 0 && (
              <>
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Nadchodzace
                </h4>
                {upcomingBlocks.map((block) => (
                  <TimeBlockRow
                    key={block.id}
                    block={block}
                    deletingBlockId={deletingBlockId}
                    onDelete={onDeleteBlock}
                    formatBlockDateRange={formatBlockDateRange}
                  />
                ))}
              </>
            )}

            {pastBlocks.length > 0 && (
              <>
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mt-4 mb-2">
                  Przeszle
                </h4>
                {pastBlocks.map((block) => (
                  <TimeBlockRow
                    key={block.id}
                    block={block}
                    deletingBlockId={deletingBlockId}
                    onDelete={onDeleteBlock}
                    formatBlockDateRange={formatBlockDateRange}
                    isPast
                  />
                ))}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Extracted row component to avoid duplication between upcoming and past blocks
function TimeBlockRow({
  block,
  deletingBlockId,
  onDelete,
  formatBlockDateRange,
  isPast = false,
}: {
  block: TimeBlock;
  deletingBlockId: string | null;
  onDelete: (blockId: string) => Promise<void>;
  formatBlockDateRange: (startStr: string, endStr: string) => string;
  isPast?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg border ${
        isPast ? "bg-muted/30 opacity-60" : "bg-background"
      }`}
    >
      <div className="flex items-center gap-3">
        <CalendarDays className="h-5 w-5 text-muted-foreground flex-shrink-0" />
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">
              {formatBlockDateRange(block.startTime, block.endTime)}
            </span>
            <Badge
              variant="secondary"
              className={BLOCK_TYPE_COLORS[block.blockType] || BLOCK_TYPE_COLORS.other}
            >
              {BLOCK_TYPE_LABELS[block.blockType] || block.blockType}
            </Badge>
          </div>
          {block.reason && (
            <p className="text-sm text-muted-foreground mt-0.5">{block.reason}</p>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onDelete(block.id)}
        disabled={deletingBlockId === block.id}
        className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950 flex-shrink-0"
      >
        {deletingBlockId === block.id ? (
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-500" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
