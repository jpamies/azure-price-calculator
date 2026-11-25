// Searchable service combobox (cmdk) grouped by serviceFamily, with official icons and a badge for
// services that are global-only or not offered in the item region.
import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { ServiceInfo } from "@/domain/types";
import { ServiceIcon } from "@/components/ServiceIcon";
import { Command as CommandPrimitive } from "cmdk";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { FieldRenderProps } from "../shared/Field";

export interface ServiceComboboxProps {
  services: readonly ServiceInfo[];
  value: string;
  region: string;
  regionName: string;
  onSelect: (service: ServiceInfo) => void;
  fieldProps?: FieldRenderProps;
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export function ServiceCombobox({ services, value, region, regionName, onSelect, fieldProps }: ServiceComboboxProps) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const map = new Map<string, ServiceInfo[]>();
    for (const s of services) {
      const fam = s.serviceFamily || "Other";
      const list = map.get(fam);
      if (list) list.push(s);
      else map.set(fam, [s]);
    }
    return [...map.entries()]
      .sort(([a], [b]) => collator.compare(a, b))
      .map(([family, list]) => [family, [...list].sort((a, b) => collator.compare(a.serviceName, b.serviceName))] as const);
  }, [services]);
  const current = useMemo(() => services.find((s) => s.serviceName.toLowerCase() === value.trim().toLowerCase()), [services, value]);

  const badge = (s: ServiceInfo) => {
    if (!region || s.regions.includes(region)) return null;
    if (s.regions.includes("_global")) return "Global";
    return `Not in ${regionName}`;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          {...fieldProps}
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          data-slot="service-combobox"
          className={cn(
            "flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-control-border bg-transparent px-2.5 text-left text-sm shadow-xs transition-colors dark:bg-input/30",
            "hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
          )}
        >
          {current ? <ServiceIcon serviceName={current.serviceName} serviceFamily={current.serviceFamily} size={18} /> : null}
          <span className={cn("min-w-0 flex-1 truncate", current ? "font-semibold" : "text-muted-foreground")}>{value.trim() || "Choose a service"}</span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-[min(22rem,calc(100vw-2rem))] p-0">
        <Command loop>
          <CommandInput placeholder={`Search ${services.length} services…`} aria-label="Search services" />
          <CommandList className="max-h-[min(22rem,50dvh)]">
            <CommandEmpty>No service found.</CommandEmpty>
            {groups.map(([family, list]) => (
              <CommandGroup key={family} heading={family}>
                {list.map((s) => {
                  const b = badge(s);
                  const isCurrent = current === s;
                  return (
                    <CommandPrimitive.Item
                      key={s.serviceName}
                      value={s.serviceName}
                      keywords={[family]}
                      onSelect={() => {
                        onSelect(s);
                        setOpen(false);
                      }}
                      className="relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                    >
                      <ServiceIcon serviceName={s.serviceName} serviceFamily={s.serviceFamily} size={18} />
                      <span className={cn("min-w-0 flex-1 truncate", isCurrent && "font-semibold")}>{s.serviceName}</span>
                      {b ? <span className="shrink-0 rounded-sm bg-muted px-1.5 text-[11px] text-muted-foreground">{b}</span> : null}
                      <Check aria-hidden="true" className={cn("size-4 shrink-0 text-primary", isCurrent ? "opacity-100" : "opacity-0")} />
                    </CommandPrimitive.Item>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
