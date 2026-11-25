// Fixed-row-height windowing (no dependency): renders only the visible rows (+ overscan) of a
// scroll container, with an optional sticky header that scrolls horizontally with the rows.
import { useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/utils";

export interface VirtualListHandle {
  /** Scrolls the minimum needed to show the row ("center" puts it mid-viewport). */
  scrollToIndex(index: number, align?: "auto" | "center"): void;
}

export interface VirtualListProps<T> {
  items: readonly T[];
  rowHeight: number;
  /** Render one row; apply `style` (absolute position) to the row's root element. */
  renderRow: (item: T, index: number, style: CSSProperties) => ReactNode;
  overscan?: number;
  /** Sticky header rendered inside the scroller (above the rows). */
  header?: ReactNode;
  headerHeight?: number;
  /** Scroller classes; it needs a height (e.g. "h-80" or "min-h-0 flex-1"). */
  className?: string;
  /** Scroller inline style (e.g. a height computed from the item count). */
  style?: CSSProperties;
  /** Wrapper of header + rows, e.g. a min width for horizontal scrolling. */
  innerClassName?: string;
  handleRef?: Ref<VirtualListHandle>;
  /** Shown instead of the rows when `items` is empty. */
  empty?: ReactNode;
  /** Attributes of the rows container (e.g. role="listbox"). */
  listProps?: Record<string, string | number | boolean | undefined>;
  onMouseLeave?: () => void;
}

export function VirtualList<T>({
  items,
  rowHeight,
  renderRow,
  overscan = 6,
  header,
  headerHeight = 0,
  className,
  style,
  innerClassName,
  handleRef,
  empty,
  listProps,
  onMouseLeave,
}: VirtualListProps<T>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(480);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || 480);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the scroll position valid when the list shrinks (filtering).
  const total = items.length * rowHeight;
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el && el.scrollTop !== scrollTop) setScrollTop(el.scrollTop);
  }, [items.length, scrollTop]);

  useImperativeHandle(
    handleRef,
    () => ({
      scrollToIndex(index: number, align: "auto" | "center" = "auto") {
        const el = scrollerRef.current;
        if (!el || index < 0) return;
        const top = headerHeight + index * rowHeight;
        const bodyHeight = el.clientHeight - headerHeight;
        let next = el.scrollTop;
        if (align === "center") next = top - headerHeight - (bodyHeight - rowHeight) / 2;
        else if (top - headerHeight < el.scrollTop) next = top - headerHeight;
        else if (top + rowHeight > el.scrollTop + el.clientHeight) next = top + rowHeight - el.clientHeight;
        next = Math.max(0, Math.min(next, headerHeight + total - el.clientHeight));
        if (next !== el.scrollTop) {
          el.scrollTop = next;
          setScrollTop(el.scrollTop);
        }
      },
    }),
    [headerHeight, rowHeight, total],
  );

  const bodyScroll = Math.max(0, scrollTop - headerHeight);
  const first = Math.max(0, Math.floor(bodyScroll / rowHeight) - overscan);
  const last = Math.min(items.length - 1, Math.ceil((bodyScroll + viewport) / rowHeight) + overscan);
  const rows: ReactNode[] = [];
  for (let i = first; i <= last; i++) {
    rows.push(renderRow(items[i], i, { position: "absolute", top: i * rowHeight, left: 0, right: 0, height: rowHeight }));
  }

  return (
    <div
      ref={scrollerRef}
      tabIndex={-1}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onMouseLeave={onMouseLeave}
      style={style}
      className={cn("relative overflow-auto overscroll-contain outline-none", className)}
    >
      <div className={cn("min-w-full", innerClassName)}>
        {header ? (
          <div className="sticky top-0 z-10" style={{ height: headerHeight }}>
            {header}
          </div>
        ) : null}
        <div {...listProps} style={{ position: "relative", height: total }}>
          {rows}
        </div>
        {items.length === 0 ? empty : null}
      </div>
    </div>
  );
}
