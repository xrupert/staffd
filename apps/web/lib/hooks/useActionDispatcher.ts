"use client";

/**
 * useActionDispatcher (W64, SA Decision 3′) — the per-surface attachment
 * to W63's `staffd:action-select` seam.
 *
 * One listener per mounted surface; internal dispatch by candidate.id;
 * handlers are closures over the surface's own state (the static buttons'
 * code paths ARE the handlers — Standard #9 / Decision 2). A global
 * dispatcher was ruled out in Phase A: every backend path is bound to
 * surface-local React state, and the layout has no provider tree.
 *
 * Contracts:
 *   - Handlers map is read through a ref each event — closures stay fresh
 *     across renders without re-binding the listener.
 *   - Per-candidate-id debounce (1s) kills double-click races.
 *   - Unhandled action ids warn and noop (incl. publish_social per D8′ —
 *     hidden in UI, but a defensive seam if anything ever dispatches it).
 *   - Cleanup on unmount.
 */

import { useEffect, useRef } from "react";
import type { ActionCandidate } from "../../app/api/_lib/orchestrator/action-vocabulary";
import type { ActionId } from "../../app/api/_lib/orchestrator/action-vocabulary";
import type { ActionContext } from "../../app/components/ActionAffordances";

export type ActionHandlers = Partial<
  Record<ActionId, (candidate: ActionCandidate, context: ActionContext) => void>
>;

const DEBOUNCE_MS = 1_000;

export function useActionDispatcher(handlers: ActionHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const lastFiredRef = useRef<Record<string, number>>({});

  useEffect(() => {
    function onSelect(e: Event) {
      const detail = (e as CustomEvent).detail as
        | { candidate?: ActionCandidate; context?: ActionContext }
        | undefined;
      const candidate = detail?.candidate;
      const context = detail?.context;
      if (!candidate?.id || !context?.department) {
        console.warn("[W64] action-select with invalid payload — ignoring", detail);
        return;
      }

      // Debounce by candidate id — double-click protection.
      const now = Date.now();
      const last = lastFiredRef.current[candidate.id] ?? 0;
      if (now - last < DEBOUNCE_MS) return;
      lastFiredRef.current[candidate.id] = now;

      const handler = handlersRef.current[candidate.id];
      if (!handler) {
        console.warn(`[W64] no handler registered for action "${candidate.id}" on this surface — noop`);
        return;
      }
      handler(candidate, context);
    }

    window.addEventListener("staffd:action-select", onSelect);
    return () => window.removeEventListener("staffd:action-select", onSelect);
  }, []);
}
