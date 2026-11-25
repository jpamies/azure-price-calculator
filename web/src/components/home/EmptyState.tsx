import { Plus } from "lucide-react";
import { iconKeyForModule } from "@/catalog/icon-map";
import { ImportJsonButton } from "@/components/ImportJsonButton";
import { ServiceIcon } from "@/components/ServiceIcon";
import { Button } from "@/components/ui/button";
import { moduleIdSchema } from "@/domain/model";
import { prefetchEditorProps } from "@/pages/loaders";

const STEPS = [
  {
    title: "Add services",
    text: "Pick a guided calculator — Virtual Machines, Managed Disks, Backup, Site Recovery, SQL Server — or any meter from the full catalog.",
  },
  {
    title: "Configure",
    text: "Choose the region, size, quantity, hours and commitment (pay-as-you-go, reservations or savings plans). Totals update instantly.",
  },
  {
    title: "Share or export",
    text: "Copy a link that recreates the estimate, or download Excel, CSV or JSON with an auto-generated list of assumptions.",
  },
];

/** First-run screen of the estimates list. */
export function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section aria-labelledby="empty-title" className="relative overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="h-1 w-full" style={{ background: "var(--brand-gradient)" }} aria-hidden="true" />
      <div className="px-5 py-10 text-center sm:px-10 sm:py-14">
        <div className="mx-auto mb-6 flex w-fit items-center gap-2 sm:gap-3" aria-hidden="true">
          {moduleIdSchema.options.map((id, i) => (
            <span key={id} className={i % 2 === 1 ? "translate-y-1.5" : undefined}>
              <ServiceIcon iconKey={iconKeyForModule(id)} size={36} />
            </span>
          ))}
        </div>
        <h2 id="empty-title" className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
          Create your first estimate
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-balance text-muted-foreground sm:text-base">
          Estimate Azure costs from Microsoft's public list prices. Everything runs in your browser — nothing is sent to a server.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button size="lg" onClick={onCreate} {...prefetchEditorProps}>
            <Plus />
            New estimate
          </Button>
          <ImportJsonButton size="lg" />
        </div>
      </div>
      <div className="border-t bg-muted/40 px-5 py-8 sm:px-10">
        <h3 className="mb-5 text-center text-xs font-semibold tracking-wider text-muted-foreground uppercase">How it works</h3>
        <ol className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3 sm:flex-col sm:items-center sm:text-center">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <p className="font-medium">{step.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
