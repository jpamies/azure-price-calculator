import { Suspense, lazy } from "react";
import { Outlet, ScrollRestoration, useMatch } from "react-router-dom";
import { DataBanners } from "@/components/layout/DataBanners";
import { Footer } from "@/components/layout/Footer";
import { TopBar } from "@/components/layout/TopBar";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Toaster } from "@/components/ui/sonner";
import { useApplyTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { useSettings } from "@/store/useStore";

// Share links (?s=…, #s=…, #/route?s=…) are rare: the import dialog and the share codec are only
// downloaded when the page was opened with one (the dialog re-checks with readShareParam).
const HAS_SHARE_PARAM = typeof window !== "undefined" && /[?&#]s=/.test(window.location.href);
const SharedEstimateImport = lazy(() => import("@/components/SharedEstimateImport").then((m) => ({ default: m.SharedEstimateImport })));

function focusMain(event: React.MouseEvent<HTMLAnchorElement>) {
  // The hash router owns location.hash: move focus instead of following "#main".
  event.preventDefault();
  const main = document.getElementById("main");
  main?.focus();
  main?.scrollIntoView();
}

/** Layout of every page: top bar, data banners, page outlet, footer, toasts, share-link import. */
export function AppShell() {
  const theme = useSettings().theme;
  const resolvedTheme = useApplyTheme(theme);
  // The editor shows a fixed summary bar at the bottom on small screens.
  const onEditor = useMatch("/estimate/:id") !== null;

  return (
    <div className={cn("flex min-h-dvh flex-col", onEditor && "max-lg:pb-[calc(4.5rem+env(safe-area-inset-bottom))]")}>
      <a
        href="#main"
        onClick={focusMain}
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <TopBar />
      <DataBanners />
      <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
      {HAS_SHARE_PARAM && (
        <Suspense fallback={null}>
          <SharedEstimateImport />
        </Suspense>
      )}
      <Toaster
        theme={resolvedTheme}
        position="bottom-right"
        closeButton
        mobileOffset={onEditor ? { bottom: "calc(5rem + env(safe-area-inset-bottom))" } : undefined}
      />
      <ScrollRestoration />
    </div>
  );
}
