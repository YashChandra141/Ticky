"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelect } from "@/components/model-select";
import { CURRENCIES, type Settings } from "@/lib/types";

export function SettingsForm({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [form, setForm] = useState({
    companyName: settings.companyName,
    companyEmail: settings.companyEmail,
    companyAddress: settings.companyAddress,
    paymentDetails: settings.paymentDetails,
    currency: settings.currency,
    defaultTaxRate: String(settings.defaultTaxRate),
    defaultTerms: settings.defaultTerms,
    aiModel: settings.aiModel,
  });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (!form.companyName.trim()) {
      toast.error("Give your company a name — it appears on every invoice.");
      return;
    }
    const taxRate = Number.parseFloat(form.defaultTaxRate);
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: form.companyName.trim(),
          companyEmail: form.companyEmail.trim(),
          companyAddress: form.companyAddress,
          paymentDetails: form.paymentDetails,
          currency: form.currency,
          defaultTaxRate: Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0,
          defaultTerms: form.defaultTerms,
          aiModel: form.aiModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Saving failed.");
      toast.success("Settings saved.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Saving failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Your company</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="companyName">Name</Label>
            <Input
              id="companyName"
              value={form.companyName}
              onChange={(e) => set("companyName", e.target.value)}
              placeholder="Catjam Studio"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="companyEmail">Email</Label>
            <Input
              id="companyEmail"
              type="email"
              value={form.companyEmail}
              onChange={(e) => set("companyEmail", e.target.value)}
              placeholder="hello@yourstudio.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="companyAddress">Address</Label>
            <Textarea
              id="companyAddress"
              rows={2}
              value={form.companyAddress}
              onChange={(e) => set("companyAddress", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="paymentDetails">Payment details</Label>
            <Textarea
              id="paymentDetails"
              rows={3}
              value={form.paymentDetails}
              onChange={(e) => set("paymentDetails", e.target.value)}
              placeholder={"Bank: …\nAccount: …\nReference: the invoice number"}
            />
            <p className="text-xs text-muted-foreground">Shown at the bottom of invoices and PDFs.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoice defaults</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Select
              value={form.currency}
              onValueChange={(value) => {
                if (value) set("currency", value);
              }}
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
          <div className="space-y-1.5">
            <Label htmlFor="defaultTaxRate">Default tax rate %</Label>
            <Input
              id="defaultTaxRate"
              type="number"
              min="0"
              max="100"
              step="any"
              className="font-mono tabular-nums"
              value={form.defaultTaxRate}
              onChange={(e) => set("defaultTaxRate", e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="defaultTerms">Default terms</Label>
            <Textarea
              id="defaultTerms"
              rows={2}
              value={form.defaultTerms}
              onChange={(e) => set("defaultTerms", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI copilot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Model</Label>
            <ModelSelect value={form.aiModel} onChange={(value) => set("aiModel", value)} />
            <p className="text-xs text-muted-foreground">
              Listed live from your local Ollama instance. The same model can be switched any time
              from the copilot panel on an invoice.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={saving} className="gap-2">
          {saving ? (
            <Loader2 data-icon="inline-start" className="size-4 animate-spin" />
          ) : (
            <Save data-icon="inline-start" className="size-4" />
          )}
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
