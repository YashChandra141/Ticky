"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getDesktop } from "@/lib/desktop";

/** CSV export: native save dialog on desktop, plain download in the browser. */
export function ExportCsvButton() {
  async function exportCsv() {
    const desktop = getDesktop();
    if (desktop) {
      const result = await desktop.saveCsv("/api/invoices/export.csv", "invoices.csv");
      if (result.saved) {
        toast.success(`Saved to ${result.path}`);
      } else if (result.error) {
        toast.error(result.error);
      }
      return;
    }
    const link = document.createElement("a");
    link.href = "/api/invoices/export.csv";
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <Button variant="outline" className="gap-2" onClick={() => void exportCsv()}>
      <Download data-icon="inline-start" className="size-4" />
      Export CSV
    </Button>
  );
}
