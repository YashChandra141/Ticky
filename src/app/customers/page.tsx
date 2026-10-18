import { connection } from "next/server";
import { CustomerManager } from "@/components/customer-manager";
import { getCustomers, getInvoices } from "@/lib/store";

// Fresh file reads on every visit — no prerendered shell.
export const instant = false;

export const metadata = { title: "Customers" };

export default async function CustomersPage() {
  await connection();
  const [customers, invoices] = await Promise.all([getCustomers(), getInvoices()]);

  const invoiceCounts: Record<string, number> = {};
  for (const invoice of invoices) {
    if (invoice.customerId) {
      invoiceCounts[invoice.customerId] = (invoiceCounts[invoice.customerId] ?? 0) + 1;
    }
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Customers</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Saved once, reusable on every invoice.
        </p>
        <CustomerManager customers={customers} invoiceCounts={invoiceCounts} />
      </div>
    </div>
  );
}
