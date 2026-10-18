"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Loader2, PartyPopper } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCIES, type Settings } from "@/lib/types";

/**
 * Shown until the business setup is completed or skipped. Saving writes the
 * company details and flips the flag in the same request.
 */
export function FirstRunSetup({ settings }: { settings: Settings }) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState(
    settings.companyName === "My Company" ? "" : settings.companyName,
  );
  const [currency, setCurrency] = useState(settings.currency);
  const [saving, setSaving] = useState(false);

  async function finish(payload: { companyName?: string; currency?: string }) {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, setupCompleted: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Saving failed.");
      toast.success("Setup done — welcome to Ticky.");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Saving failed.");
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!companyName.trim()) {
      toast.error("Add your business name — it appears on every invoice.");
      return;
    }
    await finish({ companyName: companyName.trim(), currency });
  }

  return (
    <Card className="mb-8 border-primary/25 bg-primary/[0.04]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PartyPopper className="size-4 text-primary" />
          Welcome to Ticky
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Two quick things before your first invoice — you can change both any time in Settings.
        </p>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="setup-company">Business name</Label>
            <Input
              id="setup-company"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Studio or company name"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Select
              value={currency}
              onValueChange={(value) => setCurrency(value ?? "USD")}
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
          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={saving} className="gap-2">
              {saving ? (
                <Loader2 data-icon="inline-start" className="size-4 animate-spin" />
              ) : (
                <ArrowRight data-icon="inline-start" className="size-4" />
              )}
              Start invoicing
            </Button>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => void finish({})}
              render={<Link href="/settings" />}
            >
              Skip for now
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
