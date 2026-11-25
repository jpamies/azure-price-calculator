import { InfoTip } from "@/components/InfoTip";
import { COMMITMENT_LABELS } from "@/domain/totals";
import type { ItemResult, Line } from "@/domain/types";
import type { MoneyFormatter } from "@/lib/format";
import { formatNumber } from "@/lib/format";

function termLabel(months: number): string {
  if (months % 12 === 0) return `${months / 12}-year term`;
  return `${months}-month term`;
}

function Notes({ line }: { line: Line }) {
  if (line.notes.length === 0) return null;
  return (
    <InfoTip label={`Notes for ${line.label}`} className="-my-0.5">
      <ul className="grid gap-1">
        {line.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </InfoTip>
  );
}

function Quantity({ line }: { line: Line }) {
  return (
    <>
      {formatNumber(line.quantity)} <span className="text-muted-foreground">{line.unit}</span>
    </>
  );
}

function UnitPrice({ line, money }: { line: Line; money: MoneyFormatter }) {
  return (
    <>
      {money.unit(line.unitPriceUsd)}
      {line.termMonths ? <span className="block text-xs text-muted-foreground">per {termLabel(line.termMonths)}</span> : null}
    </>
  );
}

function commitmentBadge(line: Line): string | null {
  return line.commitment && line.commitment !== "payg" ? COMMITMENT_LABELS[line.commitment] : null;
}

/** Price breakdown of one item: a table on ≥ sm, stacked rows on phones. */
export function ItemLines({ result, money }: { result: ItemResult; money: MoneyFormatter }) {
  const { lines } = result;
  if (lines.length === 0) return null;
  const hasUpfront = lines.some((l) => l.upfrontUsd > 0);
  return (
    <div>
      <table className="hidden w-full text-sm sm:table">
        <caption className="sr-only">Price breakdown</caption>
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-3 text-left font-medium">
              Line
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Quantity
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Unit price
            </th>
            <th scope="col" className="py-2 pl-3 text-right font-medium">
              Monthly
            </th>
            {hasUpfront && (
              <th scope="col" className="py-2 pl-3 text-right font-medium">
                Upfront
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const badge = commitmentBadge(line);
            return (
              <tr key={line.id} className="border-b align-top last:border-b-0">
                <td className="py-2 pr-3">
                  <div className="flex items-start gap-1">
                    <span className="font-medium">{line.label}</span>
                    {badge && <span className="mt-px rounded-sm bg-accent px-1 text-[11px] font-medium whitespace-nowrap text-accent-foreground">{badge}</span>}
                    <Notes line={line} />
                  </div>
                  {line.detail && <div className="text-xs text-muted-foreground">{line.detail}</div>}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                  <Quantity line={line} />
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                  <UnitPrice line={line} money={money} />
                </td>
                <td className="py-2 pl-3 text-right font-medium whitespace-nowrap tabular-nums">{money.format(line.monthlyUsd)}</td>
                {hasUpfront && (
                  <td className="py-2 pl-3 text-right whitespace-nowrap tabular-nums">{line.upfrontUsd > 0 ? money.format(line.upfrontUsd) : "—"}</td>
                )}
              </tr>
            );
          })}
        </tbody>
        {lines.length > 1 && (
          <tfoot>
            <tr className="border-t">
              <th scope="row" colSpan={3} className="py-2 pr-3 text-right text-xs font-medium text-muted-foreground">
                Subtotal
              </th>
              <td className="py-2 pl-3 text-right font-semibold whitespace-nowrap tabular-nums">{money.format(result.monthlyUsd)}</td>
              {hasUpfront && <td className="py-2 pl-3 text-right font-semibold whitespace-nowrap tabular-nums">{money.format(result.upfrontUsd)}</td>}
            </tr>
          </tfoot>
        )}
      </table>

      <ul className="divide-y sm:hidden" aria-label="Price breakdown">
        {lines.map((line) => {
          const badge = commitmentBadge(line);
          return (
            <li key={line.id} className="py-2.5 text-sm first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-start gap-1">
                    <span className="font-medium">{line.label}</span>
                    <Notes line={line} />
                  </div>
                  {line.detail && <div className="text-xs text-muted-foreground">{line.detail}</div>}
                </div>
                <div className="shrink-0 text-right font-semibold tabular-nums">
                  {money.format(line.monthlyUsd)}
                  <span className="text-xs font-normal text-muted-foreground">/mo</span>
                  {line.upfrontUsd > 0 && <div className="text-xs font-normal text-muted-foreground">+ {money.format(line.upfrontUsd)} upfront</div>}
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
                <span>
                  <Quantity line={line} />
                </span>
                <span aria-hidden="true">×</span>
                <span>
                  {money.unit(line.unitPriceUsd)}
                  {line.termMonths ? ` per ${termLabel(line.termMonths)}` : ""}
                </span>
                {badge && <span className="rounded-sm bg-accent px-1 font-medium text-accent-foreground">{badge}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
