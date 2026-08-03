/**
 * Signed capability token for Studio output URLs (live incident: the
 * first successful render was undeliverable — <video> elements cannot
 * send Authorization headers, so the owner-authed proxy 401'd the
 * owner's own player). The completion URL carries an HMAC capability
 * scoped to the single job id; the proxy accepts EITHER a valid session
 * (API callers) OR this token (media elements). Same trust class as the
 * public muapi CDN URLs the single-clip path already returns.
 */

import crypto from "node:crypto";

function secret(): string {
  return process.env.MONTAGE_WEBHOOK_SECRET ?? process.env.MONTAGE_API_KEY ?? "";
}

export function outputToken(montageJobId: string): string {
  return crypto.createHmac("sha256", secret()).update(`output:${montageJobId}`).digest("hex").slice(0, 32);
}

export function verifyOutputToken(montageJobId: string, given: string | null): boolean {
  if (!given || !secret()) return false;
  const expected = outputToken(montageJobId);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
