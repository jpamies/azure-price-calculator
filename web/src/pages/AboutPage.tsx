import type { ReactNode } from "react";
import { BrandMark } from "@/components/layout/BrandMark";
import { ExternalLink } from "@/components/ExternalLink";
import { NarrowContainer } from "@/components/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { useCatalog } from "@/data/hooks";
import { FX_DISCLAIMER, listCurrencies } from "@/domain/money";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { LINKS } from "@/lib/links";
import { formatUtc } from "@/lib/time";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <h2 id={id} className="font-heading text-lg font-semibold">
        {title}
      </h2>
      <div className="grid gap-3 text-sm leading-relaxed text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_strong]:font-medium [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

function SnapshotDetails() {
  const { status, catalog, error } = useCatalog();
  if (status === "loading") {
    return (
      <div className="grid gap-2 rounded-lg border bg-card p-4">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-4 w-2/3" />
        ))}
      </div>
    );
  }
  if (!catalog) return <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-destructive">Price data couldn't be loaded: {error}</p>;
  const { manifest, fx } = catalog;
  const sample = manifest.source.type === "fixture";
  const rows: [string, ReactNode][] = [
    ["Prices as of", <span className="tabular-nums">{manifest.pricesDate}</span>],
    ["Generated", formatUtc(manifest.generatedAt)],
    [
      "Source",
      sample ? (
        <span className="inline-flex flex-wrap items-center gap-2">
          Synthetic test fixture
          <Badge variant="outline" className="border-warning/40 bg-warning-bg text-warning">
            Sample data
          </Badge>
        </span>
      ) : (
        <span>
          {manifest.source.repo ? <ExternalLink href={`https://github.com/${manifest.source.repo.replace(/^https?:\/\/github\.com\//, "")}`}>{manifest.source.repo}</ExternalLink> : "Azure Retail Prices API export"}
        </span>
      ),
    ],
    ["Release", manifest.source.tag ?? "—"],
    ["Price rows", manifest.source.rowCount !== undefined ? formatNumber(manifest.source.rowCount) : "—"],
    ["Published rows", manifest.stats ? `${formatNumber(manifest.stats.rowsPublished)} in ${formatNumber(manifest.stats.files)} files` : "—"],
    ["Services · regions", `${formatNumber(catalog.services.length)} · ${formatNumber(catalog.regions.filter((r) => r.key !== "_global").length)}`],
    ["Savings plans", manifest.hasSavingsPlan ? "Included in this snapshot" : "Not in this snapshot (hidden in the calculators)"],
    ["Currencies", `${listCurrencies(fx).length} (FX snapshot ${fx.asOf})`],
  ];
  return (
    <dl className="overflow-hidden rounded-lg border bg-card text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid border-b last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <dt className="px-4 pt-2.5 text-xs font-medium text-muted-foreground sm:bg-muted/40 sm:py-2.5 sm:text-sm">{label}</dt>
          <dd className="px-4 pt-0.5 pb-2.5 break-words text-foreground sm:py-2.5">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AboutPage() {
  useDocumentTitle("About");
  return (
    <NarrowContainer>
      <div className="flex items-center gap-3">
        <BrandMark size={44} />
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">About</h1>
          <p className="text-sm text-muted-foreground">Azure Price Calculator — unofficial</p>
        </div>
      </div>

      <div className="mt-8 grid gap-9">
        <Section id="about-what" title="What this is">
          <p>
            An <strong>unofficial</strong>, open-source (MIT) estimator that mirrors the workflow of the{" "}
            <ExternalLink href={LINKS.officialCalculator}>official Azure Pricing Calculator</ExternalLink>: add services to an estimate, configure region, size,
            quantity, hours and commitment, and get monthly, upfront and annual totals with a breakdown and ready-to-paste assumptions.
          </p>
          <p>
            It is not affiliated with, endorsed or supported by Microsoft. Use it for quick, transparent list-price estimates; for quotes and agreement pricing use the
            official calculator or your Microsoft account team.
          </p>
        </Section>

        <Section id="about-data" title="Where the prices come from">
          <p>
            Prices are Microsoft's public list prices from the <ExternalLink href={LINKS.retailPricesApi}>Azure Retail Prices API</ExternalLink>, taken from the
            daily snapshot published by <ExternalLink href={LINKS.exporter}>sbroenne/azureretailprices-exporter</ExternalLink> (
            <ExternalLink href={LINKS.exporterReleases}>releases</ExternalLink>). A scheduled build splits the snapshot into small files per service and region, so your
            browser only downloads the prices it needs. Each day's data has its own address, so you never see stale cached prices.
          </p>
          <SnapshotDetails />
        </Section>

        <Section id="about-currency" title="Currencies">
          <p>{FX_DISCLAIMER}</p>
          <p>Conversions use the exchange rates published with the same snapshot and are applied only for display; exports state the currency used.</p>
        </Section>

        <Section id="about-limits" title="Limitations">
          <ul className="grid list-disc gap-1.5 pl-5">
            <li>List (retail) prices only — no Enterprise Agreement, MCA, CSP or other negotiated discounts.</li>
            <li>Azure Marketplace and third-party software (for example Red Hat or SUSE subscriptions) are not included.</li>
            <li>Taxes are not included.</li>
            <li>Spot and Low Priority prices are excluded unless you choose Spot on a virtual machine.</li>
            <li>Savings plan prices are shown only when the daily snapshot includes them.</li>
            <li>Free grants, free tiers and promotional offers are only reflected where the price data itself models them.</li>
            <li>Guided calculators cover Virtual Machines, Managed Disks, Azure Backup, Site Recovery and SQL Server licenses; any other service is priced meter by meter.</li>
          </ul>
        </Section>

        <Section id="about-privacy" title="Privacy">
          <p>
            There is <strong>no backend, no account and no telemetry</strong>. Your estimates and settings stay in this browser's localStorage; downloaded price files
            are cached in IndexedDB for the current snapshot only. Clearing your browser data removes them — use Settings → Backup to keep a copy.
          </p>
          <p>
            Share links contain the estimate's configuration (including the names you typed) in the URL itself. They are not encrypted, so avoid customer-identifying
            data in names before sharing links publicly.
          </p>
        </Section>

        <Section id="about-icons" title="Azure service icons">
          <p>
            Service icons are Microsoft's official <ExternalLink href={LINKS.architectureIcons}>Azure Architecture Icons</ExternalLink>, used unmodified to illustrate
            the Azure products they represent, as permitted by Microsoft's icon terms (architecture diagrams, training materials and documentation). They remain
            Microsoft's property and are not covered by this project's license. When an icon is not available a neutral placeholder tile is shown.{" "}
            <ExternalLink href={LINKS.iconsReadme}>Icon provenance and terms</ExternalLink>.
          </p>
        </Section>

        <Section id="about-links" title="Useful links">
          <ul className="grid gap-1.5">
            <li>
              <ExternalLink href={LINKS.officialCalculator}>Azure Pricing Calculator (official)</ExternalLink>
            </li>
            <li>
              <ExternalLink href={LINKS.calculatorGuide}>Estimate costs with the Azure pricing calculator (Microsoft Learn)</ExternalLink>
            </li>
            <li>
              <ExternalLink href={LINKS.retailPricesApi}>Azure Retail Prices REST API</ExternalLink>
            </li>
            <li>
              <ExternalLink href={LINKS.hybridBenefit}>Azure Hybrid Benefit</ExternalLink> ·{" "}
              <ExternalLink href={LINKS.savingsPlans}>Azure savings plan for compute</ExternalLink>
            </li>
          </ul>
        </Section>
      </div>
    </NarrowContainer>
  );
}
