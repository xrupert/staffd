---
name: project_staffd_roadmap_gaps
description: "STAFFD product-wide gap audit (2026-06-24) — what's missing across every stream, with the ratified build priority"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2937f992-0e99-4d3f-ab14-59d1d9a56b02
---

Full-stream gap audit done with SA 2026-06-24 ("anything being missed up and down all streams"). ▲=confirmed gap, △=suspected/needs-verify, ✅=solid.

**Acquire/sign-in:** △ Google OAuth may still be broken (test-queue item 8 "doesn't log me in") — verify. △ no referral/virality loop.

**Onboard/seed (cold start):** ✅ captures website-scrape + industry + focus/bottlenecks/situation/superpower → seeds business context (app/onboarding/page.tsx). ▲ NO visual seeding (no logo/brand-colors/reference upload → day-one visuals are generic). ▲ no "what will you use it for most" intent capture (slated for #2, drives upsell aim). △ voice cold-start thin (leans on scrape + slow compounding; no voice-sample seed) — and first-output quality is THE conversion lever.

**Direct/route:** ✅ Command Center→dept→specialist routing, disambiguation. ▲ L4 planner (planner.ts + /api/workflow/plan) has NO UI trigger — the multi-step plan-and-execute flagship is dark to users; progressive autopilot (per-action "automate next time", W95.5) exists but is different. See [[project_staffd_l4]].

**Produce:** ✅ text (voice-aware), ✅ image/video on real models (W95.7.3e veo3-fast + distill enricher). ▲ #3 multi-shot stitch (cinematic not real until clips→finished commercial; muapi video-combiner is the mechanism). ▲ edit-as-intent (no refine loop; future vocab-expansion, no model pickers). ▲ Visual Style learning (visuals don't compound). △ no automated quality gate on generated deliverables.

**Deliver:** ✅ doc library, PDF/Word export, email (Listmonk), e-sign (Docuseal), notifications (W95.8.1). ▲ PUBLISHING DISABLED (PUBLISH_ENABLED=false in DepartmentRoom, "pending platform-publish layer") — STAFFD can MAKE a TikTok but can't POST it; biggest hole in the creator promise (make→publish loop). Built-but-disabled → likely highest value-per-effort.

**Learn/compound:** ✅ voice learning (vault/patterns.ts behavioral signals + recomputeVoiceProfile + getVoiceBlock injection + outcomes Phase 5). ▲ VISUAL STYLE learning — the gap: voice profile = writing tone only; image/video enricher is GENERIC (doesn't even receive the user's voice/style block), so a Starbucks-y vs gritty-trades customer get identical art direction. Fix = getStyleBlock(userId) parallel to getVoiceBlock, learned from kept/regenerated/published visuals + brand assets + edit signals, injected into the enricher. Slot WITH edit-as-intent (edit signals are the training data). △ "while you were away" re-engagement digest may be thin.

**Monetize:** 🔧 #2 allowance engine in progress (see [[project_staffd_pricing_generation]]). △ billing resilience unverified — dunning/failed-payment recovery, upgrade/downgrade proration, explicit trial→paid conversion moment (revenue leaks).

**Operate/trust:** ✅ strong — Groq→Anthropic fallback, fail-without-charge+retry, IDOR sweep (STANDARDS #39), admin health, "system working" visibility. △ mobile/responsive unverified (creator persona is mobile-heavy).

**Ratified build priority:** (1) finish #2 → #3 stitch; (2) PUBLISHING (make→post, built-but-disabled); (3) Visual Style learning + visual cold-start seeding; (4) edit-as-intent; (5) L4 planner UI; (6) hardening pass — verify/fix OAuth, billing resilience, mobile.
