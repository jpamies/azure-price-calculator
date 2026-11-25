import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface InfoTipProps {
  /** Accessible name of the trigger, e.g. "About currency conversion". */
  label: string;
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** Custom trigger content (default: an info icon). */
  trigger?: ReactNode;
}

/**
 * Info icon with a small explanation: opens on mouse hover like a tooltip, and on tap / click /
 * Enter like a popover (Radix tooltips never open on touch screens).
 */
export function InfoTip({ label, children, className, side = "top", align = "center", trigger }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const pointer = useRef<string>("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onPointerDown={(e) => {
            pointer.current = e.pointerType;
          }}
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") setOpen(true);
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") setOpen(false);
          }}
          onClick={(e) => {
            // Hover already opened it: a mouse click must not toggle it closed.
            if (pointer.current === "mouse" && open) e.preventDefault();
            pointer.current = "";
          }}
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
            className,
          )}
        >
          {trigger ?? <Info className="size-3.5" aria-hidden="true" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="w-auto max-w-[min(20rem,calc(100vw-2rem))] p-3 text-xs leading-relaxed"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
