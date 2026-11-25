import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InlineEditProps {
  value: string;
  /** Called with the trimmed text when it changed (empty text reverts). */
  onCommit: (value: string) => void;
  /** Accessible name, e.g. "Estimate name". */
  label: string;
  /** Shown when the value is empty. */
  placeholder?: string;
  /** Text styles shared by the display and the input (font size/weight). */
  className?: string;
  maxLength?: number;
}

/**
 * Text that turns into an input on click (or Enter/Space when focused). Enter or blur saves,
 * Escape cancels. Focus returns to the text after a keyboard commit.
 */
export function InlineEdit({ value, onCommit, label, placeholder = "Untitled", className, maxLength = 120 }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  const start = () => {
    setDraft(value);
    setEditing(true);
  };
  const finish = (save: boolean, keyboard: boolean) => {
    if (!editing) return;
    const next = draft.trim();
    if (save && next !== "" && next !== value) onCommit(next);
    refocus.current = keyboard;
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        aria-label={label}
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true, false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true, true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(false, true);
          }
        }}
        className={cn(
          "-mx-1.5 w-[calc(100%+0.75rem)] min-w-0 rounded-md border border-control-border bg-background px-1.5 py-0 shadow-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
          className,
        )}
      />
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={start}
      title={`Rename ${label.toLowerCase()}`}
      className={cn(
        "group/inline -mx-1.5 inline-flex max-w-[calc(100%+0.75rem)] min-w-0 items-center gap-1.5 rounded-md border border-transparent px-1.5 text-left transition-colors outline-none hover:border-border hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
        className,
      )}
    >
      <span className={cn("min-w-0 truncate", !value && "text-muted-foreground")}>{value || placeholder}</span>
      <Pencil className="size-[0.75em] shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/inline:opacity-100 group-focus-visible/inline:opacity-100" aria-hidden="true" />
    </button>
  );
}
