# STAFFD — Ported Cross‑Session Memory

These are the durable, cross‑session context notes for STAFFD, **ported into the repo** (2026‑06‑24)
so the project travels with the code — a session on any machine, or any reviewer, has the full
context without depending on a specific operator's local `~/.claude` memory store.

Each note is a single fact/decision with `name` / `description` frontmatter. Bodies link related
notes with `[[name]]`. These mirror (and are kept in sync with) the operator's live auto‑memory;
the live store may run slightly ahead — treat these as the portable snapshot. Start from
[`../../HANDOFF.md`](../../HANDOFF.md) for the narrative; use these for the underlying decisions.

| Note | Hook |
|---|---|
| [project_staffd.md](project_staffd.md) | The locked product vision: 8+ departments, ~195 agency‑agents, self‑hosted services via the `apps/api` abstraction, pricing, phases. |
| [project_staffd_model_b3.md](project_staffd_model_b3.md) | **Model B3** — customers never connect vendor accounts; invisible operator‑shared backends + upload + conversational‑intent UX. Governs everything W95+. |
| [project_staffd_pricing_generation.md](project_staffd_pricing_generation.md) | Value‑priced, meter‑buried; model quality = plan benefit; swappable model registry; cinematic‑only caps gated at project‑start; the agents‑write‑prompts/muapi‑renders truth; don't mirror the muapi github apps. |
| [project_staffd_roadmap_gaps.md](project_staffd_roadmap_gaps.md) | Full‑stream gap audit + the ratified build priority (publishing disabled, visual‑style learning, #3 stitch, edit‑as‑intent, L4 UI, hardening). |
| [project_staffd_notifications.md](project_staffd_notifications.md) | System→user notifications are first‑class at every tier; built as ONE registry‑driven layer, not per‑feature one‑offs. |
| [project_staffd_l4.md](project_staffd_l4.md) | The "automated team" L4 planner — the execution substrate pre‑existed; the planner is the brain. Tranche 2 (plan intent + UI trigger) remains. |
| [feedback_builder_authority.md](feedback_builder_authority.md) | I'm the architect/builder; external analyses are input to pressure‑test, not commands; I resolve contradictions and make the call. |
| [feedback_improve_existing.md](feedback_improve_existing.md) | Standing authorization to proactively polish working‑but‑generic features — SA is building a "Porsche." |
| [staffd_vercel_footguns.md](staffd_vercel_footguns.md) | `node:fs` in serverless routes + `outputFileTracingRoot` each 500'd all `/api` (passed locally); verify deploys with a live `curl`, not deploy status. |

> Not ported: `project_edge_engine.md` (a separate, unrelated Kalshi trading project).
