import { notFound } from "next/navigation";
import { connection } from "next/server";
import { InvoiceEditor } from "@/components/invoice-editor";
import { getCustomers, getInvoices, getPayments, getSettings } from "@/lib/store";

// Fresh file reads on every visit — no prerendered shell.
export const instant = false;

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const [invoices, customers, settings, payments] = await Promise.all([
    getInvoices(),
    getCustomers(),
    getSettings(),
    getPayments(),
  ]);
  const invoice = invoices.find((i) => i.id === id);
  if (!invoice) notFound();

  return (
    <InvoiceEditor
      invoice={invoice}
      customers={customers}
      isNew={false}
      aiModel={settings.aiModel}
      payments={payments.filter((payment) => payment.invoiceId === id)}
    />
  );
}
