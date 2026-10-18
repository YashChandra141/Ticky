import type { Settings } from "@/lib/types";

export type NumberingConfig = {
  prefix: string;
  separator: string;
  padding: number;
};

export const DEFAULT_NUMBERING: NumberingConfig = {
  prefix: "INV",
  separator: "-",
  padding: 4,
};

/**
 * Formats a sequence number like "INV-0001". Padding only ever widens —
 * sequences longer than the padding are never truncated. Uniqueness is
 * enforced by the storage layer (Phase 2), not here.
 */
export function formatInvoiceNumber(config: NumberingConfig, sequence: number): string {
  const safeSequence = Math.max(1, Math.floor(sequence || 1));
  return `${config.prefix}${config.separator}${String(safeSequence).padStart(config.padding, "0")}`;
}

/** Reads the numbering config from stored settings. */
export function numberingConfig(settings: Pick<Settings, "numberPrefix" | "numberSeparator" | "numberPadding">): NumberingConfig {
  return {
    prefix: settings.numberPrefix.trim() || DEFAULT_NUMBERING.prefix,
    separator: settings.numberSeparator,
    padding: settings.numberPadding,
  };
}
