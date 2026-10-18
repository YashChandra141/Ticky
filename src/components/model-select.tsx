"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type ModelOption = {
  name: string;
  size: number;
  parameterSize?: string;
};

async function fetchModels(): Promise<ModelOption[]> {
  const res = await fetch("/api/ai/models", { cache: "no-store" });
  const data = (await res.json()) as { models?: ModelOption[] };
  return data.models ?? [];
}

/**
 * Picks the active Ollama model. The list is read live from the local
 * Ollama instance (no hard-coded model names); persisting the choice is
 * up to the parent (copilot saves immediately, Settings saves with the form).
 */
export function ModelSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (model: string) => void;
  className?: string;
}) {
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setModels(await fetchModels());
    } catch {
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await fetchModels();
        if (!cancelled) setModels(next);
      } catch {
        if (!cancelled) setModels([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const empty = models !== null && models.length === 0;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next);
        }}
        disabled={empty || loading}
      >
        <SelectTrigger size="sm" className="h-8 w-[200px] font-mono text-xs" title={value || undefined}>
          <SelectValue placeholder={models === null ? "Loading models…" : "No models found"} />
        </SelectTrigger>
        <SelectContent>
          {(models ?? []).map((model) => (
            <SelectItem key={model.name} value={model.name} className="font-mono text-xs">
              {model.name}
              <span className="text-muted-foreground">
                {" "}
                · {model.parameterSize ?? `${(model.size / 1e9).toFixed(1)} GB`}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => void refresh()}
        title="Refresh model list"
      >
        <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
      </Button>
    </div>
  );
}
