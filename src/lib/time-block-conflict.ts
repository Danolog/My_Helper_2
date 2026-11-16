/**
 * #168: komunikat 409 dla terminu, który nachodzi na blokadę czasu pracownika
 * (urlop, dzień wolny, przerwa, czas osobisty). Jedno źródło dla POST
 * /api/appointments i PUT /api/appointments/[id], żeby panel pokazywał ten sam
 * tekst niezależnie od tego, czy wizyta powstaje, czy jest przesuwana.
 */
const TIME_BLOCK_LABELS: Record<string, string> = {
  vacation: "urlop",
  holiday: "dzien wolny",
  break: "przerwa",
  personal: "czas osobisty",
  other: "blokada czasu",
};

export interface TimeBlockSummary {
  blockType: string;
  reason: string | null;
}

export function timeBlockConflictMessage(block: TimeBlockSummary | null | undefined): string {
  const label = block ? (TIME_BLOCK_LABELS[block.blockType] || block.blockType) : "blokada czasu";
  return `Pracownik ma ${label} w tym terminie${block?.reason ? ` (${block.reason})` : ""}`;
}
