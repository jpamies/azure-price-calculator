import { CloudAlert, CloudCheck } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSaveStatus } from "@/store/useStore";

/** "Saved" / "Saving…" / "Not saved" (autosave to localStorage). Only errors are announced. */
export function SaveIndicator() {
  const { status, error } = useSaveStatus();
  return (
    <>
      <span role="alert" className="sr-only">
        {status === "error" ? error : ""}
      </span>
      {status === "error" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="inline-flex items-center gap-1 rounded-sm text-destructive outline-none focus-visible:outline-2 focus-visible:outline-ring">
              <CloudAlert className="size-3.5" aria-hidden="true" />
              Not saved
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{error}</TooltipContent>
        </Tooltip>
      ) : status === "saving" ? (
        <span className="inline-flex items-center gap-1 text-muted-foreground" aria-hidden="true">
          <Spinner className="size-3.5" aria-label={undefined} role={undefined} />
          Saving…
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-muted-foreground" title="Saved in this browser">
          <CloudCheck className="size-3.5 text-success" aria-hidden="true" />
          Saved
        </span>
      )}
    </>
  );
}
