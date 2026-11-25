import type { ReactNode } from "react";
import { CircleAlert, FlaskConical, History, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isStale, snapshotAgeDays } from "@/data/catalog";
import { useCatalog } from "@/data/hooks";
import { cn } from "@/lib/utils";

function Banner({ tone, icon, children, action }: { tone: "warning" | "error"; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "border-b text-sm",
        tone === "warning" ? "border-warning/25 bg-warning-bg text-warning" : "border-destructive/25 bg-destructive/8 text-destructive",
      )}
    >
      <div className="mx-auto flex w-full max-w-[1440px] items-start gap-2.5 px-4 py-2 sm:items-center sm:px-6 lg:px-8">
        <span className="mt-0.5 shrink-0 sm:mt-0 [&_svg]:size-4" aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0 flex-1 leading-snug">{children}</div>
        {action}
      </div>
    </div>
  );
}

/** Global data notices: catalog load error (with retry), sample data, stale snapshot. */
export function DataBanners() {
  const { status, catalog, error, retry } = useCatalog();

  if (status === "error") {
    return (
      <Banner
        tone="error"
        icon={<CircleAlert />}
        action={
          <Button size="sm" variant="outline" className="h-7 shrink-0 border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={retry}>
            <RotateCw />
            Retry
          </Button>
        }
      >
        <strong className="font-semibold">Price data couldn't be loaded.</strong> <span className="opacity-90">{error}</span> Your estimates are safe; prices will appear once the data loads.
      </Banner>
    );
  }
  if (status !== "ready" || !catalog) return null;

  const { manifest } = catalog;
  const banners: ReactNode[] = [];
  if (manifest.source.type === "fixture") {
    banners.push(
      <Banner key="sample" tone="warning" icon={<FlaskConical />}>
        <strong className="font-semibold">Sample data.</strong> Prices come from a synthetic test fixture, not from Azure — don't use them for decisions.
      </Banner>,
    );
  }
  if (isStale(manifest.pricesDate)) {
    const age = snapshotAgeDays(manifest.pricesDate);
    banners.push(
      <Banner key="stale" tone="warning" icon={<History />}>
        <strong className="font-semibold">Prices may be outdated.</strong> The price snapshot is from {manifest.pricesDate} ({age} days old); the daily refresh may have
        failed.
      </Banner>,
    );
  }
  return banners.length > 0 ? <>{banners}</> : null;
}
