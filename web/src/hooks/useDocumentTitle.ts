import { useEffect } from "react";

export const APP_NAME = "Azure Price Calculator";

/** Sets `document.title` to "<title> · Azure Price Calculator" (or the app name alone). */
export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    const t = title?.trim();
    document.title = t ? `${t} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}
