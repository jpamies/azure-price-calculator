import { useState } from "react";
import { ChevronDown, ClipboardCopy, Download, FileJson, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ExportContext } from "@/lib/assumptions";
import { errorMessage } from "@/lib/files";

export type ExportKind = "json" | "csv" | "xlsx" | "markdown";

/** Runs one export and reports the outcome with a toast. The builders are downloaded on first use. */
export async function runExport(kind: ExportKind, ctx: ExportContext): Promise<void> {
  try {
    const { copyEstimateMarkdown, downloadEstimateCsv, downloadEstimateJson, downloadEstimateXlsx } = await import("@/lib/estimateExports");
    if (kind === "markdown") {
      if (await copyEstimateMarkdown(ctx)) toast.success("Markdown table copied", { description: "Paste it into an email, a document or a chat." });
      else toast.error("Couldn't copy to the clipboard", { description: "Your browser blocked clipboard access. Try another export format." });
      return;
    }
    const filename =
      kind === "json" ? downloadEstimateJson(ctx) : kind === "csv" ? downloadEstimateCsv(ctx) : await downloadEstimateXlsx(ctx);
    toast.success(`Downloaded ${filename}`);
  } catch (e) {
    toast.error("Export failed", { description: errorMessage(e) });
  }
}

export interface ExportMenuProps {
  getContext: () => ExportContext;
  /** Prices are still loading: price-based exports are disabled. */
  pricesPending: boolean;
  compact?: boolean;
}

/** Export menu: JSON / CSV / Excel downloads and a Markdown table to the clipboard. */
export function ExportMenu({ getContext, pricesPending, compact }: ExportMenuProps) {
  const [busy, setBusy] = useState(false);
  const run = (kind: ExportKind) => {
    let ctx: ExportContext;
    try {
      ctx = getContext();
    } catch (e) {
      toast.error("Export failed", { description: errorMessage(e) });
      return;
    }
    setBusy(true);
    void runExport(kind, ctx).finally(() => setBusy(false));
  };
  const pendingHint = pricesPending ? <span className="ml-auto text-xs text-muted-foreground">Loading…</span> : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy} aria-label="Export estimate">
          <Download />
          <span className={compact ? "sr-only" : "sr-only sm:not-sr-only"}>Export</span>
          <ChevronDown className="-mr-0.5 size-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Download</DropdownMenuLabel>
        <DropdownMenuItem disabled={pricesPending} onSelect={() => run("xlsx")}>
          <FileSpreadsheet />
          Excel workbook (.xlsx)
          {pendingHint}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={pricesPending} onSelect={() => run("csv")}>
          <FileText />
          CSV (.csv)
          {pendingHint}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("json")}>
          <FileJson />
          JSON (.json)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={pricesPending} onSelect={() => run("markdown")}>
          <ClipboardCopy />
          Copy as Markdown table
          {pendingHint}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
