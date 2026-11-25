// Validated numeric input: free typing (grouping, "5k", decimal comma), commits on blur/Enter,
// clamps to [min, max], ↑/↓ step (Shift ×10), Esc reverts. Editing starts from the displayed text
// (grouped digits) so the browser's select-all on focus is kept and typing replaces the value.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useFieldControl } from "./Field";
import { clampNumber, formatInputNumber, numberIssue, parseNumberInput } from "./logic";

export interface NumberFieldProps {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  /** Arrow-key step (default 1); Shift/PageUp/PageDown use ×10. */
  step?: number;
  integer?: boolean;
  /** Unit adornment inside the box, e.g. "GB", "h". */
  suffix?: ReactNode;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  name?: string;
}

export function NumberField({
  value,
  onCommit,
  min,
  max,
  step = 1,
  integer,
  suffix,
  id,
  disabled,
  placeholder,
  className,
  name,
  ...aria
}: NumberFieldProps) {
  const field = useFieldControl();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const bounds = { min, max, integer };
  const parsed = editing ? parseNumberInput(draft) : value;
  const issue = editing && draft.trim() !== "" ? numberIssue(parsed, bounds) : null;

  const setLiveError = field?.setLiveError;
  useEffect(() => {
    setLiveError?.(issue);
  }, [issue, setLiveError]);
  useEffect(() => () => setLiveError?.(null), [setLiveError]);

  /** Commits `text`; returns the committed value (null when it is not a number). */
  const commit = (text: string): number | null => {
    const n = parseNumberInput(text);
    if (n === null) return null;
    const v = clampNumber(n, bounds);
    if (v !== value) onCommit(v);
    return v;
  };

  const stepBy = (delta: number) => {
    const base = (draft !== null ? parseNumberInput(draft) : null) ?? value;
    const next = clampNumber(Number((base + delta).toPrecision(12)), bounds);
    if (next !== value) onCommit(next);
    setDraft(formatInputNumber(next));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case "Enter": {
        const v = commit(draft ?? formatInputNumber(value));
        setDraft(formatInputNumber(v ?? value));
        break;
      }
      case "Escape":
        if (draft !== null && draft !== formatInputNumber(value)) {
          e.preventDefault();
          e.stopPropagation();
          setDraft(formatInputNumber(value));
        }
        break;
      case "ArrowUp":
      case "ArrowDown":
        e.preventDefault();
        stepBy((e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
        break;
      case "PageUp":
      case "PageDown":
        e.preventDefault();
        stepBy((e.key === "PageUp" ? 1 : -1) * step * 10);
        break;
    }
  };

  const controlId = id ?? field?.controlId;
  const describedBy = aria["aria-describedby"] ?? field?.describedBy;
  const invalid = Boolean(issue) || Boolean(field?.invalid);
  return (
    <div
      data-slot="number-field"
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      onClick={() => inputRef.current?.focus()}
      className={cn(
        "flex h-8 w-full min-w-0 items-center rounded-md border border-control-border bg-transparent shadow-xs transition-[color,box-shadow] dark:bg-input/30",
        "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring focus-within:outline-solid",
        "data-[invalid]:border-destructive data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className,
      )}
    >
      <input
        ref={inputRef}
        id={controlId}
        name={name}
        type="text"
        role="spinbutton"
        inputMode={integer && (min ?? 0) >= 0 ? "numeric" : "decimal"}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={aria["aria-label"]}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-valuenow={Number.isFinite(value) ? value : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        value={editing ? draft : formatInputNumber(value)}
        onFocus={() => setDraft(formatInputNumber(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) commit(draft);
          setDraft(null);
        }}
        onKeyDown={onKeyDown}
        className="h-full w-full min-w-0 bg-transparent px-2.5 text-sm tabular-nums outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
      {suffix ? (
        <span aria-hidden="true" className="shrink-0 pr-2.5 text-xs text-muted-foreground select-none">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}
