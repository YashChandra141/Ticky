"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button onClick={() => window.print()} className="gap-2">
      <Printer data-icon="inline-start" className="size-4" />
      Print / save PDF
    </Button>
  );
}
