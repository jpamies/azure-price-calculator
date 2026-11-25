// File input helpers.

/** Largest JSON file accepted by the import buttons. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/** Reads a user-selected file as text; rejects with a user-facing message. */
export async function readTextFile(file: File, maxBytes = MAX_IMPORT_BYTES): Promise<string> {
  if (file.size > maxBytes) {
    throw new Error(`The file is too large (${Math.round(file.size / 1024 / 1024)} MB). The limit is ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }
  try {
    return await file.text();
  } catch {
    throw new Error("The file couldn't be read.");
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
