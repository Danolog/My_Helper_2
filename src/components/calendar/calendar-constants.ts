export interface BlockTypeStyle {
  label: string;
  bg: string;
  border: string;
  stripe: string;
}

export const BLOCK_TYPE_CONFIG: Record<string, BlockTypeStyle> = {
  vacation: { label: "Urlop", bg: "rgba(249, 115, 22, 0.15)", border: "#f97316", stripe: "rgba(249, 115, 22, 0.25)" },
  break: { label: "Przerwa", bg: "rgba(59, 130, 246, 0.15)", border: "#3b82f6", stripe: "rgba(59, 130, 246, 0.25)" },
  personal: { label: "Osobiste", bg: "rgba(168, 85, 247, 0.15)", border: "#a855f7", stripe: "rgba(168, 85, 247, 0.25)" },
  holiday: { label: "Swięto", bg: "rgba(239, 68, 68, 0.15)", border: "#ef4444", stripe: "rgba(239, 68, 68, 0.25)" },
  other: { label: "Zablokowane", bg: "rgba(107, 114, 128, 0.15)", border: "#6b7280", stripe: "rgba(107, 114, 128, 0.25)" },
};

const DEFAULT_BLOCK_STYLE: BlockTypeStyle = BLOCK_TYPE_CONFIG["other"]!;

export function getBlockStyle(blockType: string): BlockTypeStyle {
  return BLOCK_TYPE_CONFIG[blockType] ?? DEFAULT_BLOCK_STYLE;
}
