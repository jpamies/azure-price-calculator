// Route chunks (code splitting). import() is cached by the module loader, so calling a loader again
// is free: use it to prefetch a page on intent (hover / focus / touch of a link to it).
export const loadHomePage = () => import("./HomePage");
export const loadEstimatePage = () => import("./EstimatePage");
export const loadSettingsPage = () => import("./SettingsPage");
export const loadAboutPage = () => import("./AboutPage");

/** Starts downloading the editor chunk (ignores failures: navigation will retry and report them). */
export function prefetchEstimatePage(): void {
  loadEstimatePage().catch(() => undefined);
}

/** Props that prefetch the editor when the user is about to open it. */
export const prefetchEditorProps = {
  onPointerEnter: prefetchEstimatePage,
  onFocus: prefetchEstimatePage,
  onTouchStart: prefetchEstimatePage,
} as const;
