// Form layout primitives shared by every module form: a container-query grid and a labelled field
// (label above, optional action link, control, hint/error below) that wires ids for a11y.
import { createContext, useContext, useId, useMemo, useState, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface FieldControlIds {
  /** id of the control (the <label> points at it). */
  controlId: string;
  labelId: string;
  /** id of the hint/error paragraph when there is one. */
  describedBy?: string;
  invalid: boolean;
  /** Lets a control show a transient validation message in place of the hint. */
  setLiveError(message: string | null): void;
}

const FieldContext = createContext<FieldControlIds | null>(null);

/** Ids of the enclosing Field (null outside a Field). Used by NumberField, Segmented, pickers. */
export function useFieldControl(): FieldControlIds | null {
  return useContext(FieldContext);
}

/** Props a third-party control needs to be wired to its Field (render-prop children). */
export interface FieldRenderProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

export interface FieldProps {
  label: ReactNode;
  /** Muted text below the control (text-xs). */
  hint?: ReactNode;
  /** Replaces the hint in the destructive colour and marks the control invalid. */
  error?: ReactNode;
  /** Warning text below the hint (non-blocking). */
  warning?: ReactNode;
  /** Right side of the label row, e.g. a "Reset" link. */
  action?: ReactNode;
  /** Grid placement, e.g. "@3xl:col-span-2". */
  className?: string;
  id?: string;
  children: ReactNode | ((props: FieldRenderProps) => ReactNode);
}

export function Field({ label, hint, error, warning, action, className, id, children }: FieldProps) {
  const auto = useId();
  const controlId = id ?? `fld-${auto.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [liveError, setLiveError] = useState<string | null>(null);
  const shownError = error ?? liveError;
  const hasHint = Boolean(shownError || hint);
  const hintId = `${controlId}-hint`;
  const ids = useMemo<FieldControlIds>(
    () => ({
      controlId,
      labelId: `${controlId}-label`,
      describedBy: hasHint ? hintId : undefined,
      invalid: Boolean(shownError),
      setLiveError,
    }),
    [controlId, hasHint, hintId, shownError],
  );
  const renderProps: FieldRenderProps = {
    id: controlId,
    ...(ids.describedBy ? { "aria-describedby": ids.describedBy } : {}),
    ...(shownError ? { "aria-invalid": true as const } : {}),
  };
  return (
    <div data-slot="module-field" className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex min-h-5 items-end justify-between gap-2">
        <label id={ids.labelId} htmlFor={controlId} className="text-[13px] leading-5 font-semibold text-foreground">
          {label}
        </label>
        {action}
      </div>
      <FieldContext.Provider value={ids}>
        {typeof children === "function" ? children(renderProps) : children}
      </FieldContext.Provider>
      {shownError ? (
        <p id={hintId} className="text-xs leading-4 text-destructive" aria-live="polite">
          {shownError}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs leading-4 text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {warning ? <p className="text-xs leading-4 text-warning">{warning}</p> : null}
    </div>
  );
}

/** Responsive grid driven by the form's own width: 1 column, 2 from 32rem, 3 from 48rem. */
export function FieldGrid({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("grid grid-cols-1 gap-x-4 gap-y-4 @lg:grid-cols-2 @3xl:grid-cols-3", className)}>{children}</div>;
}

/** Root of every module form: establishes the container for the @-breakpoints. */
export function FormRoot({ className, children, ...rest }: { className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-slot="module-config" className={cn("@container flex flex-col gap-4 text-sm", className)} {...rest}>
      {children}
    </div>
  );
}

/** Small text button for the label row ("Reset to 730"). */
export function FieldAction({ onClick, children, label }: { onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="rounded-sm text-xs leading-5 font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
    </button>
  );
}

/** Informational callout (not an alert): notes about what is or is not included. */
export function Note({ children, tone = "info", className, icon }: { children: ReactNode; tone?: "info" | "warning"; className?: string; icon?: ReactNode }) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-5",
        tone === "info" ? "border-primary/25 bg-accent/60 text-foreground" : "border-warning/40 bg-warning-bg text-foreground",
        className,
      )}
    >
      {icon ? <span className={cn("mt-0.5 shrink-0 [&_svg]:size-3.5", tone === "info" ? "text-primary" : "text-warning")}>{icon}</span> : null}
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}
