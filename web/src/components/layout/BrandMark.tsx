import { Calculator } from "lucide-react";
import { cn } from "@/lib/utils";

/** App logo: brand-gradient tile with a calculator glyph (decorative). */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[22%] text-white shadow-sm ring-1 ring-white/15 ring-inset",
        className,
      )}
      style={{ width: size, height: size, background: "var(--brand-gradient)" }}
    >
      <Calculator size={Math.round(size * 0.56)} strokeWidth={2} />
    </span>
  );
}
