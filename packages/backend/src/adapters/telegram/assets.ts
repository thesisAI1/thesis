import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export type GroupGifKind = "buy" | "tp" | "close-split" | "author-claim";

const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));

// Default asset directory — callers may override via createAssetRegistry(baseDir)
const DEFAULT_ASSET_DIR = join(MODULE_DIR, "..", "..", "..", "assets", "telegram");

const fileIdCache = new Map<GroupGifKind, string>();

/**
 * Returns { fileId } if a cached Telegram file_id exists,
 * { path } if the asset file exists on disk,
 * null if the file is absent (caller should fall back to text).
 */
export function resolveAsset(
  kind: GroupGifKind,
  baseDir: string = DEFAULT_ASSET_DIR,
): { fileId: string } | { path: string } | null {
  const cached = fileIdCache.get(kind);
  if (cached) return { fileId: cached };

  const filePath = join(baseDir, `${kind}.mp4`);
  if (existsSync(filePath)) return { path: filePath };

  return null;
}

/**
 * Cache the Telegram file_id returned after first upload so subsequent
 * sends skip the multipart upload and use the cached reference.
 */
export function rememberFileId(kind: GroupGifKind, fileId: string): void {
  fileIdCache.set(kind, fileId);
}

/**
 * Clear the in-memory cache. Useful in tests.
 */
export function clearFileIdCache(): void {
  fileIdCache.clear();
}

export const DEFAULT_TELEGRAM_ASSET_DIR = DEFAULT_ASSET_DIR;
