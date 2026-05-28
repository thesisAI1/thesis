/**
 * SVG → PNG rasterisation for share cards. Uses @resvg/resvg-js (pure-Rust,
 * pre-built native binaries — no system libs needed beyond what npm installs).
 *
 * Also: fetch-and-base64 helper for embedding the author's X avatar inline,
 * so the rendered PNG bakes in the image bytes (vs leaving an external href
 * that the rasteriser would need network access to resolve).
 */

import { Resvg } from "@resvg/resvg-js";
import { log } from "../util/log.js";

/** Rasterise an SVG string to a PNG buffer. */
export function rasterise(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
    background: "#080A10",
    font: {
      // Hint at fonts present on Ubuntu — both shipping defaults. If neither
      // exists the fallback chain in the SVG handles it.
      defaultFontFamily: "Liberation Sans",
      loadSystemFonts: true,
    },
  });
  return resvg.render().asPng();
}

/** Fetch an avatar URL with a hard timeout and return a data: URI ready to
 *  drop into <image href="..."> inside the SVG. Returns null on any failure;
 *  the card falls back to the initials monogram in that case. */
export async function fetchAvatarAsDataUri(
  url: string | null | undefined,
  timeoutMs = 4_000,
): Promise<string | null> {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // X CDN serves a 403 with no User-Agent on some requests.
        "User-Agent": "thesis-agent/1.0 (+https://thesisonbase.com)",
      },
    });
    if (!res.ok) {
      log.warn(`avatar fetch ${res.status} for ${url}`);
      return null;
    }
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch (err) {
    log.warn(`avatar fetch failed for ${url}: ${String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
