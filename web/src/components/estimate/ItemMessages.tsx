import { CircleX, Info, RotateCw, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ItemMessage } from "@/domain/types";
import { cn } from "@/lib/utils";

const STYLES: Record<ItemMessage["level"], { icon: typeof Info; className: string }> = {
  error: {
    icon: CircleX,
    className: "border-destructive/30 bg-destructive/5 text-destructive *:data-[slot=alert-description]:text-destructive/90",
  },
  warning: {
    icon: TriangleAlert,
    className: "border-warning/30 bg-warning-bg text-warning *:data-[slot=alert-description]:text-warning",
  },
  info: {
    icon: Info,
    className: "border-primary/20 bg-accent text-accent-foreground *:data-[slot=alert-description]:text-accent-foreground",
  },
};

/** Module messages (error / warning / info) as compact alerts. Only errors are announced. */
export function ItemMessages({ messages, className }: { messages: ItemMessage[]; className?: string }) {
  if (messages.length === 0) return null;
  return (
    <div className={cn("grid gap-2", className)}>
      {messages.map((m, i) => {
        const { icon: Icon, className: tone } = STYLES[m.level] ?? STYLES.info;
        return (
          <Alert key={`${m.level}-${i}-${m.text}`} role={m.level === "error" ? "alert" : "note"} className={cn("py-2.5", tone)}>
            <Icon aria-hidden="true" />
            <AlertDescription>{m.text}</AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}

/** Price download failure with a retry button. */
export function LoadErrorAlert({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert role="alert" className={cn("items-center py-2.5", STYLES.error.className)}>
      <CircleX aria-hidden="true" />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>{message}</span>
        <Button size="xs" variant="outline" className="border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onRetry}>
          <RotateCw />
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}
