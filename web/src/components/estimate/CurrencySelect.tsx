import { InfoTip } from "@/components/InfoTip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { FxTable } from "@/domain/types";
import { FX_DISCLAIMER, currencyDisplayName, currencyRate, listCurrencies } from "@/domain/money";
import { cn } from "@/lib/utils";

export interface CurrencySelectProps {
  value: string;
  fx?: FxTable;
  onChange: (currency: string) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/** Display currency picker (USD + FX snapshot currencies) with the FX disclaimer for non-USD. */
export function CurrencySelect({ value, fx, onChange, disabled, className, id }: CurrencySelectProps) {
  const codes = listCurrencies(fx);
  if (value && !codes.includes(value)) codes.push(value);
  const rate = currencyRate(fx, value);
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} size="sm" className="w-[5.75rem] font-medium tabular-nums" aria-label={`Currency: ${currencyDisplayName(value)}`}>
          <SelectValue>{value}</SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="end" className="max-h-80">
          {codes.map((code) => (
            <SelectItem key={code} value={code}>
              <span className="w-10 font-medium tabular-nums">{code}</span>
              <span className="text-muted-foreground">{currencyDisplayName(code)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value !== "USD" && (
        <InfoTip label="About currency conversion" side="bottom" align="end">
          <p>{FX_DISCLAIMER}</p>
          {rate !== null && (
            <p className="mt-1.5 text-muted-foreground tabular-nums">
              1 USD = {Number(rate.toPrecision(6))} {value}
              {fx?.asOf ? ` (FX snapshot ${fx.asOf})` : ""}
            </p>
          )}
          {rate === null && <p className="mt-1.5 text-muted-foreground">No exchange rate for {value} in this snapshot: amounts are shown in USD.</p>}
        </InfoTip>
      )}
    </div>
  );
}
