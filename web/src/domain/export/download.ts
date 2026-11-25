// Browser helpers for exports (DOM; not unit tested except safeFileName, which is pure).

export const MIME = {
  json: "application/json",
  csv: "text/csv;charset=utf-8",
  markdown: "text/markdown;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** File-system safe base name (no extension): strips reserved/control characters, max 80 chars. */
export function safeFileName(name: string, fallback = "estimate"): string {
  let s = (name ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (s.length > 80) s = s.slice(0, 80).replace(/[.\s]+$/g, "");
  if (!s) return fallback;
  return RESERVED.test(s) ? `${s}_` : s;
}

/** Triggers a download of `data` as `filename`. */
export function downloadBlob(data: Blob | BlobPart, filename: string, mime: string): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke later: Safari/Firefox may still be reading the blob right after click().
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Copies text to the clipboard (Clipboard API, then a textarea fallback). Resolves false on failure. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back below (permission denied, document not focused…).
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    const selection = document.getSelection();
    const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (previous && selection) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
    return ok;
  } catch {
    return false;
  }
}
