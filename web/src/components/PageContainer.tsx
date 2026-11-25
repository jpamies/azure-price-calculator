import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Centered page width used by every page (matches the top bar). */
export function PageContainer({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8", className)} {...props} />;
}

/** Narrow container for text pages (Settings, About). */
export function NarrowContainer({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10", className)} {...props} />;
}
