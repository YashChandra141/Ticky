import { getDb } from "./connection";

export type CatalogEntry = {
  description: string;
  unitPriceMinor: number;
  timesUsed: number;
};

/** Most-used first, then alphabetical — feeds the editor's autocomplete. */
export function listCatalog(limit = 100): CatalogEntry[] {
  const rows = getDb()
    .prepare(
      "SELECT description, unit_price_minor, times_used FROM items_catalog ORDER BY times_used DESC, description COLLATE NOCASE LIMIT ?",
    )
    .all(limit) as Array<{ description: string; unit_price_minor: number; times_used: number }>;
  return rows.map((row) => ({
    description: row.description,
    unitPriceMinor: row.unit_price_minor,
    timesUsed: row.times_used,
  }));
}

/**
 * Learns line items as the user invoices: every saved item is remembered with
 * its latest unit price and a usage counter. Called inside the same
 * transaction that writes the invoice.
 */
export function catalogItems(
  items: ReadonlyArray<{ description: string; unitPriceMinor: number }>,
): void {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO items_catalog (description, unit_price_minor, times_used, created_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(description) DO UPDATE SET
       unit_price_minor = excluded.unit_price_minor,
       times_used = items_catalog.times_used + 1`,
  );
  const now = new Date().toISOString();
  const seen = new Set<string>();
  for (const item of items) {
    const description = item.description.trim();
    if (!description || seen.has(description)) continue;
    seen.add(description);
    upsert.run(description, item.unitPriceMinor, now);
  }
}
