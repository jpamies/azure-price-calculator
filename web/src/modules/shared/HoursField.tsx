// Hours-per-month input with a "Reset to <default>" link (VM, SQL license, hourly generic meters).
import type { ReactNode } from "react";
import { HOURS_PER_MONTH, MAX_HOURS_PER_MONTH } from "@/domain/model";
import { Field, FieldAction } from "./Field";
import { NumberField } from "./NumberField";
import { fmtInt } from "./logic";

export interface HoursFieldProps {
  value: number;
  onCommit: (hours: number) => void;
  /** Value restored by the reset link (settings.hoursPerMonth, normally 730). */
  defaultHours?: number;
  hint?: ReactNode;
  className?: string;
  label?: string;
  disabled?: boolean;
}

export function HoursField({ value, onCommit, defaultHours = HOURS_PER_MONTH, hint, className, label = "Hours per month", disabled }: HoursFieldProps) {
  const usage = value === HOURS_PER_MONTH ? "Always on (24 × 365 ÷ 12)." : `${Math.round((value / HOURS_PER_MONTH) * 100)}% of a 730-hour month.`;
  return (
    <Field
      label={label}
      className={className}
      hint={hint ?? usage}
      action={
        value !== defaultHours && !disabled ? (
          <FieldAction onClick={() => onCommit(defaultHours)} label={`Reset hours per month to ${defaultHours}`}>
            Reset to {fmtInt(defaultHours)}
          </FieldAction>
        ) : null
      }
    >
      <NumberField value={value} onCommit={onCommit} min={0} max={MAX_HOURS_PER_MONTH} step={1} suffix="h" disabled={disabled} />
    </Field>
  );
}
