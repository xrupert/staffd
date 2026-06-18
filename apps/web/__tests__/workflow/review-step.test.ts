/**
 * W95.6.x — workflow review step in reconcileWorkflow: review_required workflows
 * pause at awaiting_review when their draft task lands; stay frozen until
 * approve/cancel; resume normally once the draft is stamped (post-approve).
 */

import { describe, it, expect, vi } from "vitest";
import { reconcileWorkflow, type ReconcileDeps, type WorkflowRecord, type WorkflowTaskStatus } from "../../app/api/_lib/workflow";

function deps(wf: WorkflowRecord, statuses: WorkflowTaskStatus[], over: Partial<ReconcileDeps> = {}): { deps: ReconcileDeps; updates: Record<string, unknown>[] } {
  const updates: Record<string, unknown>[] = [];
  return {
    updates,
    deps: {
      getWorkflow: async () => wf,
      getTaskStatuses: async () => statuses,
      updateWorkflow: async (_id, patch) => { updates.push(patch); },
      runAggregator: async () => "doc-1",
      logTransition: async () => {},
      getDraftOutput: async () => "the drafted reply",
      ...over,
    },
  };
}
const base = (o: Partial<WorkflowRecord>): WorkflowRecord => ({ id: "wf-1", user: "u", status: "running", aggregation_doc_id: null, started_at: "t", ...o });

describe("review step", () => {
  it("pauses a review_required workflow at awaiting_review when the draft task succeeds", async () => {
    const { deps: d, updates } = deps(base({ review_required: true, draft_output: null }), ["succeeded"]);
    const r = await reconcileWorkflow("wf-1", d);
    expect(r.to).toBe("awaiting_review");
    expect(updates[0]).toMatchObject({ status: "awaiting_review", draft_output: "the drafted reply" });
  });

  it("does NOT run the aggregator or complete a review_required workflow on draft completion", async () => {
    const agg = vi.fn(async () => "doc-1");
    const { deps: d } = deps(base({ review_required: true, draft_output: null }), ["succeeded"], { runAggregator: agg });
    await reconcileWorkflow("wf-1", d);
    expect(agg).not.toHaveBeenCalled();
  });

  it("freezes an already-awaiting_review workflow (no recompute back to completed)", async () => {
    const { deps: d, updates } = deps(base({ status: "awaiting_review", review_required: true, draft_output: "x" }), ["succeeded"]);
    const r = await reconcileWorkflow("wf-1", d);
    expect(r.changed).toBe(false);
    expect(r.to).toBe("awaiting_review");
    expect(updates).toHaveLength(0);
  });

  it("freezes a cancelled workflow", async () => {
    const { deps: d } = deps(base({ status: "cancelled", review_required: true, draft_output: "x" }), ["succeeded"]);
    expect((await reconcileWorkflow("wf-1", d)).to).toBe("cancelled");
  });

  it("resumes normally after approval (draft stamped, running) — does not re-pause", async () => {
    // post-approve: status running, draft_output set, draft + send tasks succeeded
    const { deps: d } = deps(base({ status: "running", review_required: true, draft_output: "x" }), ["succeeded", "succeeded"]);
    const r = await reconcileWorkflow("wf-1", d);
    expect(r.to).toBe("completed"); // aggregator ran → completed, not paused again
  });

  it("a non-review workflow is unaffected (legacy path)", async () => {
    const { deps: d } = deps(base({ review_required: false, draft_output: null }), ["succeeded"]);
    expect((await reconcileWorkflow("wf-1", d)).to).toBe("completed");
  });
});
