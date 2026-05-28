/**
 * X v1.1 media upload — the only path that lets us attach an image to a v2
 * tweet using OAuth 1.0a credentials. v2's media endpoint exists but requires
 * OAuth 2.0 user context which we don't set up.
 *
 * For our use case (single PNGs under 5MB) the simple non-chunked upload form
 * is all we need.
 */

import { config } from "../../config.js";
import { oauth1Header } from "../../util/oauth1.js";

const UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";

/**
 * Upload a PNG buffer to X. Returns the `media_id_string` to attach to a
 * subsequent tweet via the v2 `/2/tweets` endpoint's `media.media_ids`.
 * Throws on failure — callers should catch and fall back to text-only.
 */
export async function uploadPng(png: Buffer): Promise<string> {
  if (!config.x.apiKey || !config.x.accessToken) {
    throw new Error("X OAuth 1.0a credentials required for media upload.");
  }

  // OAuth 1.0a signs ONLY the URL + oauth_* params for multipart uploads.
  // Body is excluded from the signature base string.
  const authHeader = oauth1Header("POST", UPLOAD_URL, {
    apiKey: config.x.apiKey,
    apiSecret: config.x.apiSecret,
    accessToken: config.x.accessToken,
    accessSecret: config.x.accessSecret,
  });

  // Build multipart/form-data manually — we want full control over the bytes
  // (Node's FormData mangles binary in some setups).
  const boundary = "----thesisAgent" + Math.random().toString(36).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="media"; filename="card.png"\r\n` +
      `Content-Type: image/png\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([head, png, tail]);

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`X media upload ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as { media_id_string?: string };
  if (!json.media_id_string) {
    throw new Error("X media upload returned no media_id_string");
  }
  return json.media_id_string;
}
