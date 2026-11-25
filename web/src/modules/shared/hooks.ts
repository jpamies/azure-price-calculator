// Small React hooks shared by the pickers.
import { useLayoutEffect, useState, type RefObject } from "react";

/** Content-box width of an element, kept in sync with a ResizeObserver (fallback until measured). */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback = 960): number {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth || fallback);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fallback]);
  return width;
}

/** Index after a list navigation key, or null when the key is not a navigation key. */
export function navigateIndex(key: string, current: number, count: number, page: number, ctrl: boolean): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const from = current < 0 ? -1 : current;
  switch (key) {
    case "ArrowDown":
      return Math.min(last, from + 1);
    case "ArrowUp":
      return Math.max(0, from <= 0 ? 0 : from - 1);
    case "PageDown":
      return Math.min(last, Math.max(0, from) + page);
    case "PageUp":
      return Math.max(0, from - page);
    case "Home":
      return ctrl ? 0 : null;
    case "End":
      return ctrl ? last : null;
    default:
      return null;
  }
}
