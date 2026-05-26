/**
 * OAuth 1.0a request signing — needed for the agent to POST replies on X.
 *
 * Reading the X API uses an app-only bearer token, but posting a tweet
 * requires user context. OAuth 1.0a with pre-generated access tokens is the
 * simplest fit for a bot posting from one fixed account.
 */

import { createHmac, randomBytes } from "node:crypto";

export interface Oauth1Creds {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

/** RFC 3986 percent-encoding (stricter than encodeURIComponent). */
function pct(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Build an OAuth 1.0a `Authorization` header.
 *
 * For JSON-body POSTs the body is NOT part of the signature — only the URL,
 * its query parameters and the oauth_* parameters are signed.
 */
export function oauth1Header(
  method: string,
  url: string,
  creds: Oauth1Creds,
  queryParams: Record<string, string> = {},
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };

  const all: Record<string, string> = { ...oauth, ...queryParams };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${pct(k)}=${pct(all[k])}`)
    .join("&");
  const base = `${method.toUpperCase()}&${pct(url)}&${pct(paramString)}`;
  const signingKey = `${pct(creds.apiSecret)}&${pct(creds.accessSecret)}`;
  oauth.oauth_signature = createHmac("sha1", signingKey).update(base).digest("base64");

  const header = Object.keys(oauth)
    .sort()
    .map((k) => `${pct(k)}="${pct(oauth[k])}"`)
    .join(", ");
  return `OAuth ${header}`;
}
