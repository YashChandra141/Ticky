import { getDb, transact } from "./connection";
import { settingsSchema, type Settings } from "../types";

type BusinessRow = {
  company_name: string;
  company_email: string;
  company_address: string;
  payment_details: string;
};

type AppRow = {
  currency: string;
  default_tax_rate: number;
  default_terms: string;
  next_invoice_number: number;
  number_prefix: string;
  number_separator: string;
  number_padding: number;
  ai_model: string;
  setup_completed: number;
};

/** The settings tables are singletons (id = 1); create with DDL defaults on first read. */
function ensureRows(): void {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO business_settings (id) VALUES (1)").run();
  db.prepare("INSERT OR IGNORE INTO app_settings (id) VALUES (1)").run();
}

export function readSettings(): Settings {
  const db = getDb();
  ensureRows();
  const business = db.prepare("SELECT * FROM business_settings WHERE id = 1").get() as BusinessRow;
  const app = db.prepare("SELECT * FROM app_settings WHERE id = 1").get() as AppRow;
  return settingsSchema.parse({
    companyName: business.company_name,
    companyEmail: business.company_email,
    companyAddress: business.company_address,
    paymentDetails: business.payment_details,
    currency: app.currency,
    defaultTaxRate: Number(app.default_tax_rate),
    defaultTerms: app.default_terms,
    nextInvoiceNumber: Number(app.next_invoice_number),
    numberPrefix: app.number_prefix,
    numberSeparator: app.number_separator,
    numberPadding: Number(app.number_padding),
    aiModel: app.ai_model,
    setupCompleted: Boolean(app.setup_completed),
  });
}

export function writeSettings(settings: Settings): void {
  transact(() => {
    const db = getDb();
    ensureRows();
    db.prepare(
      "UPDATE business_settings SET company_name = ?, company_email = ?, company_address = ?, payment_details = ? WHERE id = 1",
    ).run(settings.companyName, settings.companyEmail, settings.companyAddress, settings.paymentDetails);
    db.prepare(
      `UPDATE app_settings SET
        currency = ?, default_tax_rate = ?, default_terms = ?, next_invoice_number = ?,
        number_prefix = ?, number_separator = ?, number_padding = ?, ai_model = ?, setup_completed = ?
       WHERE id = 1`,
    ).run(
      settings.currency,
      settings.defaultTaxRate,
      settings.defaultTerms,
      settings.nextInvoiceNumber,
      settings.numberPrefix,
      settings.numberSeparator,
      settings.numberPadding,
      settings.aiModel,
      settings.setupCompleted ? 1 : 0,
    );
  });
}
