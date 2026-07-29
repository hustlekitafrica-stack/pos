/**
 * Format an integer amount in cents to a KES display string.
 * e.g. 15000 → "KES 150.00"
 */
export function formatKES(amountInCents: number): string {
  const amount = amountInCents / 100;
  return `KES ${amount.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Convert a display amount (e.g. 150.00) to integer cents (15000).
 */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Convert integer cents to a decimal number for display/input.
 */
export function fromCents(cents: number): number {
  return cents / 100;
}
