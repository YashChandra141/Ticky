/**
 * Integer money. All amounts in the domain, storage and API are integer
 * minor units (cents); quantities are integer milli-units (3 decimals).
 * The UI keeps decimal inputs and converts at the edges — nothing in
 * between ever floats.
 */

export const MINOR_SCALE = 100;
export const QUANTITY_SCALE = 1000;

/** UI decimal (major units) → integer cents, rounded half-up. */
export function toMinor(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * MINOR_SCALE);
}

/** Integer cents → UI decimal (major units). */
export function fromMinor(minor: number): number {
  return minor / MINOR_SCALE;
}

/** UI decimal quantity → integer milli-units, rounded half-up. */
export function toMilli(quantity: number): number {
  if (!Number.isFinite(quantity)) return 0;
  return Math.round((quantity + Number.EPSILON) * QUANTITY_SCALE);
}

/** Integer milli-units → UI decimal quantity. */
export function fromMilli(milli: number): number {
  return milli / QUANTITY_SCALE;
}

/**
 * Half-up rounding for money math. Domain values are non-negative, where
 * Math.round's ".5 toward +Infinity" behavior is exactly half-up.
 */
export function roundHalfUp(value: number): number {
  return Math.round(value + Number.EPSILON);
}

/** Line amount = quantity (milli) × unit price (minor) → minor, rounded once. */
export function lineAmountMinor(quantityMilli: number, unitPriceMinor: number): number {
  return roundHalfUp((quantityMilli * unitPriceMinor) / QUANTITY_SCALE);
}

/** Tax on a taxable amount, half-up, computed exactly once per invoice. */
export function taxMinor(taxableMinor: number, taxRateBps: number): number {
  return roundHalfUp((taxableMinor * taxRateBps) / 10_000);
}

/** UI tax percent → integer basis points (8.5% → 850). */
export function percentToBps(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.min(Math.round(percent * MINOR_SCALE), 10_000);
}

/** Basis points → UI tax percent (850 → 8.5). */
export function bpsToPercent(bps: number): number {
  return bps / MINOR_SCALE;
}
