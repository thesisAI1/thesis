import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export type GroupGifKind = "buy" | "tp" | "close-split" | "author-claim";

const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));

// Default asset directory is resolved relative to this source file via import.meta.url.
// This works correctly under `tsx` / source-mode execution where __dirname ≈ src/adapters/telegram/.
//
// GOTCHA — dist/ builds: when compiled output lands in dist/, this path resolves relative
// to dist/adapters/telegram/ and the assets/ folder (which lives at repo root) is NOT
// automatically copied there. Under a dist/ build the assets dir will be missing and
// resolveAsset() will silently fall back to text-only messages (GIFs are skipped).
// Fix: copy the assets/ directory into dist/ as part of the build step, or set the
// TELEGRAM_ASSET_DIR env var to an absolute path before starting the compiled binary.
const DEFAULT_ASSET_DIR = join(MODULE_DIR, "..", "..", "..", "assets", "telegram");

const fileIdCache = new Map<GroupGifKind, string>();

// Emit the warning at most once per process to avoid log spam.
let _assetDirWarned = false;

/**
 * Returns { fileId } if a cached Telegram file_id exists,
 * { path } if the asset file exists on disk,
 * null if the file is absent (caller should fall back to text).
 *
 * NOTE: Under a dist/ build the default asset dir will be missing unless assets are
 * copied alongside the compiled output. resolveAsset() returns null in that case and
 * the notifier silently falls back to text. A one-time console.warn fires on first call
 * when the assets dir is absent so the omission is visible in production logs.
 */
export function resolveAsset(
  kind: GroupGifKind,
  baseDir: string = DEFAULT_ASSET_DIR,
): { fileId: string } | { path: string } | null {
  const cached = fileIdCache.get(kind);
  if (cached) return { fileId: cached };

  if (!existsSync(baseDir) && !_assetDirWarned) {
    _assetDirWarned = true;
    console.warn(
      `[telegram/assets] Asset directory not found: ${baseDir}. ` +
      `GIF animations will be skipped (text-only fallback). ` +
      `Copy assets/telegram/ next to the compiled output or set TELEGRAM_ASSET_DIR.`,
    );
  }

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
