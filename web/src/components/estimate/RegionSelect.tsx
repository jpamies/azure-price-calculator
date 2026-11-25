import { useMemo } from "react";
import { MapPin } from "lucide-react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RegionInfo } from "@/domain/types";
import { groupRegions } from "@/lib/regions";
import { cn } from "@/lib/utils";

export interface RegionSelectProps {
  value: string;
  onChange: (region: string) => void;
  regions: readonly RegionInfo[];
  /** Region keys where the item can be priced (null = all). */
  allowed: ReadonlySet<string> | null;
  /** Display name of `value` (used when it is not in the list). */
  valueName: string;
  disabled?: boolean;
  className?: string;
  /** Accessible name, e.g. "Region for Web servers". */
  label?: string;
}

/** Region picker grouped by geography; the current region stays visible even if unavailable. */
export function RegionSelect({ value, onChange, regions, allowed, valueName, disabled, className, label = "Region" }: RegionSelectProps) {
  const groups = useMemo(() => groupRegions(regions, allowed), [regions, allowed]);
  const listed = groups.some((g) => g.regions.some((r) => r.key === value));
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        size="sm"
        aria-label={label}
        // Radix SelectValue ignores className: left-align the value from the trigger.
        className={cn("min-w-0 gap-1.5 *:data-[slot=select-value]:flex-1 *:data-[slot=select-value]:text-left", className)}
      >
        <MapPin className="size-3.5" aria-hidden="true" />
        <SelectValue placeholder="Choose a region">{value ? valueName : undefined}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="end" className="max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-56">
        {value && !listed && (
          <SelectGroup>
            <SelectLabel>Current</SelectLabel>
            <SelectItem value={value}>
              {valueName} <span className="text-xs text-muted-foreground">(not available)</span>
            </SelectItem>
          </SelectGroup>
        )}
        {groups.map((g) => (
          <SelectGroup key={g.geography}>
            <SelectLabel className="font-semibold">{g.geography}</SelectLabel>
            {g.regions.map((r) => (
              <SelectItem key={r.key} value={r.key}>
                {r.displayName}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
