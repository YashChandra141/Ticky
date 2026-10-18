"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Ban,
  Copy,
  Download,
  Loader2,
  Lock,
  Plus,
  Printer,
  Rocket,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { AiCopilot } from "@/components/ai-copilot";
import { Money } from "@/components/money";
import { PaymentsPanel } from "@/components/payments-panel";
import { StatusBadge } from "@/components/status-badge";
import { addDaysISO, formatMinorMoney, todayISO } from "@/lib/format";
import { percentToBps, lineAmountMinor, toMilli, toMinor } from "@/lib/domain/money";
import { canEditCustomer, canEditItems } from "@/lib/domain/status";
import { computeTotals, effectiveTotals } from "@/lib/totals";
import { getDesktop } from "@/lib/desktop";
import {
  CURRENCIES,
  type Customer,
  type Invoice,
  type Payment,
} from "@/lib/types";
import type { AiDraftResult, AiExtractResult } from "@/lib/ai-shared";

// The form keeps decimal strings so typing "2.5" behaves; everything becomes
// integer domain units (milli / minor / bps) only at the save edge.
type EditorItem = { id: string; description: string; quantity: string; unitPrice: string };
type EditorState = {
  number: string;
  status: Invoice["status"];
  issueDate: string;
  dueDate: string;
  customerId: string | null;
  customerName: string;
  customerEmail: string;
  customerAddress: string;
  items: EditorItem[];
  taxRate: string;
  discount: string;
  currency: string;
  notes: string;
  terms: string;
};

function toEditorState(invoice: Invoice): EditorState {
  return {
    number: invoice.number,
    status: invoice.status,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    customerId: invoice.customerId,
    customerName: invoice.customer.name,
    customerEmail: invoice.customer.email,
    customerAddress: invoice.customer.address,
    items: invoice.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: String(item.quantityMilli / 1000),
      unitPrice: String(item.unitPriceMinor / 100),
    })),
    taxRate: String(invoice.taxRateBps / 100),
    discount: String(invoice.discountMinor / 100),
    currency: invoice.currency,
    notes: invoice.notes,
    terms: invoice.terms,
  };
}

const num = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

type Props = {
  invoice: Invoice;
  customers: Customer[];
  isNew: boolean;
  aiModel: string;
  /** Payments recorded against an existing invoice (empty for new ones). */
  payments?: Payment[];
};

export function InvoiceEditor({ invoice, customers, isNew, aiModel, payments = [] }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<EditorState>(() => toEditorState(invoice));
  const [model, setModel] = useState(aiModel);
  const [busy, setBusy] = useState<null | "save" | "issue">(null);
  const [polishing, setPolishing] = useState<null | "notes" | "terms">(null);
  const [catalog, setCatalog] = useState<Array<{ description: string; unitPriceMinor: number }>>([]);

  useEffect(() => {
    fetch("/api/catalog")
      .then((res) => res.json())
      .then((data) => setCatalog(data as Array<{ description: string; unitPriceMinor: number }>))
      .catch(() => setCatalog([]));
  }, []);

  const set = <K extends keyof EditorState>(key: K, value: EditorState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const itemsEditable = canEditItems(form.status);
  const customerEditable = canEditCustomer(form.status);
  const isVoid = form.status === "void";

  const amountPaidMinor = useMemo(
    () => payments.reduce((sum, payment) => sum + payment.amountMinor, 0),
    [payments],
  );

  const totals = useMemo(() => {
    // Once issued, the invoice is accounted at its frozen snapshot.
    if (!isNew && invoice.issuedSnapshot) return effectiveTotals(invoice);
    return computeTotals({
      items: form.items.map((item) => ({
        quantityMilli: toMilli(num(item.quantity) || 1),
        unitPriceMinor: toMinor(num(item.unitPrice)),
      })),
      taxRateBps: percentToBps(num(form.taxRate)),
      discountMinor: toMinor(num(form.discount)),
    });
  }, [form.items, form.taxRate, form.discount, invoice, isNew]);

  function pickCustomer(customerId: string) {
    if (!customerEditable) return;
    if (customerId === "none") {
      set("customerId", null);
      return;
    }
    const customer = customers.find((c) => c.id === customerId);
    if (!customer) return;
    setForm((f) => ({
      ...f,
      customerId,
      customerName: customer.name,
      customerEmail: customer.email,
      customerAddress: customer.address,
    }));
  }

  /** Saves the current form. Returns the saved invoice, or null on failure. */
  async function save(options: { silent?: boolean } = {}): Promise<Invoice | null> {
    const items = form.items.filter((item) => item.description.trim());
    if (!form.customerName.trim()) {
      toast.error("Add a customer name.");
      return null;
    }
    if (items.length === 0) {
      toast.error("Add at least one line item with a description.");
      return null;
    }
    if (!form.number.trim()) {
      toast.error("Give the invoice a number.");
      return null;
    }
    setBusy("save");
    const payload = {
      number: form.number.trim(),
      status: form.status,
      issueDate: form.issueDate || todayISO(),
      dueDate: form.dueDate || addDaysISO(form.issueDate || todayISO(), 30),
      customerId: form.customerId,
      customer: {
        name: form.customerName.trim(),
        email: form.customerEmail.trim(),
        address: form.customerAddress.trim(),
      },
      items: items.map((item) => ({
        id: item.id,
        description: item.description.trim(),
        quantityMilli: toMilli(num(item.quantity) || 1),
        unitPriceMinor: toMinor(num(item.unitPrice)),
      })),
      taxRateBps: percentToBps(num(form.taxRate)),
      discountMinor: toMinor(num(form.discount)),
      currency: form.currency,
      notes: form.notes,
      terms: form.terms,
    };
    try {
      const res = await fetch(isNew ? "/api/invoices" : `/api/invoices/${invoice.id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Saving failed.");
      const saved = data as Invoice;
      if (!options.silent) {
        if (isNew) {
          toast.success(`Invoice ${saved.number} created.`);
          router.push(`/invoices/${saved.id}`);
        } else {
          toast.success("Invoice saved.");
          router.refresh();
        }
      }
      return saved;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Saving failed.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  /** Save (as draft if needed) + issue in one flow. */
  async function issue() {
    const saved = await save({ silent: true });
    if (!saved) return;
    setBusy("issue");
    try {
      const res = await fetch(`/api/invoices/${saved.id}/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueDate: form.issueDate || todayISO(), dueDate: form.dueDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Issuing failed.");
      toast.success(`Invoice ${(data as Invoice).number} issued.`);
      set("status", "issued");
      if (isNew) router.push(`/invoices/${saved.id}`);
      else router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Issuing failed.");
    } finally {
      setBusy(null);
    }
  }

  async function voidInvoice() {
    setBusy("save");
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "void" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Voiding failed.");
      toast.success(`Invoice ${(data as Invoice).number} voided.`);
      set("status", "void");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Voiding failed.");
    } finally {
      setBusy(null);
    }
  }

  /** PDF download: native save dialog on desktop, plain download in the browser. */
  async function downloadPdf() {
    const desktop = getDesktop();
    if (desktop) {
      const result = await desktop.savePdf(
        `/api/invoices/${invoice.id}/pdf`,
        `${(form.number || invoice.number).replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf`,
      );
      if (result.saved) toast.success(`Saved to ${result.path}`);
      else if (result.error) toast.error(result.error);
      return;
    }
    const link = document.createElement("a");
    link.href = `/api/invoices/${invoice.id}/pdf`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function duplicate() {    try {
      const res = await fetch(`/api/invoices/${invoice.id}/duplicate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Duplicating failed.");
      const copy = data as Invoice;
      toast.success(`Duplicated as ${copy.number} (draft).`);
      router.push(`/invoices/${copy.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Duplicating failed.");
    }
  }

  async function remove() {
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Deleting failed.");
      toast.success(`Invoice ${invoice.number} deleted.`);
      router.push("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Deleting failed.");
    }
  }

  async function polish(kind: "notes" | "terms") {
    const text = kind === "notes" ? form.notes : form.terms;
    if (!text.trim()) {
      toast.error(`Write a draft ${kind} first — then I'll polish it.`);
      return;
    }
    setPolishing(kind);
    try {
      const res = await fetch("/api/ai/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, kind, model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Polishing failed.");
      const polished = (data as { text: string; model: string }).text;
      set(kind, polished);
      toast.success(`Polished with ${(data as { model: string }).model}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Polishing failed.");
    } finally {
      setPolishing(null);
    }
  }

  function applyDraft(draftData: Omit<AiDraftResult, "model">, chosenCustomerId: string | null) {
    const linked = chosenCustomerId ? customers.find((c) => c.id === chosenCustomerId) : undefined;
    setForm((f) => ({
      ...f,
      customerId: linked ? linked.id : null,
      // A saved customer record is authoritative; otherwise use what the model drafted.
      customerName: linked ? linked.name : draftData.customer.name || f.customerName,
      customerEmail: linked ? linked.email : draftData.customer.email || f.customerEmail,
      customerAddress: linked ? linked.address : draftData.customer.address || f.customerAddress,
      items: draftData.items.length
        ? draftData.items.map((item) => ({
            id: newId(),
            description: item.description,
            quantity: String(item.quantity),
            unitPrice: String(item.unitPrice),
          }))
        : f.items,
      taxRate: draftData.items.length ? String(draftData.taxRate) : f.taxRate,
      dueDate: draftData.dueInDays > 0 ? addDaysISO(todayISO(), draftData.dueInDays) : f.dueDate,
      notes: draftData.notes || f.notes,
      terms: draftData.terms || f.terms,
    }));
    toast.success(
      linked
        ? `Draft applied and linked to ${linked.name} — review the details.`
        : "Draft applied — review the details.",
    );
  }

  function applyExtract(extract: AiExtractResult) {
    setForm((f) => ({
      ...f,
      customerName: f.customerName || extract.customer.name,
      customerEmail: f.customerEmail || extract.customer.email,
      customerAddress: f.customerAddress || extract.customer.address,
      items: [
        ...f.items,
        ...extract.items.map((item) => ({
          id: newId(),
          description: item.description,
          quantity: String(item.quantity),
          unitPrice: String(item.unitPrice),
        })),
      ],
    }));
    toast.success(
      `${extract.items.length} item${extract.items.length === 1 ? "" : "s"} added.`,
    );
  }

  function changeModel(next: string) {
    setModel(next);
    // Persist immediately so every AI feature (and the Settings page) follows.
    void fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiModel: next }),
    });
  }

  function changeDescription(itemId: string, value: string) {
    setForm((f) => {
      const match = catalog.find((entry) => entry.description === value.trim());
      const items = f.items.map((item) => {
        if (item.id !== itemId) return item;
        // Free price autofill only while the price is untouched.
        const priceUntouched = item.unitPrice === "" || item.unitPrice === "0";
        return {
          ...item,
          description: value,
          unitPrice: match && priceUntouched ? String(match.unitPriceMinor / 100) : item.unitPrice,
        };
      });
      return { ...f, items };
    });
  }

  const customerSelectValue = form.customerId ?? "none";
  const customCustomerMissing =
    form.customerId !== null && !customers.some((c) => c.id === form.customerId);

  const itemAmount = (item: EditorItem) =>
    lineAmountMinor(toMilli(num(item.quantity) || 1), toMinor(num(item.unitPrice)));

  return (
    <div className="mx-auto max-w-6xl p-4 lg:p-8">
      <datalist id="ticky-catalog">
        {catalog.map((entry) => (
          <option key={entry.description} value={entry.description} />
        ))}
      </datalist>

      {/* Toolbar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" render={<Link href="/" />} title="Back to dashboard">
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">
            {isNew ? "New invoice" : form.number}
          </h1>
          {!isNew && <StatusBadge invoice={invoice} payments={payments} />}
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <Button
              variant="outline"
              size="icon"
              title="Duplicate as draft"
              onClick={() => void duplicate()}
            >
              <Copy className="size-4" />
            </Button>
          )}
          {isNew ? (
            <Button variant="outline" disabled className="gap-2">
              <Download data-icon="inline-start" className="size-4" />
              PDF
            </Button>
          ) : (
            <Button variant="outline" className="gap-2" onClick={() => void downloadPdf()}>
              <Download data-icon="inline-start" className="size-4" />
              PDF
            </Button>
          )}
          {isNew ? (
            <Button variant="outline" disabled className="gap-2">
              <Printer data-icon="inline-start" className="size-4" />
              Print
            </Button>
          ) : (
            <Button
              variant="outline"
              className="gap-2"
              render={<Link href={`/invoices/${invoice.id}/print`} />}
            >
              <Printer data-icon="inline-start" className="size-4" />
              Print
            </Button>
          )}
          {!isNew && form.status === "issued" && (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="outline" className="gap-2 text-destructive">
                    <Ban data-icon="inline-start" className="size-4" />
                    Void
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Void {invoice.number}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    A voided invoice is final — it stays on record but cannot be edited or
                    issued again. Recorded payments are kept for history.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void voidInvoice()}>Void invoice</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {!isNew && (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="destructive" size="icon" title="Delete invoice">
                    <Trash2 className="size-4" />
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {invoice.number}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the invoice and its payments. PDFs you already
                    downloaded are not affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void remove()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {form.status === "draft" && (
            <Button onClick={() => void issue()} disabled={busy !== null} className="gap-2">
              {busy === "issue" ? (
                <Loader2 data-icon="inline-start" className="size-4 animate-spin" />
              ) : (
                <Rocket data-icon="inline-start" className="size-4" />
              )}
              {busy === "issue" ? "Issuing…" : "Issue"}
            </Button>
          )}
          {!isVoid && (
            <Button
              variant={form.status === "draft" ? "outline" : "default"}
              onClick={() => void save()}
              disabled={busy !== null}
              className="gap-2"
            >
              {busy === "save" ? (
                <Loader2 data-icon="inline-start" className="size-4 animate-spin" />
              ) : (
                <Save data-icon="inline-start" className="size-4" />
              )}
              {busy === "save" ? "Saving…" : form.status === "draft" ? "Save draft" : "Save"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Left column */}
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {!itemsEditable && !isNew && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground sm:col-span-2">
                  <Lock className="size-3" />
                  {form.status === "void"
                    ? "Void invoices are final — this one is read-only."
                    : "Issued — items and customer details are frozen. Use Duplicate to start a new draft from here."}
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="number">Invoice number</Label>
                <Input
                  id="number"
                  value={form.number}
                  onChange={(e) => set("number", e.target.value)}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="issueDate">{form.status === "draft" ? "Issue date" : "Issued on"}</Label>
                <Input
                  id="issueDate"
                  type="date"
                  value={form.issueDate}
                  onChange={(e) => set("issueDate", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dueDate">Due date</Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => set("dueDate", e.target.value)}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Customer</Label>
                <Select
                  value={customerSelectValue}
                  onValueChange={(value) => pickCustomer(value ?? "none")}
                  disabled={!customerEditable}
                  items={[
                    ...customers.map((customer) => ({ value: customer.id, label: customer.name })),
                    ...(customCustomerMissing
                      ? [{ value: form.customerId as string, label: "Custom" }]
                      : []),
                    { value: "none", label: "One-off customer" },
                  ]}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name}
                      </SelectItem>
                    ))}
                    {customCustomerMissing && (
                      <SelectItem value={form.customerId as string}>Custom</SelectItem>
                    )}
                    <SelectItem value="none">One-off customer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customerName">Name</Label>
                <Input
                  id="customerName"
                  value={form.customerName}
                  onChange={(e) => set("customerName", e.target.value)}
                  placeholder="Acme Corp"
                  disabled={!customerEditable}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customerEmail">Email</Label>
                <Input
                  id="customerEmail"
                  type="email"
                  value={form.customerEmail}
                  onChange={(e) => set("customerEmail", e.target.value)}
                  placeholder="billing@acme.com"
                  disabled={!customerEditable}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="customerAddress">Address</Label>
                <Textarea
                  id="customerAddress"
                  rows={2}
                  value={form.customerAddress}
                  onChange={(e) => set("customerAddress", e.target.value)}
                  placeholder={"42 Market Street\nSan Francisco, CA 94103"}
                  disabled={!customerEditable}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select
                  value={form.currency}
                  onValueChange={(value) => set("currency", value ?? "USD")}
                  disabled={!itemsEditable}
                  items={CURRENCIES.map((code) => ({ value: code, label: code }))}
                >
                  <SelectTrigger className="w-full font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((code) => (
                      <SelectItem key={code} value={code} className="font-mono">
                        {code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Line items</CardTitle>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={!itemsEditable}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    items: [...f.items, { id: newId(), description: "", quantity: "1", unitPrice: "0" }],
                  }))
                }
              >
                <Plus data-icon="inline-start" className="size-3.5" />
                Add item
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="hidden gap-2 px-1 text-xs text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_64px_104px_96px_32px]">
                <span>Description</span>
                <span className="text-right">Qty</span>
                <span className="text-right">Unit price</span>
                <span className="text-right">Amount</span>
                <span />
              </div>
              {form.items.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_64px_104px_32px] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_64px_104px_96px_32px]"
                >
                  <Input
                    value={item.description}
                    list="ticky-catalog"
                    onChange={(e) => changeDescription(item.id, e.target.value)}
                    placeholder="What was sold?"
                    disabled={!itemsEditable}
                  />
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    className="text-right font-mono tabular-nums"
                    value={item.quantity}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        items: f.items.map((i) =>
                          i.id === item.id ? { ...i, quantity: e.target.value } : i,
                        ),
                      }))
                    }
                    aria-label="Quantity"
                    disabled={!itemsEditable}
                  />
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    className="text-right font-mono tabular-nums"
                    value={item.unitPrice}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        items: f.items.map((i) =>
                          i.id === item.id ? { ...i, unitPrice: e.target.value } : i,
                        ),
                      }))
                    }
                    aria-label="Unit price"
                    disabled={!itemsEditable}
                  />
                  <span className="hidden text-right font-mono text-sm tabular-nums sm:block">
                    {formatMinorMoney(itemAmount(item), form.currency)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Remove item"
                    disabled={!itemsEditable}
                    onClick={() =>
                      setForm((f) => ({ ...f, items: f.items.filter((i) => i.id !== item.id) }))
                    }
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              <Separator className="my-4" />
              <div className="flex flex-wrap gap-4">
                <div className="w-40 space-y-1.5">
                  <Label htmlFor="taxRate">Tax rate %</Label>
                  <Input
                    id="taxRate"
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    className="text-right font-mono tabular-nums"
                    value={form.taxRate}
                    onChange={(e) => set("taxRate", e.target.value)}
                    disabled={!itemsEditable}
                  />
                </div>
                <div className="w-40 space-y-1.5">
                  <Label htmlFor="discount">Discount</Label>
                  <Input
                    id="discount"
                    type="number"
                    min="0"
                    step="any"
                    className="text-right font-mono tabular-nums"
                    value={form.discount}
                    onChange={(e) => set("discount", e.target.value)}
                    disabled={!itemsEditable}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes & terms</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="notes">Notes</Label>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="gap-1 text-primary"
                    disabled={polishing !== null}
                    onClick={() => void polish("notes")}
                  >
                    {polishing === "notes" ? (
                      <Loader2 data-icon="inline-start" className="size-3 animate-spin" />
                    ) : (
                      <Sparkles data-icon="inline-start" className="size-3" />
                    )}
                    Polish
                  </Button>
                </div>
                <Textarea
                  id="notes"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Thanks for your business!"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="terms">Terms</Label>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="gap-1 text-primary"
                    disabled={polishing !== null}
                    onClick={() => void polish("terms")}
                  >
                    {polishing === "terms" ? (
                      <Loader2 data-icon="inline-start" className="size-3 animate-spin" />
                    ) : (
                      <Sparkles data-icon="inline-start" className="size-3" />
                    )}
                    Polish
                  </Button>
                </div>
                <Textarea
                  id="terms"
                  rows={2}
                  value={form.terms}
                  onChange={(e) => set("terms", e.target.value)}
                  placeholder="Payment due within 30 days of the invoice date."
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6 self-start lg:sticky lg:top-8">
          <Card>
            <CardHeader>
              <CardTitle>Totals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <Money minor={totals.subtotalMinor} currency={form.currency} />
              </div>
              {totals.discountMinor > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount</span>
                  <Money minor={-totals.discountMinor} currency={form.currency} />
                </div>
              )}
              {totals.taxMinor > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Tax ({num(form.taxRate) || invoice.taxRateBps / 100}%)
                  </span>
                  <Money minor={totals.taxMinor} currency={form.currency} />
                </div>
              )}
              <Separator className="my-2" />
              <div className="flex justify-between text-base font-semibold">
                <span>Total</span>
                <Money minor={totals.totalMinor} currency={form.currency} />
              </div>
              {amountPaidMinor > 0 && (
                <>
                  <div className="flex justify-between pt-1">
                    <span className="text-muted-foreground">Paid</span>
                    <Money minor={amountPaidMinor} currency={form.currency} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Balance due</span>
                    <Money
                      minor={totals.totalMinor - amountPaidMinor}
                      currency={form.currency}
                      className={totals.totalMinor - amountPaidMinor > 0 ? "text-red-600 dark:text-red-400" : ""}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {!isNew && invoice.issuedSnapshot && (
            <PaymentsPanel
              invoiceId={invoice.id}
              currency={form.currency}
              totalMinor={totals.totalMinor}
              payments={payments}
              canRecord={form.status === "issued"}
              onRefresh={() => router.refresh()}
            />
          )}

          <AiCopilot
            model={model}
            onModelChange={changeModel}
            currency={form.currency}
            customers={customers}
            onApplyDraft={applyDraft}
            onApplyExtract={applyExtract}
          />
        </div>
      </div>
    </div>
  );
}
