import { Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { PageContainer } from "@/components/PageContainer";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export function StatusMessage({ icon, title, children, action }: { icon: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <PageContainer className="flex flex-1 items-center justify-center py-16">
      <div className="flex max-w-md flex-col items-center text-center">
        <span className="mb-4 inline-flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground [&_svg]:size-7" aria-hidden="true">
          {icon}
        </span>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
        {children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}
        {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
      </div>
    </PageContainer>
  );
}

export default function NotFoundPage() {
  useDocumentTitle("Page not found");
  return (
    <StatusMessage
      icon={<Compass />}
      title="Page not found"
      action={
        <Button asChild>
          <Link to="/">Go to estimates</Link>
        </Button>
      }
    >
      <p>The page you're looking for doesn't exist. Check the link or start from your estimates.</p>
    </StatusMessage>
  );
}
