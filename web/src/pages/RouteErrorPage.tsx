import { Bug, RotateCw } from "lucide-react";
import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { flushSave } from "@/store/useStore";
import { StatusMessage } from "./NotFoundPage";

// A lazy page chunk failed to download: usually a new deploy replaced the hashed files.
const CHUNK_LOAD_ERROR = /dynamically imported module|Importing a module script failed|Loading chunk .* failed/i;

function describe(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Rendered by the router when a page throws while rendering. Saved data is not affected. */
export default function RouteErrorPage() {
  const error = useRouteError();
  console.error(error);
  const chunkError = error instanceof Error && CHUNK_LOAD_ERROR.test(error.message);
  return (
    <StatusMessage
      icon={chunkError ? <RotateCw /> : <Bug />}
      title={chunkError ? "A new version is available" : "Something went wrong"}
      action={
        <>
          <Button
            onClick={() => {
              flushSave();
              window.location.reload();
            }}
          >
            <RotateCw />
            Reload
          </Button>
          <Button variant="outline" asChild>
            <Link to="/">Go to estimates</Link>
          </Button>
        </>
      }
    >
      {chunkError ? (
        <p>This page couldn't be loaded, usually because the site was just updated. Reload to get the latest version — your estimates are saved in this browser.</p>
      ) : (
        <>
          <p>This page hit an unexpected error. Your estimates are saved in this browser.</p>
          <p className="mt-3 rounded-md bg-muted px-3 py-2 font-mono text-xs break-words">{describe(error)}</p>
        </>
      )}
    </StatusMessage>
  );
}
