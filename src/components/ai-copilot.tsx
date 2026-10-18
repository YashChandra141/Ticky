"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelect } from "@/components/model-select";
import { Money } from "@/components/money";
import { lineAmountMinor, percentToBps, toMilli, toMinor } from "@/lib/domain/money";
import { computeTotals } from "@/lib/totals";
import { matchCustomers } from "@/lib/ai-shared";
import type {
  AiDraftResult,
  AiExtractResult,
  DraftQuestions,
} from "@/lib/ai-shared";
import type { Customer } from "@/lib/types";

type Props = {
  model: string;
  onModelChange: (model: string) => void;
  currency: string;
  customers: Customer[];
  onApplyDraft: (draft: Omit<AiDraftResult, "model">, customerId: string | null) => void;
  onApplyExtract: (extract: AiExtractResult) => void;
};

type DraftResponse =
  | { needsClarification: true; draft: Omit<AiDraftResult, "model">; questions: DraftQuestions; model: string }
  | { needsClarification: false; draft: AiDraftResult; questions: DraftQuestions | null };

type DraftState = {
  prompt: string;
  response: DraftResponse;
  /** 0 = fresh draft, 1 = one clarification round answered. */
  round: number;
};

export function AiCopilot({
  model,
  onModelChange,
  currency,
  customers,
  onApplyDraft,
  onApplyExtract,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [rawText, setRawText] = useState("");
  const [answers, setAnswers] = useState("");
  const [busy, setBusy] = useState<null | "draft" | "extract">(null);
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [extractState, setExtractState] = useState<AiExtractResult | null>(null);
  const [chosenCustomerId, setChosenCustomerId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Demo deployments tell the copilot up front that AI is desktop-only.
  useEffect(() => {
    fetch("/api/ai/models", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { aiDisabled?: string }) => {
        if (data.aiDisabled) setNotice(data.aiDisabled);
      })
      .catch(() => {});
  }, []);

  async function run(kind: "draft" | "extract") {
    const input = (kind === "draft" ? prompt : rawText).trim();
    if (!input) {
      toast.error(kind === "draft" ? "Describe the invoice first." : "Paste some text first.");
      return;
    }
    setBusy(kind);

    const clarify = kind === "draft" && draftState?.response.needsClarification;
    const body =
      kind === "draft"
        ? clarify
          ? {
              prompt: draftState.prompt,
              answers,
              draft: draftState.response.draft,
              model,
            }
          : { prompt: input, model }
        : { text: input, model };

    try {
      const res = await fetch(`/api/ai/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if ((data as { aiDisabled?: boolean }).aiDisabled) {
          // Hosted demo: show the boundary inline instead of an error toast.
          setNotice((data as { error?: string }).error ?? "AI is disabled in this demo.");
          return;
        }
        throw new Error((data as { error?: string }).error ?? "The AI request failed.");
      }

      if (kind === "draft") {
        const response = data as DraftResponse;
        const previousRound = clarify ? (draftState?.round ?? 0) : 0;
        setDraftState({ prompt: clarify ? draftState.prompt : input, response, round: clarify ? previousRound + 1 : 0 });
        if (response.needsClarification && (!clarify || previousRound === 0)) {
          setAnswers("");
          setChosenCustomerId(null);
        } else {
          // draft complete (or clarification exhausted) — settle the customer link
          settleCustomer(response.draft.customer.name, response.draft.customer.email);
        }
      } else {
        setExtractState(data as AiExtractResult);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The AI request failed.");
    } finally {
      setBusy(null);
    }
  }

  /** Auto-link exact matches; preselect nothing when several candidates exist. */
  function settleCustomer(name: string, email: string) {
    const match = matchCustomers(customers, { name, email });
    setChosenCustomerId(match.kind === "exact" ? match.customer.id : null);
  }

  const draft = draftState?.response.draft ?? null;
  const askingClarification = draftState?.response.needsClarification && draftState.round === 0;
  const stillMissing =
    draftState?.response.needsClarification === true && draftState.round >= 1
      ? draftState.response.questions
      : null;

  const previewItems = draft?.items ?? extractState?.items ?? [];
  const match = useMemo(() => {
    if (!draft || askingClarification) return null;
    return matchCustomers(customers, draft.customer);
  }, [draft, customers, askingClarification]);

  const previewTotalMinor = computeTotals({
    items: previewItems.map((item) => ({
      quantityMilli: toMilli(item.quantity),
      unitPriceMinor: toMinor(item.unitPrice),
    })),
    taxRateBps: percentToBps(draft?.taxRate ?? 0),
    discountMinor: 0,
  }).totalMinor;

  function applyDraft() {
    if (!draft) return;
    onApplyDraft(draft, chosenCustomerId);
    setDraftState(null);
    setAnswers("");
    setChosenCustomerId(null);
  }

  function applyExtract() {
    if (!extractState) return;
    onApplyExtract(extractState);
    setExtractState(null);
  }

  const customerPicker =
    match?.kind === "exact"
      ? { label: match.customer.name, exact: true }
      : null;

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" />
          AI copilot
        </div>
        <ModelSelect value={model} onChange={onModelChange} />
      </div>

      {notice && (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {notice}
        </div>
      )}

      <Tabs defaultValue="draft">
        <TabsList className="w-full">
          <TabsTrigger value="draft" className="flex-1">
            Draft
          </TabsTrigger>
          <TabsTrigger value="extract" className="flex-1">
            Extract
          </TabsTrigger>
        </TabsList>

        <TabsContent value="draft" className="mt-3 space-y-2">
          <Textarea
            rows={4}
            placeholder={'e.g. "Invoice for Acme — 12 hours of consulting at $150/hr, 8% tax, net 30"'}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setDraftState(null);
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void run("draft");
            }}
          />
          <Button
            className="w-full gap-2"
            disabled={busy !== null}
            onClick={() => void run("draft")}
          >
            {busy === "draft" ? (
              <Loader2 data-icon="inline-start" className="size-4 animate-spin" />
            ) : (
              <Sparkles data-icon="inline-start" className="size-4" />
            )}
            {busy === "draft" ? "Generating…" : draftState ? "Start over" : "Generate draft"}
          </Button>
        </TabsContent>

        <TabsContent value="extract" className="mt-3 space-y-2">
          <Textarea
            rows={4}
            placeholder="Paste an email or message and I'll pull out the line items and customer."
            value={rawText}
            onChange={(e) => {
              setRawText(e.target.value);
              setExtractState(null);
            }}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void run("extract");
            }}
          />
          <Button
            className="w-full gap-2"
            disabled={busy !== null}
            onClick={() => void run("extract")}
          >
            {busy === "extract" ? (
              <Loader2 data-icon="inline-start" className="size-4 animate-spin" />
            ) : (
              <Sparkles data-icon="inline-start" className="size-4" />
            )}
            {busy === "extract" ? "Extracting…" : "Extract items"}
          </Button>
        </TabsContent>
      </Tabs>

      {/* Draft: clarification questions (first round only) */}
      {draft && askingClarification && (
        <div className="mt-3 rounded-lg border bg-background p-3">
          <p className="mb-1.5 text-xs font-medium">A few things the model could not infer:</p>
          <ul className="mb-2 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
            {Object.values(draftState!.response.needsClarification ? draftState!.response.questions : {}).map(
              (question) => (
                <li key={question}>{question}</li>
              ),
            )}
          </ul>
          <Textarea
            rows={2}
            value={answers}
            onChange={(e) => setAnswers(e.target.value)}
            placeholder={'e.g. "Customer is Globex Ltd, consulting is $150/hour"'}
          />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              className="flex-1 gap-2"
              disabled={busy !== null || !answers.trim()}
              onClick={() => void run("draft")}
            >
              {busy === "draft" ? (
                <Loader2 data-icon="inline-start" className="size-3.5 animate-spin" />
              ) : (
                <Sparkles data-icon="inline-start" className="size-3.5" />
              )}
              Send answers
            </Button>
            <Button size="sm" variant="outline" onClick={applyDraft}>
              Apply anyway
            </Button>
          </div>
        </div>
      )}

      {/* Draft preview */}
      {draft && !askingClarification && (
        <div className="mt-3 rounded-lg border bg-background p-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {previewItems.length} item{previewItems.length === 1 ? "" : "s"} · total{" "}
              <Money minor={previewTotalMinor} currency={currency} className="text-foreground" />
            </p>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setDraftState(null)}
              title="Discard preview"
            >
              <X className="size-3.5" />
            </Button>
          </div>
          {draft.customer.name && <p className="mb-1.5 text-sm font-medium">{draft.customer.name}</p>}

          {stillMissing && (
            <p className="mb-1.5 rounded-md bg-amber-100 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              Still not inferred: {Object.values(stillMissing).join(" ")} — you can fill the blanks
              in the editor after applying.
            </p>
          )}

          {/* Customer linking */}
          {match?.kind === "exact" && customerPicker && (
            <p className="mb-1.5 text-[11px] text-muted-foreground">
              Linked to existing customer:{" "}
              <span className="font-medium text-foreground">{customerPicker.label}</span>
            </p>
          )}
          {match?.kind === "candidates" && (
            <div className="mb-2">
              <p className="mb-1 text-[11px] text-muted-foreground">
                Is this one of your customers?
              </p>
              <div className="flex flex-wrap gap-1.5">
                {match.customers.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() =>
                      setChosenCustomerId((current) => (current === candidate.id ? null : candidate.id))
                    }
                    className={
                      chosenCustomerId === candidate.id
                        ? "rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                        : "rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
                    }
                  >
                    {candidate.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <ul className="space-y-1">
            {previewItems.slice(0, 8).map((item, index) => (
              <li key={index} className="flex justify-between gap-3 text-xs">
                <span className="truncate text-muted-foreground">
                  {item.description} × {item.quantity}
                </span>
                <Money
                  minor={lineAmountMinor(toMilli(item.quantity), toMinor(item.unitPrice))}
                  currency={currency}
                />
              </li>
            ))}
            {previewItems.length > 8 && (
              <li className="text-xs text-muted-foreground">+{previewItems.length - 8} more…</li>
            )}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button size="sm" className="flex-1" onClick={applyDraft}>
              Apply to invoice
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDraftState(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}

      {/* Extract preview */}
      {extractState && extractState.items.length > 0 && (
        <div className="mt-3 rounded-lg border bg-background p-3">
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {extractState.items.length} item{extractState.items.length === 1 ? "" : "s"} · total{" "}
              <Money minor={previewTotalMinor} currency={currency} className="text-foreground" />
            </p>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setExtractState(null)}
              title="Discard preview"
            >
              <X className="size-3.5" />
            </Button>
          </div>
          {extractState.customer.name && (
            <p className="mb-1.5 text-sm font-medium">{extractState.customer.name}</p>
          )}
          <ul className="space-y-1">
            {extractState.items.slice(0, 8).map((item, index) => (
              <li key={index} className="flex justify-between gap-3 text-xs">
                <span className="truncate text-muted-foreground">
                  {item.description} × {item.quantity}
                </span>
                <Money
                  minor={lineAmountMinor(toMilli(item.quantity), toMinor(item.unitPrice))}
                  currency={currency}
                />
              </li>
            ))}
            {extractState.items.length > 8 && (
              <li className="text-xs text-muted-foreground">+{extractState.items.length - 8} more…</li>
            )}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button size="sm" className="flex-1" onClick={applyExtract}>
              Add to invoice
            </Button>
            <Button size="sm" variant="outline" onClick={() => setExtractState(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}

      {extractState && extractState.items.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Nothing usable found — try including quantities and prices.
        </p>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Runs locally on your machine via Ollama. Nothing leaves it.
      </p>
    </div>
  );
}
