import { useEffect, useState } from "react";
import { Check, Copy, FileJson, Share2, ShieldAlert, TriangleAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { copyText } from "@/domain/export/download";
import type { Estimate } from "@/domain/model";
import { formatNumber } from "@/lib/format";
import { errorMessage } from "@/lib/files";
import { cn } from "@/lib/utils";

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimate: Estimate;
  pricesDate?: string;
  onExportJson: () => void;
}

interface ShareLink {
  url: string;
  level: "ok" | "warn" | "too-long";
  /** SHARE_URL_WARN / SHARE_URL_MAX of domain/share.ts. */
  warnAt: number;
  max: number;
}

/** Share link (configuration only, `?s=…`) with length checks and a privacy caution. */
export function ShareDialog({ open, onOpenChange, estimate, pricesDate, onExportJson }: ShareDialogProps) {
  const [link, setLink] = useState<ShareLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // The share codec (deflate + base64url) is downloaded on first use.
    import("@/domain/share")
      .then(async (share) => {
        const url = share.buildShareUrl(window.location.href, await share.encodeShare(estimate, pricesDate));
        if (cancelled) return;
        setLink({ url, level: share.shareUrlLevel(url), warnAt: share.SHARE_URL_WARN, max: share.SHARE_URL_MAX });
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, estimate, pricesDate]);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setLink(null);
    }
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const url = link?.url ?? null;
  const level = link?.level ?? "ok";
  const length = url?.length ?? 0;
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async () => {
    if (!url) return;
    if (await copyText(url)) {
      setCopied(true);
      toast.success("Link copied");
    } else {
      toast.error("Couldn't copy the link", { description: "Select the link and copy it manually." });
    }
  };

  const nativeShare = async () => {
    if (!url) return;
    try {
      await navigator.share({ title: estimate.name, text: `Azure estimate: ${estimate.name}`, url });
    } catch {
      // Cancelled by the user.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Share estimate</DialogTitle>
          <DialogDescription>
            Anyone with the link can open a copy of “{estimate.name}”. Links carry the configuration only — prices are recalculated with the snapshot of the day the link
            is opened.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Couldn't create the link: {error}
          </p>
        ) : level === "too-long" ? (
          <div className="grid gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
            <p className="flex items-start gap-2 text-destructive">
              <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                This estimate is too large to share as a link ({formatNumber(length)} characters; the limit is {formatNumber(link?.max ?? 0)}). Export it as JSON and
                send the file instead — it can be imported from the Estimates page.
              </span>
            </p>
            <Button className="justify-self-start" onClick={onExportJson}>
              <FileJson />
              Export JSON
            </Button>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="share-url">Link</Label>
            <div className="flex gap-2">
              {url ? (
                <Input
                  id="share-url"
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 font-mono text-xs"
                  aria-describedby="share-length"
                />
              ) : (
                <Skeleton className="h-9 flex-1" />
              )}
              <Button onClick={copy} disabled={!url} className="shrink-0" aria-label="Copy link">
                {copied ? <Check /> : <Copy />}
                <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
              </Button>
            </div>
            <div id="share-length" className="flex h-4 items-center gap-3 text-xs text-muted-foreground">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                {link && (
                  <div
                    className={cn("h-full rounded-full transition-[width]", level === "warn" ? "bg-warning" : "bg-primary")}
                    style={{ width: `${Math.min(100, (length / link.max) * 100)}%` }}
                  />
                )}
              </div>
              {link ? (
                <span className="tabular-nums">
                  {formatNumber(length)} / {formatNumber(link.max)} characters
                </span>
              ) : (
                <Skeleton className="h-3 w-28" />
              )}
            </div>
            {level === "warn" && (
              <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  This link is long (over {formatNumber(link?.warnAt ?? 0)} characters). Some apps truncate long links — if it doesn't open,{" "}
                  <button type="button" className="font-medium underline underline-offset-2" onClick={onExportJson}>
                    export JSON
                  </button>{" "}
                  instead.
                </span>
              </p>
            )}
          </div>
        )}

        <p className="flex items-start gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <ShieldAlert className="mt-px size-4 shrink-0" aria-hidden="true" />
          <span>
            Share links contain your configuration (names included) — avoid customer-identifying data. Links are not encrypted and stay in browser histories and chat
            logs.
          </span>
        </p>

        <DialogFooter>
          {canNativeShare && url && level !== "too-long" && (
            <Button variant="outline" onClick={nativeShare}>
              <Share2 />
              Share…
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
