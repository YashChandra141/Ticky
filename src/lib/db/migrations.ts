import type { DatabaseSync } from "node:sqlite";

/**
 * Schema migrations, applied strictly in order. The current version lives in
 * `PRAGMA user_version`; each migration runs in its own transaction and
 * updates the version as part of it.
 */
const MIGRATIONS: ReadonlyArray<{ version: number; statements: readonly string[] }> = [
  {
    version: 1,
    statements: [
      `
      CREATE TABLE business_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        company_name TEXT NOT NULL DEFAULT 'My Company',
        company_email TEXT NOT NULL DEFAULT '',
        company_address TEXT NOT NULL DEFAULT '',
        payment_details TEXT NOT NULL DEFAULT ''
      )
      `,
      `
      CREATE TABLE app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        currency TEXT NOT NULL DEFAULT 'USD',
        default_tax_rate REAL NOT NULL DEFAULT 0,
        default_terms TEXT NOT NULL DEFAULT 'Payment due within 30 days.',
        next_invoice_number INTEGER NOT NULL DEFAULT 1,
        number_prefix TEXT NOT NULL DEFAULT 'INV',
        number_separator TEXT NOT NULL DEFAULT '-',
        number_padding INTEGER NOT NULL DEFAULT 4,
        ai_model TEXT NOT NULL DEFAULT 'gemma2:2b'
      )
      `,
      `
      CREATE TABLE clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) >= 1),
        email TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )
      `,
      `
      CREATE TABLE invoices (
        id TEXT PRIMARY KEY,
        number TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('draft', 'issued', 'void')),
        issue_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        customer_id TEXT NULL REFERENCES clients(id) ON DELETE SET NULL,
        customer_snapshot TEXT NOT NULL,
        tax_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
        discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
        currency TEXT NOT NULL DEFAULT 'USD',
        notes TEXT NOT NULL DEFAULT '',
        terms TEXT NOT NULL DEFAULT '',
        issued_snapshot TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
      `,
      `
      CREATE TABLE invoice_items (
        invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        position INTEGER NOT NULL,
        description TEXT NOT NULL CHECK (length(trim(description)) >= 1),
        quantity_milli INTEGER NOT NULL CHECK (quantity_milli >= 0),
        unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
        PRIMARY KEY (invoice_id, id)
      )
      `,
      `CREATE INDEX invoice_items_invoice_id ON invoice_items(invoice_id)`,
      `
      CREATE TABLE payments (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
        date TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )
      `,
      `CREATE INDEX payments_invoice_id ON payments(invoice_id)`,
    ],
  },
  {
    version: 2,
    statements: [
      `ALTER TABLE app_settings ADD COLUMN setup_completed INTEGER NOT NULL DEFAULT 0`,
      `
      CREATE TABLE items_catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description TEXT NOT NULL UNIQUE,
        unit_price_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_minor >= 0),
        times_used INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      )
      `,
    ],
  },
  {
    version: 3,
    statements: [
      // Pre-release data migration: any database still on the old untouched
      // default model moves to the new default. Explicitly chosen models keep
      // their value unless it equals the old default.
      `UPDATE app_settings SET ai_model = 'gemma2:2b' WHERE id = 1 AND ai_model = 'qwen2.5:3b'`,
    ],
  },
];

export const LATEST_VERSION: number = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

export function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as
    | { user_version?: number | bigint }
    | undefined;
  const current = Number(row?.user_version ?? 0);

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.exec("BEGIN");
    try {
      for (const statement of migration.statements) {
        db.exec(statement);
      }
      // Version is a controlled integer literal, not user input.
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
