import { useState } from "react";
import { ChevronRight, ClipboardCopy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { copyText } from "@/domain/export/download";
import { cn } from "@/lib/utils";

/** Auto-generated assumptions (collapsible) with a "Copy" button (Markdown bullet list). */
export function AssumptionsSection({ assumptions, defaultOpen = false }: { assumptions: string[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const copy = async () => {
    const ok = await copyText(assumptions.map((a) => `- ${a}`).join("\n"));
    if (ok) toast.success("Assumptions copied", { description: "Paste them into your proposal or email." });
    else toast.error("Couldn't copy to the clipboard");
  };
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="-ml-1 flex items-center gap-1 rounded-md px-1 py-0.5 text-sm font-semibold outline-none hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronRight className={cn("size-4 transition-transform duration-200", open && "rotate-90")} aria-hidden="true" />
            Assumptions
            <span className="font-normal text-muted-foreground tabular-nums">({assumptions.length})</span>
          </button>
        </CollapsibleTrigger>
        <Button variant="ghost" size="xs" onClick={copy} aria-label="Copy assumptions">
          <ClipboardCopy />
          Copy
        </Button>
      </div>
      <CollapsibleContent>
        <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-xs leading-relaxed text-muted-foreground marker:text-muted-foreground/60">
          {assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
