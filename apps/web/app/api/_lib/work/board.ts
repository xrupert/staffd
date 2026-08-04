/**
 * Staff Work Board — pure aggregation of everything the staff is doing
 * into four kanban columns. All PB rows in, columns out; no I/O here so
 * the mapping is unit-testable.
 *
 * Sources:
 *   scheduled_content — calendar work (content, workflow goals, video production)
 *   workflows         — planner-created multi-step work
 *   generation_jobs   — visuals + Studio renders
 */

export type BoardColumn = "planned" | "in_progress" | "review" | "done";

export type BoardCard = {
  id: string;
  source: "scheduled" | "workflow" | "generation";
  title: string;
  subtitle: string;
  /** ISO date used for column ordering (newest first). */
  date: string;
  failed?: boolean;
  /** Optional deep link (finished visual, doc). */
  href?: string;
};

export type Board = Record<BoardColumn, BoardCard[]>;

export type ScheduledRow = {
  id: string; task?: string; department?: string; agent_name?: string;
  scheduled_date?: string; status?: string; kind?: string; created?: string;
};
export type WorkflowRow = {
  id: string; goal?: string; status?: string; created?: string; recipe_id?: string;
};
export type GenJobRow = {
  id: string; kind?: string; prompt?: string; status?: string; created?: string;
  output_url?: string; prediction_id?: string; tier?: string;
};

const DONE_WINDOW_DAYS = 14;
const DONE_CAP = 30;

function firstLine(s: string | undefined, cap = 90): string {
  const line = (s ?? "").split("\n").find((l) => l.trim().length > 0) ?? "";
  const clean = line.replace(/[#*`]/g, "").trim();
  return clean.length > cap ? clean.slice(0, cap) + "…" : clean;
}

const SCHEDULED_KIND_LABEL: Record<string, string> = {
  video_production: "Video production",
  workflow_goal: "Recurring goal",
  content: "Scheduled content",
};

function scheduledColumn(status: string): BoardColumn | null {
  if (status === "planned") return "planned";
  if (status === "working") return "in_progress";
  if (status === "review") return "review";
  if (status === "completed" || status === "failed") return "done";
  return null;
}

function workflowColumn(status: string): BoardColumn | null {
  if (status === "pending" || status === "running") return "in_progress";
  if (status === "awaiting_review") return "review";
  if (status === "completed" || status === "failed" || status === "cancelled") return "done";
  return null;
}

function generationColumn(status: string): BoardColumn | null {
  if (status === "pending") return "in_progress";
  if (status === "completed" || status === "failed") return "done";
  return null;
}

export function bucketize(
  input: { scheduled: ScheduledRow[]; workflows: WorkflowRow[]; jobs: GenJobRow[] },
  nowMs: number = Date.now(),
): Board {
  const board: Board = { planned: [], in_progress: [], review: [], done: [] };
  const doneCutoff = nowMs - DONE_WINDOW_DAYS * 86_400_000;

  const push = (col: BoardColumn, card: BoardCard) => {
    if (col === "done" && new Date(card.date).getTime() < doneCutoff) return;
    board[col].push(card);
  };

  for (const r of input.scheduled) {
    const col = scheduledColumn(r.status ?? "");
    if (!col) continue;
    push(col, {
      id: `sc-${r.id}`,
      source: "scheduled",
      title: firstLine(r.task) || "Scheduled work",
      subtitle: [SCHEDULED_KIND_LABEL[r.kind ?? "content"] ?? "Scheduled content", r.department, r.scheduled_date].filter(Boolean).join(" · "),
      date: r.scheduled_date || r.created || "",
      failed: r.status === "failed" || undefined,
    });
  }

  for (const r of input.workflows) {
    const col = workflowColumn(r.status ?? "");
    if (!col) continue;
    push(col, {
      id: `wf-${r.id}`,
      source: "workflow",
      title: firstLine(r.goal) || "Staff workflow",
      subtitle: r.status === "awaiting_review" ? "Draft waiting on you" : "Multi-step plan",
      date: r.created ?? "",
      failed: r.status === "failed" || undefined,
    });
  }

  for (const r of input.jobs) {
    const col = generationColumn(r.status ?? "");
    if (!col) continue;
    push(col, {
      id: `gj-${r.id}`,
      source: "generation",
      title: firstLine(r.prompt) || `Generated ${r.kind ?? "visual"}`,
      subtitle: [r.kind === "video" ? "Video" : "Image", r.tier].filter(Boolean).join(" · "),
      date: r.created ?? "",
      failed: r.status === "failed" || undefined,
      href: r.status === "completed" && r.output_url ? r.output_url : undefined,
    });
  }

  for (const col of Object.keys(board) as BoardColumn[]) {
    board[col].sort((a, b) => (a.date < b.date ? 1 : -1));
  }
  board.done = board.done.slice(0, DONE_CAP);
  return board;
}
