import { connection } from "next/server";
import { InvoiceEditor } from "@/components/invoice-editor";
import { addDaysISO, todayISO } from "@/lib/format";
import { formatInvoiceNumber, numberingConfig } from "@/lib/domain/numbering";
import { getCustomers, getSettings } from "@/lib/store";
import type { Invoice } from "@/lib/types";

// Fresh file reads on every visit — no prerendered shell.
export const instant = false;

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  await connection();
  const [settings, customers] = await Promise.all([getSettings(), getCustomers()]);
  const today = todayISO();

  const invoice: Invoice = {
    id: "",
    number: formatInvoiceNumber(numberingConfig(settings), settings.nextInvoiceNumber),
    status: "draft",
    issueDate: today,
    dueDate: addDaysISO(today, 30),
    customerId: null,
    customer: { name: "", email: "", address: "" },
    items: [{ id: "item-1", description: "", quantityMilli: 1000, unitPriceMinor: 0 }],
    taxRateBps: Math.round(settings.defaultTaxRate * 100),
    discountMinor: 0,
    currency: settings.currency,
    notes: "",
    terms: settings.defaultTerms,
    issuedSnapshot: null,
    createdAt: "",
    updatedAt: "",
  };

  return <InvoiceEditor invoice={invoice} customers={customers} isNew aiModel={settings.aiModel} />;
}
