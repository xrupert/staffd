---
name: project_staffd_notifications
description: "SA principle — system→user notifications are a first-class capability at every tier; build as ONE registry-driven layer, not per-feature one-offs"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2937f992-0e99-4d3f-ab14-59d1d9a56b02
---

SA holds (ratified 2026-06-21) that **system→user notifications should exist at every tier/level** — a system doing work on someone's behalf owes them a signal. Email is fine as a future *channel*; the *capability* is not optional.

**Agreed architectural direction (my framing, SA aligned):**
- "User" = TWO audiences with shared principle but different plumbing: **customer** notifications (product surface: "video ready", "credits low", "autopilot did X") vs **operator/admin** notifications (ops surface: catalog drift, security drift, failed jobs → the planned `super_admin_signals` path). Never route operator-ops events to customers.
- STAFFD already has SCATTERED pieces: `push_subscriptions` (web-push tokens, registered collection), in-thread "your video is ready", undo toasts, Plausible opt-out. The capability isn't absent — it's unbuilt as a unified thing.
- The risk is **one-off notification paths accreting** (bespoke email here, ad-hoc toast there) = the drift/bloat we keep cleaning up. 
- **Design rule:** when built, it's ONE notifications layer — typed events (`generation.ready`, `credits.low`, `catalog.drift`) routed to **audience × channel** (in-app/thread → web-push → email → operator signal row), each with a **severity/relevance gate** so notifications never become noise (same "don't cry wolf" discipline as the `_`-tables fix and "new models aren't alert-worthy" in [[project_staffd]]). Consistent with STAFFD's registry-driven paradigm (worker-handler / trigger-surface / intent registries).

**Status:** FOUNDATION SHIPPED (W95.8, commit 88fe31a) — the customer in-app slice. `_lib/notifications/events.ts` (typed-event registry), `notifyUser` (best-effort server producer), `notifications` collection (USER_OWNED; operator must run the migration to activate), `NotificationBell` in the dashboard header. Producers wired: `generation.ready` (completeJob), `generation.failed` (failJob, transition-guarded), `credits.low` (spendCredits via pure `crossedLowCredits`, LOW_CREDITS=5, fire-once-on-crossing) — all three customer events live as of W95.8.1 (commit d6a88fc). Channels still to add: **push** (needs VAPID/operator + MX-5 opt-in UI), **email** (→ shared `super_admin_signals`). Operator slice still = catalog-drift `[catalog-drift]` log (W95.7.3d-h3); `super_admin_signals` remains the planned shared operator path. Relates to [[project_staffd_model_b3]].
