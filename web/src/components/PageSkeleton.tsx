import { useEffect, useState } from "react";
import { PageContainer } from "@/components/PageContainer";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Suspense fallback while a page chunk downloads. Invisible for the first 150 ms (cached chunks
 * resolve faster, so no flash), and it keeps the page height so the footer does not jump.
 */
export function PageSkeleton() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), 150);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <PageContainer className="min-h-[60vh]" aria-busy="true" aria-label="Loading page">
      {visible && (
        <div className="animate-in fade-in duration-300">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="mt-3 h-4 w-80 max-w-full" />
          <div className="mt-8 grid gap-4">
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        </div>
      )}
    </PageContainer>
  );
}
