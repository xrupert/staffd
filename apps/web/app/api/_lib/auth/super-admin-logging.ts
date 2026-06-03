/**
 * Super-admin audit + usage logging helpers (Decision 74).
 *
 * Both functions are NON-BLOCKING on PB failure — a logging error must
 * never prevent the primary operation from succeeding. Failures are
 * console.warn'd for observability.
 *
 * - `logSuperAdminAccess` writes to `super_admin_audit_log` (every
 *   bypass / dashboard access / admin route call).
 * - `logSuperAdminUsage` writes to `super_admin_usage_log` (premium
 *   operations that would have cost a normal user credits or hit a
 *   billing endpoint).
 */

import { adminHeaders, getAdminToken, pbUrl } from "../pb";
import type { SuperAdminUser } from "./super-admin";

/**
 * Strip secrets from parameter objects before persisting. Recursive,
 * case-insensitive substring match on common secret key names.
 */
function sanitize(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);

  const REDACT = ["password", "token", "secret", "apikey", "api_key", "authorization", "pbtoken"];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (REDACT.some((r) => k.toLowerCase().includes(r))) {
      out[k] = "[redacted]";
    } else if (v && typeof v === "object") {
      out[k] = sanitize(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export type AccessResult = "success" | "error" | "denied";

export async function logSuperAdminAccess(
  user: SuperAdminUser,
  actionType: string,
  resource: string,
  opts?: {
    parameters?: unknown;
    result?: AccessResult;
    error?: string;
    request?: Request;
  },
): Promise<void> {
  try {
    const token = await getAdminToken();
    const headers = opts?.request?.headers;
    const ipAddress =
      headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      headers?.get("x-real-ip") ??
      "";
    const userAgent = headers?.get("user-agent") ?? "";

    const body = {
      user: user.id,
      action_type: actionType,
      resource,
      parameters: opts?.parameters ? JSON.stringify(sanitize(opts.parameters)) : "",
      result: opts?.result ?? "success",
      error_detail: opts?.error ?? "",
      ip_address: ipAddress,
      user_agent: userAgent,
    };

    const res = await fetch(`${pbUrl()}/api/collections/super_admin_audit_log/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[logSuperAdminAccess] PB ${res.status} (non-blocking): ${detail.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn("[logSuperAdminAccess] failed (non-blocking):", err);
  }
}

export async function logSuperAdminUsage(
  user: SuperAdminUser,
  operationType: string,
  opts?: {
    operation_detail?: string;
    parameters?: unknown;
  },
): Promise<void> {
  try {
    const token = await getAdminToken();
    const body = {
      user: user.id,
      operation_type: operationType,
      operation_detail: opts?.operation_detail ?? "",
      parameters: opts?.parameters ? JSON.stringify(sanitize(opts.parameters)) : "",
    };
    const res = await fetch(`${pbUrl()}/api/collections/super_admin_usage_log/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[logSuperAdminUsage] PB ${res.status} (non-blocking): ${detail.slice(0, 200)}`);
    }
  } catch (err) {
    console.warn("[logSuperAdminUsage] failed (non-blocking):", err);
  }
}
