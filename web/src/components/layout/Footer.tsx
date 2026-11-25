import { Link } from "react-router-dom";
import { ExternalLink } from "@/components/ExternalLink";
import { LINKS } from "@/lib/links";

export function Footer() {
  return (
    <footer className="border-t bg-card/60">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 px-4 py-5 text-xs text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <p className="max-w-2xl leading-relaxed">
          Unofficial estimates from Azure Retail Prices list prices — not a quote. Not affiliated with Microsoft. Discounts, taxes and Marketplace offers are not
          included.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Link to="/about" className="font-medium hover:text-foreground hover:underline">
            About
          </Link>
          <ExternalLink href={LINKS.officialCalculator} className="hover:text-foreground">
            Official calculator
          </ExternalLink>
          <ExternalLink href={LINKS.retailPricesApi} className="hover:text-foreground">
            Retail Prices API
          </ExternalLink>
          <ExternalLink href={LINKS.exporter} className="hover:text-foreground">
            Price data
          </ExternalLink>
        </nav>
      </div>
    </footer>
  );
}
