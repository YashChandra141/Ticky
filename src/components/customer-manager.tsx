"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Customer } from "@/lib/types";

type Props = {
  customers: Customer[];
  invoiceCounts: Record<string, number>;
};

type FormState = { name: string; email: string; address: string };

export function CustomerManager({ customers, invoiceCounts }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<FormState>({ name: "", email: "", address: "" });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Customer | null>(null);

  function openNew() {
    setEditing(null);
    setForm({ name: "", email: "", address: "" });
    setOpen(true);
  }

  function openEdit(customer: Customer) {
    setEditing(customer);
    setForm({ name: customer.name, email: customer.email, address: customer.address });
    setOpen(true);
  }

  async function submit() {
    if (!form.name.trim()) {
      toast.error("Give the customer a name.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/customers/${editing.id}` : "/api/customers", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          address: form.address.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Saving failed.");
      toast.success(editing ? "Customer updated." : "Customer added.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Saving failed.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/customers/${deleting.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Deleting failed.");
      toast.success(`${deleting.name} removed. Their invoices keep their details.`);
      setDeleting(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Deleting failed.");
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {customers.length} customer{customers.length === 1 ? "" : "s"}
        </p>
        <Button onClick={openNew} className="gap-2">
          <Plus data-icon="inline-start" className="size-4" />
          New customer
        </Button>
      </div>

      {customers.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">No customers yet.</p>
          <Button variant="outline" onClick={openNew} className="mt-4 gap-2">
            <Plus data-icon="inline-start" className="size-4" />
            Add your first customer
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Email</th>
                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Address</th>
                <th className="px-4 py-2.5 text-right font-medium">Invoices</th>
                <th className="w-20 px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 font-medium">{customer.name}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                    {customer.email || "—"}
                  </td>
                  <td className="hidden max-w-64 truncate px-4 py-3 text-muted-foreground lg:table-cell">
                    {customer.address.split("\n")[0] || "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                    {invoiceCounts[customer.id] ?? 0}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Edit customer"
                        onClick={() => openEdit(customer)}
                      >
                        <Pencil className="size-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Remove customer"
                        onClick={() => setDeleting(customer)}
                      >
                        <Trash2 className="size-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "New customer"}</DialogTitle>
            <DialogDescription>
              Saved customers can be picked from any invoice.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="customer-form-name">Name</Label>
              <Input
                id="customer-form-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Acme Corp"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer-form-email">Email</Label>
              <Input
                id="customer-form-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="billing@acme.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer-form-address">Address</Label>
              <Textarea
                id="customer-form-address"
                rows={2}
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder={"42 Market Street\nSan Francisco, CA 94103"}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={saving} className="gap-2">
              {saving && <Loader2 data-icon="inline-start" className="size-4 animate-spin" />}
              {editing ? "Save changes" : "Add customer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Invoices already issued keep their customer details. This only removes the saved
              entry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
