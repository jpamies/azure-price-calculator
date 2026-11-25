// Segmented control = a radio group styled as joined buttons (Radix RadioGroup: roving focus,
// ←/→ move and select, Tab enters at the checked option). Options can be disabled.
import type { ReactNode } from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { useFieldControl } from "./Field";

export interface SegmentedOption<V extends string> {
  value: V;
  label: ReactNode;
  /** Accessible name when the label is abbreviated. */
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
}

export interface SegmentedProps<V extends string> {
  value: V;
  onValueChange: (value: V) => void;
  options: readonly SegmentedOption<V>[];
  /** Needed outside a Field. */
  "aria-label"?: string;
  className?: string;
  disabled?: boolean;
}

export function Segmented<V extends string>({ value, onValueChange, options, className, disabled, ...aria }: SegmentedProps<V>) {
  const field = useFieldControl();
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(v) => onValueChange(v as V)}
      orientation="horizontal"
      loop
      disabled={disabled}
      id={field?.controlId}
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-label"] ? undefined : field?.labelId}
      aria-describedby={field?.describedBy}
      data-slot="segmented"
      className={cn(
        // @container: option labels may adapt to the control's own width (@min-[…]: variants).
        "@container flex h-8 w-full min-w-0 items-stretch gap-0.5 rounded-md border border-control-border bg-background p-0.5 shadow-xs dark:bg-input/30",
        className,
      )}
    >
      {options.map((o) => (
        <RadioGroupPrimitive.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          title={o.title}
          aria-label={o.ariaLabel}
          className={cn(
            "flex min-w-0 flex-auto items-center justify-center rounded-[4px] px-2 text-[13px] font-medium whitespace-nowrap text-foreground/85 transition-colors outline-none select-none",
            "hover:bg-muted hover:text-foreground focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid",
            "disabled:cursor-not-allowed disabled:text-muted-foreground/60 disabled:hover:bg-transparent",
            "data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:shadow-sm data-[state=checked]:hover:bg-primary",
          )}
        >
          <span className="truncate">{o.label}</span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
