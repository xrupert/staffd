"use client";

/**
 * StaleClientStateCleanup (W95.7.3a) — one-time removal of the orphaned
 * `staffd_active_client` localStorage key.
 *
 * W95.7.1 hid the ClientSwitcher (the only writer of this key) but left the
 * key in place and 7 active readers still sending it as `clientId` — which
 * routed operators into agency-client mode and shadowed STAFFD_SELF brand voice
 * (the W95.7.2 regression). The vault layer now enforces the operator override
 * regardless (the load-bearing fix); this clears the orphaned state so the
 * read sites resolve to null (Standard #30 — a hidden UI must clear its state).
 *
 * Mounted in the root layout so it runs on EVERY route (dept rooms are sibling
 * routes — a /dashboard/page mount would miss deep-links). Idempotent:
 * removeItem on an absent key is a no-op, safe to re-run on every load.
 *
 * // W95.7.3a — remove when W94 ships (clientId routing becomes legitimate
 * // again for non-super-admin agency users, and the ClientSwitcher returns).
 */

import { useEffect } from "react";

export default function StaleClientStateCleanup() {
  useEffect(() => {
    try {
      localStorage.removeItem("staffd_active_client");
    } catch {
      /* storage unavailable (private mode / SSR guard) — nothing to clean */
    }
  }, []);
  return null;
}
