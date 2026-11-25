import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ComponentProps } from "react";
import { errorMessage, readTextFile } from "@/lib/files";
import { useStore } from "@/store/useStore";

function warningsDescription(warnings: string[]): string | undefined {
  if (warnings.length === 0) return undefined;
  const shown = warnings.slice(0, 3).join(" ");
  return warnings.length > 3 ? `${shown} (+${warnings.length - 3} more warnings)` : shown;
}

/** "Import JSON": adds the estimates of an exported estimate/backup file (fresh ids, nothing replaced). */
export function ImportJsonButton({ label = "Import JSON", ...props }: ComponentProps<typeof Button> & { label?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const [text, { parseImportJson }] = await Promise.all([readTextFile(file), import("@/domain/export/json")]);
      const result = parseImportJson(text);
      const ids = useStore.getState().importEstimates(result.estimates);
      const count = ids.length;
      const notes = [warningsDescription(result.warnings), result.settings ? "Settings in the file were not applied (use Settings → Restore backup)." : undefined]
        .filter(Boolean)
        .join(" ");
      const title = count === 1 ? `Imported “${result.estimates[0].name}”` : `Imported ${count} estimates`;
      const options = {
        description: notes || undefined,
        duration: notes ? 10_000 : undefined,
        action: count === 1 ? { label: "Open", onClick: () => navigate(`/estimate/${ids[0]}`) } : undefined,
      };
      if (result.warnings.length > 0) toast.warning(title, options);
      else toast.success(title, options);
    } catch (e) {
      toast.error("Couldn't import the file", { description: errorMessage(e), duration: 10_000 });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <Button variant="outline" disabled={busy} onClick={() => inputRef.current?.click()} {...props}>
        <FileUp />
        {label}
      </Button>
    </>
  );
}
