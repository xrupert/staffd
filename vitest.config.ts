/**
 * Workspace-root Vitest config.
 *
 * Direct `vitest` invocation at the repo root discovers per-package vitest
 * configs in each workspace. Normal CI / dev flow goes through Turbo via
 * `pnpm test`, which runs each workspace's own `test` script (defined in
 * each package.json) — the per-workspace `vitest.config.ts` files (under
 * `packages/agents/` and `apps/web/`) carry the actual environment +
 * include-pattern configuration.
 *
 * This root config is informational + fallback for IDE integrations that
 * look for a top-level config.
 */

import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/*",
  "apps/*",
]);
