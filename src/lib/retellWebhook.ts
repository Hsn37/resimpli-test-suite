import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

// Retell webhook signature verification, faithful to Retell's documented scheme
// (docs.retellai.com/features/secure-webhook + retell-typescript-sdk verify()):
//
//   header  : x-retell-signature
//   value   : "v={timestampMs},d={hexDigest}"   (Stripe-like, versioned/timestamped)
//   digest  : HMAC-SHA256(rawBody + timestampMs, key), hex-encoded
//   key     : the workspace's Retell API key (the key with the "webhook badge").
//             Retell.verify(JSON.stringify(body), RETELL_API_KEY, signature) — the
//             API key IS the signing secret; there is no separate webhook secret.
//   replay  : reject signatures whose timestamp is older than 5 minutes.
//
// Signing key resolution: RETELL_WEBHOOK_SECRET is honored as an explicit
// override if set (so a deployment can pin a dedicated key), otherwise we use
// the workspace's Retell API key that the route already resolves. If neither is
// available we can't verify, so we accept but flag verified=false (degrades open,
// matching the client's original public endpoint) — set a key before registering
// the webhook publicly. See B6-2 / the deploy note.

export const RETELL_SIGNATURE_HEADER = "x-retell-signature";
const WEBHOOK_SECRET_ENV = "RETELL_WEBHOOK_SECRET";

// Signature is "v={timestampMs},d={hexDigest}".
const SIGNATURE_FORMAT = /^v=(\d+),d=([0-9a-f]+)$/i;
// Reject signatures whose timestamp is older than this (replay protection).
const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export interface WebhookVerification {
  ok: boolean; // whether to proceed with handling the request
  verified: boolean; // whether the signature was actually checked and matched
  reason?: string;
}

/** Constant-time compare of two hex digests. */
function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a Retell webhook.
 *
 * @param rawBody   the exact raw request body string (never a re-serialized JSON)
 * @param signatureHeader the x-retell-signature header value
 * @param signingKey the workspace's Retell API key (route passes
 *   retellKeyForWorkspace(workspace)); RETELL_WEBHOOK_SECRET overrides it if set.
 *
 * When a signing key is available, a valid, in-window signature is required
 * (ok=false otherwise). When no key is available at all, we accept but mark
 * verified=false so callers/logs know verification was skipped.
 */
export function verifyRetellWebhook(
  rawBody: string,
  signatureHeader: string | null,
  signingKey?: string | null
): WebhookVerification {
  // Explicit override wins; otherwise the workspace's Retell API key is the secret.
  const key = process.env[WEBHOOK_SECRET_ENV] || signingKey || "";
  if (!key) {
    return { ok: true, verified: false, reason: "secret_not_configured" };
  }
  if (!signatureHeader) {
    return { ok: false, verified: false, reason: "missing_signature" };
  }

  const match = SIGNATURE_FORMAT.exec(signatureHeader.trim());
  if (!match) {
    return { ok: false, verified: false, reason: "malformed_signature" };
  }
  const [, timestamp, providedDigest] = match;

  // Replay protection: reject stale timestamps.
  if (Math.abs(Date.now() - Number(timestamp)) > REPLAY_WINDOW_MS) {
    return { ok: false, verified: false, reason: "stale_signature" };
  }

  const expected = createHmac("sha256", key)
    .update(rawBody + timestamp)
    .digest("hex");
  if (!safeHexEqual(expected, providedDigest)) {
    return { ok: false, verified: false, reason: "signature_mismatch" };
  }
  return { ok: true, verified: true };
}
