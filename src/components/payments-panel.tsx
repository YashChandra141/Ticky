"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Money } from "@/components/money";
import { formatDate, formatMinorMoney, todayISO } from "@/lib/format";
import { toMinor } from "@/lib/domain/money";
import type { Payment } from "@/lib/types";

const METHODS = ["Bank transfer", "Cash", "Card", "Other"] as const;

const num = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/**
 * Records and lists payments against an issued invoice. The balance is never
 * stored — it is always total minus payments.
 */
export function PaymentsPanel({
  invoiceId,
  currency,
  totalMinor,
  payments,
  canRecord,
  onRefresh,
}: {
  invoiceId: string;
  currency: string;
  totalMinor: number;
  payments: Payment[];
  canRecord: boolean;
  onRefresh: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<string>("Bank transfer");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Payment | null>(null);

  const paidMinor = payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  const balanceMinor = totalMinor - paidMinor;

  async function add() {
    const amountMinor = toMinor(num(amount));
    if (amountMinor <= 0) {
      toast.error("Enter an amount above zero.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          amountMinor,
          date: date || todayISO(),
          method,
          note: "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Saving the payment failed.");
      toast.success(`Recorded ${formatMinorMoney(amountMinor, currency)}.`);
      setAmount("");
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Saving the payment failed.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/payments/${deleting.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Deleting failed.");
      toast.success("Payment removed.");
      setDeleting(null);
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Deleting failed.");
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Payments</CardTitle>
        <span className="text-xs text-muted-foreground">
          {balanceMinor > 0
            ? `${formatMinorMoney(balanceMinor, currency)} outstanding`
            : balanceMinor === 0
              ? "Settled"
              : `Overpaid by ${formatMinorMoney(-balanceMinor, currency)}`}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-muted-foreground">
                  {formatDate(payment.date)} · {payment.method || "—"}
                  {payment.note ? ` · ${payment.note}` : ""}
                </span>
                <span className="flex items-center gap-1.5">
                  <Money minor={payment.amountMinor} currency={currency} />
                  {canRecord && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="Remove payment"
                      onClick={() => setDeleting(payment)}
                    >
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {canRecord && (
          <>
            <div className="grid grid-cols-[110px_130px_1fr_auto] items-center gap-2">
              <Input
                type="number"
                min="0"
                step="any"
                className="text-right font-mono tabular-nums"
                placeholder="Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-label="Payment amount"
              />
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="Payment date"
              />
              <Select value={method} onValueChange={(value) => setMethod(value ?? "Other")}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="icon"
                onClick={() => void add()}
                disabled={saving || num(amount) <= 0}
                title="Record payment"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
              </Button>
            </div>
            {balanceMinor > 0 && num(amount) > 0 && toMinor(num(amount)) > balanceMinor && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                That is {formatMinorMoney(toMinor(num(amount)) - balanceMinor, currency)} more
                than the outstanding balance.
              </p>
            )}
          </>
        )}
      </CardContent>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this payment?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting
                ? `${formatMinorMoney(deleting.amountMinor, currency)} from ${formatDate(deleting.date)} will be removed. The invoice balance adjusts automatically.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
