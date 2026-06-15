/**
 * Integrations health-check — probe classifier contract.
 *
 * classifyProbe turns a read-only ping result into an operator-readable
 * status so the admin can confirm Twenty / Chatwoot / Listmonk / Docuseal
 * are configured AND authenticating — without creating any records.
 */

import { describe, it, expect } from "vitest";
import { classifyProbe } from "../../app/api/admin/integrations-health/route";

describe("classifyProbe (integrations health)", () => {
  it("not_configured when env is missing", () => {
    expect(classifyProbe(false, null)).toBe("not_configured");
    expect(classifyProbe(false, { ok: true, status: 200 })).toBe("not_configured");
  });

  it("ok on a 2xx response", () => {
    expect(classifyProbe(true, { ok: true, status: 200 })).toBe("ok");
  });

  it("auth_failed on 401/403 (configured but bad credentials)", () => {
    expect(classifyProbe(true, { ok: false, status: 401 })).toBe("auth_failed");
    expect(classifyProbe(true, { ok: false, status: 403 })).toBe("auth_failed");
  });

  it("unreachable when the request threw (null result)", () => {
    expect(classifyProbe(true, null)).toBe("unreachable");
  });

  it("error on other non-2xx (e.g. 500, 404)", () => {
    expect(classifyProbe(true, { ok: false, status: 500 })).toBe("error");
    expect(classifyProbe(true, { ok: false, status: 404 })).toBe("error");
  });
});
