import type { ComponentProps } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Link that opens in a new tab, with an outbound-arrow hint and a screen-reader note. */
export function ExternalLink({ className, children, showIcon = true, ...props }: ComponentProps<"a"> & { showIcon?: boolean }) {
  return (
    <a
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-0.5 underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    >
      {children}
      {showIcon && <ArrowUpRight className="size-3 shrink-0 opacity-70" aria-hidden="true" />}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
