// Single-select dropdown with rich options (label + description + right-aligned aside such as a
// price or a savings chip). Radix Select: keyboard, typeahead, portal. Wired to the enclosing Field.
import type { ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { useFieldControl } from "./Field";

export interface RichOption<V extends string> {
  value: V;
  /** Shown in the list and (as the selected value) in the trigger. */
  label: ReactNode;
  /** Second line in the list only. */
  description?: ReactNode;
  /** Right side of the list row only (price, savings…). */
  aside?: ReactNode;
  disabled?: boolean;
  /** Typeahead text when the label is not plain text. */
  textValue?: string;
}

export interface RichSelectProps<V extends string> {
  value: V;
  onValueChange: (value: V) => void;
  options: readonly RichOption<V>[];
  /** Extra content inside the trigger, right-aligned before the chevron (e.g. a savings chip). */
  triggerAside?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** e.g. a min width for wide option rows. */
  contentClassName?: string;
  "aria-label"?: string;
}

export function RichSelect<V extends string>({
  value,
  onValueChange,
  options,
  triggerAside,
  placeholder,
  disabled,
  className,
  contentClassName,
  ...aria
}: RichSelectProps<V>) {
  const field = useFieldControl();
  return (
    <SelectPrimitive.Root value={value} onValueChange={(v) => onValueChange(v as V)} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={field?.controlId}
        aria-describedby={field?.describedBy}
        aria-label={aria["aria-label"]}
        data-slot="rich-select-trigger"
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-control-border bg-transparent px-2.5 text-left text-sm whitespace-nowrap shadow-xs transition-colors outline-none dark:bg-input/30 dark:hover:bg-input/50",
          "hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
          "disabled:cursor-not-allowed disabled:opacity-60 data-[placeholder]:text-muted-foreground",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        {triggerAside}
        <SelectPrimitive.Icon asChild>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            "relative z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-x-hidden overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
            contentClassName,
          )}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                textValue={o.textValue}
                className={cn(
                  "relative flex w-full cursor-default items-center gap-3 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none",
                  "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                  </div>
                  {o.description ? <div className="text-xs leading-4 text-muted-foreground">{o.description}</div> : null}
                </div>
                {o.aside ? <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">{o.aside}</div> : null}
                <span className="absolute right-2 flex size-4 items-center justify-center">
                  <SelectPrimitive.ItemIndicator>
                    <Check aria-hidden="true" className="size-4 text-primary" />
                  </SelectPrimitive.ItemIndicator>
                </span>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/** Small "−62%" chip (green when cheaper, amber when more expensive). */
export function SavingsChip({ fraction, text, className }: { fraction: number | null; text: string; className?: string }) {
  if (fraction === null || !text) return null;
  const cheaper = fraction > 0.0005;
  const dearer = fraction < -0.0005;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-[11px] font-semibold tabular-nums",
        cheaper ? "bg-success/12 text-success" : dearer ? "bg-warning-bg text-warning" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {text}
    </span>
  );
}
