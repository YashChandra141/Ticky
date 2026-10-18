import { cn } from "@/lib/utils";
import { formatMinorMoney } from "@/lib/format";

/**
 * Money rendered in mono with tabular numerals — amounts line up in tables.
 * Takes integer minor units; the decimal conversion happens only here, at the edge.
 */
export function Money({
  minor,
  currency,
  className,
}: {
  minor: number;
  currency: string;
  className?: string;
}) {
  return <span className={cn("font-mono tabular-nums", className)}>{formatMinorMoney(minor, currency)}</span>;
}
