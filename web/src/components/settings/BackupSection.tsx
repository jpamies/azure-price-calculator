import { useRef, useState } from "react";
import { Download, FileUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { MIME, downloadBlob } from "@/domain/export/download";
import type { ImportResult } from "@/domain/export/json";
import { errorMessage, readTextFile } from "@/lib/files";
import { todayStamp } from "@/lib/time";
import { useStore } from "@/store/useStore";

type Mode = "merge" | "replace";

/** Backup export (all estimates + settings) and restore (merge or replace). */
export function BackupSection() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ImportResult | null>(null);
  const [mode, setMode] = useState<Mode>("merge");
  const count = useStore((s) => s.estimates.length);

  const exportBackup = async () => {
    try {
      // Export/import code is downloaded on first use (not part of the initial bundle).
      const { exportBackupJson } = await import("@/domain/export/json");
      const { estimates, settings } = useStore.getState();
      const filename = `azure-price-calculator-backup-${todayStamp()}.json`;
      downloadBlob(exportBackupJson({ estimates, settings }), filename, MIME.json);
      toast.success(`Downloaded ${filename}`, { description: `${estimates.length} ${estimates.length === 1 ? "estimate" : "estimates"} and your settings.` });
    } catch (e) {
      toast.error("Couldn't export the backup", { description: errorMessage(e) });
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const [text, { parseImportJson }] = await Promise.all([readTextFile(file), import("@/domain/export/json")]);
      const result = parseImportJson(text);
      setMode("merge");
      setPending(result);
    } catch (e) {
      toast.error("Couldn't read the backup", { description: errorMessage(e), duration: 10_000 });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const apply = () => {
    if (!pending) return;
    const store = useStore.getState();
    const n = pending.estimates.length;
    if (mode === "replace") {
      store.replaceAll({ estimates: pending.estimates, settings: pending.settings ?? store.settings });
      toast.success(`Restored ${n} ${n === 1 ? "estimate" : "estimates"}`, {
        description: pending.settings ? "Settings were restored too." : "Your settings were kept (the file has none).",
      });
    } else {
      store.importEstimates(pending.estimates);
      toast.success(`Added ${n} ${n === 1 ? "estimate" : "estimates"}`);
    }
    if (pending.warnings.length > 0) toast.warning("Some data was repaired or skipped", { description: pending.warnings.slice(0, 3).join(" "), duration: 10_000 });
    setPending(null);
  };

  const n = pending?.estimates.length ?? 0;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void exportBackup()}>
          <Download />
          Export backup
        </Button>
        <Button variant="outline" onClick={() => inputRef.current?.click()}>
          <FileUp />
          Restore from file…
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Restore backup</DialogTitle>
            <DialogDescription>
              The file contains {n} {n === 1 ? "estimate" : "estimates"}
              {pending?.settings ? " and settings" : ""}. You have {count} {count === 1 ? "estimate" : "estimates"} in this browser.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v === "replace" ? "replace" : "merge")} className="gap-2">
            <Label htmlFor="restore-merge" className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/50">
              <RadioGroupItem id="restore-merge" value="merge" className="mt-0.5" />
              <span className="grid gap-1">
                <span className="font-medium">Merge</span>
                <span className="text-xs leading-relaxed text-muted-foreground">Add the estimates from the file. Nothing is deleted; settings are not changed.</span>
              </span>
            </Label>
            <Label htmlFor="restore-replace" className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal has-[[data-state=checked]]:border-destructive has-[[data-state=checked]]:bg-destructive/5">
              <RadioGroupItem id="restore-replace" value="replace" className="mt-0.5" />
              <span className="grid gap-1">
                <span className="font-medium">Replace everything</span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  Delete your {count} current {count === 1 ? "estimate" : "estimates"}
                  {pending?.settings ? " and settings" : ""} and restore the file instead.
                </span>
              </span>
            </Label>
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant={mode === "replace" ? "destructive" : "default"} onClick={apply} disabled={n === 0}>
              {mode === "replace" ? "Replace" : "Merge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
