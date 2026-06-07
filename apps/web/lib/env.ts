// CRITICAL: This module must remain client-bundle-safe.
// No imports from node:fs, node:path, node:crypto, or any Node-only API.
// Pure env reads + string validation only.
// If you need server-only logic, put it in app/api/_lib/ and import from there into a server route — never from this file.

/**
 * Centralized env-var resolvers for URL-shaped config (Decision: PR-Tranche-1.6).
 *
 * **The W8 footgun.** `process.env.X ?? "default"` does NOT fall back when the
 * operator sets the env var to an empty string in Vercel — `??` only catches
 * `null`/`undefined`. The empty string is then concatenated into a fetch URL,
 * producing a relative path that crashes `fetch()` with "Failed to parse URL"
 * (undici).
 *
 * This module is the single source of truth for resolving URL-shaped env
 * vars. Every callsite that previously inlined `?? "https://..."` MUST import
 * from here. Adding a new URL env var? Add a resolver here; do not inline.
 *
 * Contract for every resolver:
 *   1. `undefined` env value → fallback to default
 *   2. `""` empty value → fallback to default (the W8 bug case)
 *   3. whitespace-only value → fallback to default
 *   4. value present but missing scheme → THROW (fail fast at module load)
 *   5. trailing slash on a valid value → stripped
 *   6. `http://` accepted alongside `https://` (self-hosted dev)
 *
 * Exception: `resolvePlausibleDomain()` does NOT throw on missing scheme —
 * Plausible's `data-domain` attribute expects a bare hostname, not a URL.
 */

const DEFAULT_MUAPI_BASE = "https://api.muapi.ai";
const DEFAULT_APP_URL = "https://urstaffd.com";
const DEFAULT_POCKETBASE_URL = "http://127.0.0.1:8090";
const DEFAULT_PLAUSIBLE_DOMAIN = "urstaffd.com";

const URL_SCHEME_RX = /^https?:\/\//i;

function stripTrailingSlash(s: string): string {
  return s.replace(/\/$/, "");
}

/**
 * Resolve `MUAPI_URL`. Falls back to `https://api.muapi.ai` on
 * undefined/empty/whitespace. Throws on missing scheme.
 */
export function resolveMuapiBase(): string {
  const raw = process.env.MUAPI_URL?.trim();
  if (!raw) return DEFAULT_MUAPI_BASE;
  if (!URL_SCHEME_RX.test(raw)) {
    throw new Error(
      `MUAPI_URL must include scheme (got "${raw}"). Set to ${DEFAULT_MUAPI_BASE} or remove the var.`,
    );
  }
  return stripTrailingSlash(raw);
}

/**
 * Resolve the app's public base URL for outbound success/cancel redirects
 * (Stripe Checkout, Customer Portal). Three-tier fallback:
 *   1. Caller's `origin` request header if present with a valid scheme
 *   2. `NEXT_PUBLIC_APP_URL` env if present with a valid scheme
 *   3. Default `https://urstaffd.com`
 *
 * Origin headers without a scheme are NOT honored (safety — never trust a
 * malformed Origin). Missing scheme on the env var THROWS at module load.
 */
export function resolveAppUrl(originHeader: string | null | undefined): string {
  const fromHeader = originHeader?.trim();
  if (fromHeader && URL_SCHEME_RX.test(fromHeader)) {
    return stripTrailingSlash(fromHeader);
  }
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return DEFAULT_APP_URL;
  if (!URL_SCHEME_RX.test(raw)) {
    throw new Error(
      `NEXT_PUBLIC_APP_URL must include scheme (got "${raw}"). Set to ${DEFAULT_APP_URL} or remove the var.`,
    );
  }
  return stripTrailingSlash(raw);
}

/**
 * Resolve the client-side PocketBase URL. Falls back to dev localhost on
 * undefined/empty/whitespace. Throws on missing scheme.
 *
 * Server routes that need the PB URL should continue using `pbUrl()` from
 * `app/api/_lib/pb.ts` (its own guard pattern). This resolver is specifically
 * for the client bundle (`lib/pb.ts`).
 */
export function resolvePocketbasePublicUrl(): string {
  const raw = process.env.NEXT_PUBLIC_POCKETBASE_URL?.trim();
  if (!raw) return DEFAULT_POCKETBASE_URL;
  if (!URL_SCHEME_RX.test(raw)) {
    throw new Error(
      `NEXT_PUBLIC_POCKETBASE_URL must include scheme (got "${raw}"). Set to a full URL or remove the var.`,
    );
  }
  return stripTrailingSlash(raw);
}

/**
 * Resolve `ANTHROPIC_API_KEY` (PR-Tranche-2.6 / W27.2).
 *
 * The Anthropic SDK auto-reads `process.env.ANTHROPIC_API_KEY` at
 * construction time when no explicit `apiKey` is passed. An empty-string
 * env value defeats nothing (SDK accepts it) — every subsequent
 * `messages.create()` then throws an opaque error that the orchestrator's
 * llm.ts wrapper catches and reports as `upstream_error`. THIS resolver
 * gives that error its real name at the call site.
 *
 * Throws on undefined / empty / whitespace; throws on missing `sk-ant-`
 * prefix (catches operator-typo class — wrong env value entirely).
 *
 * Callers should invoke this at the LLM call site (NOT at module load) so
 * test environments that mock the SDK don't trip the check. The orchestrator
 * llm.ts wrapper passes the resolved key to `new Anthropic({ apiKey })`
 * inside the per-attempt code path.
 */
export function resolveAnthropicKey(): string {
  const raw = process.env.ANTHROPIC_API_KEY?.trim();
  if (!raw) {
    throw new Error(
      "ANTHROPIC_API_KEY is missing or empty. Set it in Vercel env panel. " +
        "Orchestrator + agent loop both require this key to function.",
    );
  }
  if (!/^sk-ant-/i.test(raw)) {
    throw new Error(
      `ANTHROPIC_API_KEY format invalid (expected prefix "sk-ant-", got "${raw.slice(0, 10)}..."). ` +
        "Check Vercel env panel for typos or wrong value.",
    );
  }
  return raw;
}

/**
 * Resolve the Plausible analytics `data-domain` attribute. Falls back to
 * `urstaffd.com` on undefined/empty/whitespace. Does NOT throw on missing
 * scheme — this is a domain identifier (bare hostname), not a URL.
 */
export function resolvePlausibleDomain(): string {
  const raw = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN?.trim();
  if (!raw) return DEFAULT_PLAUSIBLE_DOMAIN;
  return raw;
}

/**
 * Eagerly resolved MUAPI base URL. Importing this constant triggers
 * `resolveMuapiBase()` at module load — misconfigured deploys crash on
 * first import rather than silently producing relative URLs at fetch time.
 */
export const MUAPI_BASE_URL: string = resolveMuapiBase();
