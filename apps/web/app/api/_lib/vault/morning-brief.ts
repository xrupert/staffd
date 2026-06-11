/**
 * Morning Brief generator (Phase 6).
 *
 * For each active user the nightly worker calls `generateBriefForUser(userId)`
 * which fans out 4–5 small Claude calls across departments and compiles the
 * results into a single `vault_briefs` row keyed by (user, date).
 *
 * Department sections (only generated for unlocked depts):
 *
 *   • ceo         — orchestrator `intent:"synthesize"` over yesterday's
 *                   activity + outcomes (Phase 5 feedback already wired in)
 *   • marketing   — 2–3 next-day social post drafts, voice-fingerprinted
 *   • reputation  — proactive customer check-in / review-reply template
 *   • sales       — follow-up nudges for prospects worth re-engaging
 *   • operations  — deterministic calendar + scheduled-content summary
 *
 * Idempotency: if a brief row already exists for (user, today+1), we skip.
 * That keeps the cron safe to re-run mid-tick and after restarts.
 *
 * Failure model: each section runs under `Promise.allSettled` so one
 * upstream hiccup never blocks the rest. The compiled brief always
 * contains whatever succeeded; failures are logged + omitted.
 */

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";

import { getAgent, getDepartmentDefaultAgent } from "@staffd/agents";
import { adminHeaders, getAdminToken, pbEscape, pbFirst, pbUrl } from "../pb";
import { renderVaultBlock, retrieve, type Vault } from "../vault";
import { getVoiceBlock } from "./voice";
import { fetchRecentDecisions } from "./outcomes";
import { resolveDepartments } from "../trial";
import { bridgingIndustryFor } from "../industry";
import { runOrchestrator } from "../orchestrator";
import { pickModel, callGroq, computeCostUsd } from "../llm-router";
import { sendPushToUser } from "../push";

const anthropic = new Anthropic();

const SECTION_MAX_TOKENS = 1024;
const SECTION_DEADLINE_MS = 25_000;

// ──────────────────────────────────────────────────────────────────────────
// Types — mirror the JSON shape stored in vault_briefs.sections
// ──────────────────────────────────────────────────────────────────────────

export type BriefSectionKind =
  | "synthesis"
  | "draft_post"
  | "review_reply"
  | "sales_followup"
  | "ops_summary";

export type BriefSectionStatus = "pending" | "approved" | "dismissed";

export type BriefSection = {
  id: string;
  department: string;
  kind: BriefSectionKind;
  title: string;
  body: string;
  status: BriefSectionStatus;
  meta?: {
    agentId?: string;
    model?: string;
    costUsd?: number;
    fallback?: boolean;
  };
};

export type BriefRow = {
  id: string;
  user: string;
  date: string;
  sections: BriefSection[];
  status: "pending" | "reviewed" | "dismissed";
  read_at?: string | null;
  generated_at?: string | null;
  created?: string;
  updated?: string;
};

// ──────────────────────────────────────────────────────────────────────────
// Date helpers
// ──────────────────────────────────────────────────────────────────────────

function tomorrowYyyyMmDd(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function pbDateNDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
}

// ──────────────────────────────────────────────────────────────────────────
// Vault fetch — admin-token version (worker has no pbToken)
// ──────────────────────────────────────────────────────────────────────────

async function fetchVaultAdmin(userId: string): Promise<Vault | null> {
  try {
    const token = await getAdminToken();
    return await pbFirst<Vault>(
      "businesses",
      `(user='${pbEscape(userId)}')`,
      token
    );
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Section runner — shared LLM dispatch for non-CEO sections
// ──────────────────────────────────────────────────────────────────────────

type SectionRunInput = {
  userId: string;
  department: string;
  kind: BriefSectionKind;
  title: string;
  query: string;
  topK?: number;
};

async function runSection(input: SectionRunInput): Promise<BriefSection | null> {
  try {
    // W58.2 (D-19 bridging) — vault loads first so its industry can drive
    // pack auto-activation in resolveDepartments (cold path; serialization
    // cost is irrelevant on the nightly run).
    const vault = await fetchVaultAdmin(input.userId);
    const [voiceBlock, trial] = await Promise.all([
      getVoiceBlock(input.userId, input.department),
      resolveDepartments(input.userId, { vaultIndustry: bridgingIndustryFor(vault) }),
    ]);
    const vaultBlock = renderVaultBlock(vault, { detail: "full" });

    // Light retrieval — keep budgets small so the nightly run stays cheap.
    const retrieval = await retrieve(input.userId, input.query, {
      topK: input.topK ?? 5,
      maxTokens: 2_000,
      intent: "agent",
      preferDept: input.department,
    });
    const memoryBlock = retrieval.items.length > 0
      ? `\n\n--- LIVING MEMORY (semantically relevant past work) ---\n${retrieval.items.map((it) => `• [${it.dept ?? "?"}] ${it.text}`).join("\n")}\n--- END LIVING MEMORY ---`
      : "";

    // Phase 8 — pack-aware default agent so a Restaurants-pack user gets the
    // Menu Promoter for their Marketing brief section instead of generic copy.
    const agent = getDepartmentDefaultAgent(input.department, trial.activePacks);
    const system = (agent?.systemPrompt ?? "") + vaultBlock + voiceBlock + memoryBlock;

    const choice = pickModel({ department: input.department, agentId: agent?.id, task: input.query });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SECTION_DEADLINE_MS);
    try {
      let text = "";
      let tokensIn = 0;
      let tokensOut = 0;
      if (choice.provider === "groq") {
        const r = await callGroq(choice.model, system, input.query, SECTION_MAX_TOKENS, ctrl.signal);
        text = r.text;
        tokensIn = r.tokensIn;
        tokensOut = r.tokensOut;
      } else {
        const msg = await anthropic.messages.create(
          {
            model: choice.model,
            max_tokens: SECTION_MAX_TOKENS,
            system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: input.query }],
          },
          { signal: ctrl.signal }
        );
        const block = msg.content[0];
        text = block?.type === "text" ? block.text : "";
        tokensIn = msg.usage?.input_tokens ?? 0;
        tokensOut = msg.usage?.output_tokens ?? 0;
      }
      const cost = computeCostUsd(choice.model, tokensIn, tokensOut);
      console.log(
        `[brief.section] user=${input.userId} dept=${input.department} kind=${input.kind} model=${choice.model} cost_usd=${cost.toFixed(6)}`
      );

      if (!text.trim()) return null;

      return {
        id: randomUUID(),
        department: input.department,
        kind: input.kind,
        title: input.title,
        body: text.trim(),
        status: "pending",
        meta: { agentId: agent?.id, model: choice.model, costUsd: cost },
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(`[brief.section] failed user=${input.userId} dept=${input.department} kind=${input.kind}:`, err);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Per-department section builders
// ──────────────────────────────────────────────────────────────────────────

async function buildCeoSection(userId: string): Promise<BriefSection | null> {
  try {
    const tomorrow = tomorrowYyyyMmDd();
    const resp = await runOrchestrator({
      intent: "synthesize",
      userId,
      pbToken: "", // worker context — handlers use admin where they need it
      context: {
        query: `Synthesize yesterday's activity and the latest outcomes/decisions across every unlocked department, then propose the top 3 strategic priorities for ${tomorrow}. Be specific. Reference real items.`,
        agentId: "ceo-chief-of-staff",
      },
    });
    const text = resp.ok ? (resp.decision.task ?? "").trim() : (resp.degraded.task ?? "").trim();
    if (!text) return null;
    return {
      id: randomUUID(),
      department: "ceo",
      kind: "synthesis",
      title: "Today's priorities — The CEO",
      body: text,
      status: "pending",
      meta: {
        agentId: "ceo-chief-of-staff",
        model: resp.model,
        costUsd: resp.costUsd,
        fallback: !resp.ok,
      },
    };
  } catch (err) {
    console.warn(`[brief.section] ceo failed user=${userId}:`, err);
    return null;
  }
}

async function buildMarketingSection(userId: string): Promise<BriefSection | null> {
  return runSection({
    userId,
    department: "marketing",
    kind: "draft_post",
    title: "Marketing — drafts for tomorrow",
    query:
      "Draft 2–3 short social posts the user can ship tomorrow. Each should match their voice fingerprint, build on what's worked recently (use LIVING MEMORY signals), and be ready-to-post. Number them and label each with a target channel (Instagram, LinkedIn, X, etc.).",
    topK: 5,
  });
}

async function buildReputationSection(userId: string): Promise<BriefSection | null> {
  return runSection({
    userId,
    department: "reputation",
    kind: "review_reply",
    title: "Reputation — proactive customer touch",
    query:
      "Draft one warm, on-voice template reply the user can adapt for a recent positive review OR a customer check-in. Keep it under 80 words. If there's no real review to respond to, write a 'we appreciate you' check-in that fits the user's industry.",
    topK: 3,
  });
}

async function buildSalesSection(userId: string): Promise<BriefSection | null> {
  return runSection({
    userId,
    department: "sales",
    kind: "sales_followup",
    title: "Sales — follow-ups worth making today",
    query:
      "Suggest 2–3 follow-up touches for prospects the user has likely lost momentum with. For each: who the touch is for (use generic anchor like 'last week's discovery call' if no CRM data), what to say in 1–2 sentences, and the channel. Make them feel real and warm — not template-y.",
    topK: 5,
  });
}

async function buildOperationsSection(userId: string): Promise<BriefSection | null> {
  // Deterministic — no LLM call. Pulls bookings + scheduled_content for tomorrow.
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const tomorrow = tomorrowYyyyMmDd();
    const tomorrowStart = `${tomorrow} 00:00:00`;
    const tomorrowEnd = `${tomorrow} 23:59:59`;
    const escaped = pbEscape(userId);

    const [bookingsRes, contentRes] = await Promise.all([
      fetch(
        `${url}/api/collections/bookings/records?filter=${encodeURIComponent(
          `(user='${escaped}' && start_time>='${tomorrowStart}' && start_time<='${tomorrowEnd}' && status='confirmed')`
        )}&sort=start_time&perPage=20&fields=attendee_name,start_time,duration`,
        { headers: { Authorization: token } }
      ).catch(() => null),
      fetch(
        `${url}/api/collections/scheduled_content/records?filter=${encodeURIComponent(
          `(user='${escaped}' && scheduled_date='${tomorrow}' && status='planned')`
        )}&sort=scheduled_date&perPage=20&fields=department,agent_name,task`,
        { headers: { Authorization: token } }
      ).catch(() => null),
    ]);

    const bookings: Array<{ attendee_name: string; start_time: string; duration: number }> = bookingsRes && bookingsRes.ok
      ? ((await bookingsRes.json()) as { items?: Array<{ attendee_name: string; start_time: string; duration: number }> }).items ?? []
      : [];
    const content: Array<{ department: string; agent_name: string; task: string }> = contentRes && contentRes.ok
      ? ((await contentRes.json()) as { items?: Array<{ department: string; agent_name: string; task: string }> }).items ?? []
      : [];

    if (bookings.length === 0 && content.length === 0) return null;

    const bookingLines = bookings.map((b) => {
      const time = new Date(b.start_time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      return `- ${time} · ${b.attendee_name} (${b.duration} min)`;
    });
    const contentLines = content.map((c) => `- ${c.department} · ${c.agent_name}: ${c.task.slice(0, 100)}`);

    const body = [
      bookings.length > 0 ? `**Tomorrow's calendar (${bookings.length}):**\n${bookingLines.join("\n")}` : "",
      content.length > 0 ? `**Scheduled content (${content.length}):**\n${contentLines.join("\n")}` : "",
    ].filter(Boolean).join("\n\n");

    return {
      id: randomUUID(),
      department: "operations",
      kind: "ops_summary",
      title: "Operations — what tomorrow looks like",
      body,
      status: "pending",
      meta: { agentId: "operations-sop-writer" },
    };
  } catch (err) {
    console.warn(`[brief.section] ops failed user=${userId}:`, err);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Brief upsert
// ──────────────────────────────────────────────────────────────────────────

async function upsertBrief(
  userId: string,
  date: string,
  sections: BriefSection[]
): Promise<BriefRow | null> {
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const headers = adminHeaders(token);
    const generatedAt = new Date().toISOString();

    const existing = await pbFirst<{ id: string }>(
      "vault_briefs",
      `(user='${pbEscape(userId)}' && date='${date}')`,
      token,
      { fields: "id" }
    );

    const body = JSON.stringify({
      user: userId,
      date,
      sections,
      status: "pending",
      generated_at: generatedAt,
    });

    if (existing) {
      const res = await fetch(`${url}/api/collections/vault_briefs/records/${existing.id}`, {
        method: "PATCH",
        headers,
        body,
      });
      if (!res.ok) return null;
      return (await res.json()) as BriefRow;
    }

    const res = await fetch(`${url}/api/collections/vault_briefs/records`, {
      method: "POST",
      headers,
      body,
    });
    if (!res.ok) return null;
    return (await res.json()) as BriefRow;
  } catch (err) {
    console.warn(`[brief.upsert] failed user=${userId}:`, err);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Public surface
// ──────────────────────────────────────────────────────────────────────────

export type GenerateBriefResult = {
  ok: boolean;
  userId: string;
  date: string;
  skipped?: boolean;
  reason?: string;
  sectionCount?: number;
  briefId?: string;
};

export async function generateBriefForUser(userId: string, opts?: { force?: boolean }): Promise<GenerateBriefResult> {
  if (!userId) return { ok: false, userId: "", date: "", reason: "missing_user_id" };
  const date = tomorrowYyyyMmDd();

  // Phase 9 — autopilot gate. Skip users who have autonomy disabled or who
  // have snoozed the brief. `opts.force` bypasses (manual API test path).
  if (!opts?.force) {
    try {
      const token = await getAdminToken();
      const sub = await pbFirst<{ autopilot_mode?: string | null; autopilot_paused_until?: string | null }>(
        "subscriptions",
        `(user='${pbEscape(userId)}')`,
        token,
        { fields: "autopilot_mode,autopilot_paused_until" }
      );
      if (sub?.autopilot_mode === "off") {
        return { ok: true, userId, date, skipped: true, reason: "autopilot_off" };
      }
      if (sub?.autopilot_paused_until) {
        const until = new Date(sub.autopilot_paused_until).getTime();
        if (!Number.isNaN(until) && until > Date.now()) {
          return { ok: true, userId, date, skipped: true, reason: "autopilot_paused" };
        }
      }
    } catch { /* proceed on lookup failure — fail open */ }

    // Phase 26 — brief snooze + "skip tomorrow" gates. Same fail-open rule.
    try {
      const token = await getAdminToken();
      const url = pbUrl();
      const sub = await pbFirst<{ id: string; brief_snoozed_until?: string | null; skip_next_brief?: boolean | null }>(
        "subscriptions",
        `(user='${pbEscape(userId)}')`,
        token,
        { fields: "id,brief_snoozed_until,skip_next_brief" }
      );
      if (sub?.brief_snoozed_until) {
        const until = new Date(sub.brief_snoozed_until).getTime();
        if (!Number.isNaN(until) && until > Date.now()) {
          return { ok: true, userId, date, skipped: true, reason: "brief_snoozed" };
        }
      }
      if (sub?.skip_next_brief) {
        // Consume the flag — subsequent days run normally.
        try {
          await fetch(`${url}/api/collections/subscriptions/records/${sub.id}`, {
            method: "PATCH",
            headers: adminHeaders(token),
            body: JSON.stringify({ skip_next_brief: false }),
          });
        } catch { /* best-effort */ }
        return { ok: true, userId, date, skipped: true, reason: "skip_next_brief" };
      }
    } catch { /* fail open */ }
  }

  // Idempotency — skip if a brief for this user+date already exists.
  if (!opts?.force) {
    try {
      const token = await getAdminToken();
      const existing = await pbFirst<{ id: string }>(
        "vault_briefs",
        `(user='${pbEscape(userId)}' && date='${date}')`,
        token,
        { fields: "id" }
      );
      if (existing) {
        return { ok: true, userId, date, skipped: true, reason: "already_exists", briefId: existing.id };
      }
    } catch { /* proceed on lookup failure */ }
  }

  // W58.2 (D-19 bridging) — this site only consumes `resolved` (dept
  // gating, pack-independent), but bridging keeps trial state uniform
  // across all callers. Vault is loaded again per-section in runSection.
  const briefVault = await fetchVaultAdmin(userId);
  const trial = await resolveDepartments(userId, { vaultIndustry: bridgingIndustryFor(briefVault) });
  const unlocked = new Set(trial.resolved);

  const tasks: Array<Promise<BriefSection | null>> = [];
  if (unlocked.has("ceo"))        tasks.push(buildCeoSection(userId));
  if (unlocked.has("marketing"))  tasks.push(buildMarketingSection(userId));
  if (unlocked.has("reputation")) tasks.push(buildReputationSection(userId));
  if (unlocked.has("sales"))      tasks.push(buildSalesSection(userId));
  if (unlocked.has("operations")) tasks.push(buildOperationsSection(userId));

  const settled = await Promise.allSettled(tasks);
  const sections: BriefSection[] = settled
    .filter((r): r is PromiseFulfilledResult<BriefSection | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((s): s is BriefSection => s !== null);

  if (sections.length === 0) {
    return { ok: false, userId, date, reason: "no_sections_generated" };
  }

  const row = await upsertBrief(userId, date, sections);

  // Phase 7 + Phase 26 — push the "Brief ready" notification, BUT only if
  // the user hasn't configured a preferred delivery time. When they have,
  // the brief-push-dispatcher takes over — pushing at the right local hour,
  // respecting quiet hours, and stamping pushed_at on success.
  if (row) {
    void (async () => {
      try {
        const token = await getAdminToken();
        const hasPrefs = await pbFirst<{ timezone?: string | null; preferred_delivery_hour?: number | null }>(
          "subscriptions",
          `(user='${pbEscape(userId)}')`,
          token,
          { fields: "timezone,preferred_delivery_hour" }
        );
        const deferToDispatcher =
          !!hasPrefs?.timezone &&
          typeof hasPrefs.preferred_delivery_hour === "number";
        if (deferToDispatcher) {
          console.log(`[brief.push] user=${userId} deferred to dispatcher (prefs configured)`);
          return;
        }

        const r = await sendPushToUser(userId, {
          title: "Your Morning Brief is ready",
          body: `${sections.length} update${sections.length === 1 ? "" : "s"} from your staff. Tap to review.`,
          url: "/dashboard",
          tag: `brief-${date}`,
        });
        if (!r.skipped) {
          console.log(`[brief.push] user=${userId} sent=${r.sent} pruned=${r.pruned} failed=${r.failed}`);
        }
        // Mark pushed_at so the dispatcher doesn't double-deliver if prefs
        // are later configured before the brief is reviewed.
        if (!r.skipped && r.sent > 0) {
          const url = pbUrl();
          try {
            await fetch(`${url}/api/collections/vault_briefs/records/${row.id}`, {
              method: "PATCH",
              headers: adminHeaders(token),
              body: JSON.stringify({ pushed_at: new Date().toISOString() }),
            });
          } catch { /* best-effort */ }
        }
      } catch { /* fire-and-forget */ }
    })();
  }

  return { ok: true, userId, date, sectionCount: sections.length, briefId: row?.id };
}

/**
 * Cron entry point — fan out across all users active in the last `daysActive` days.
 *
 * Concurrency bounded so memory + upstream rate limits stay safe at SMB
 * scale. At ~3 users in flight × ~10s per user, 50 users completes in ~3
 * minutes. Larger fleets should be paginated across multiple cron ticks.
 */
export async function generateBriefsForActiveUsers(
  daysActive = 7,
  concurrency = 3
): Promise<{ scanned: number; ok: number; skipped: number; failed: number }> {
  const tally = { scanned: 0, ok: 0, skipped: 0, failed: 0 };
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const since = pbDateNDaysAgo(daysActive);
    const res = await fetch(
      `${url}/api/collections/documents/records?filter=${encodeURIComponent(`(created>='${since}')`)}&perPage=500&fields=user&sort=-created`,
      { headers: { Authorization: token } }
    );
    if (!res.ok) return tally;
    const data = (await res.json()) as { items?: Array<{ user: string }> };
    const userIds = Array.from(new Set((data.items ?? []).map((d) => d.user).filter(Boolean)));
    tally.scanned = userIds.length;

    // Bounded concurrency runner (mirrors the V4a worker's pattern).
    let nextIndex = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, userIds.length) }, async () => {
        while (true) {
          const i = nextIndex++;
          if (i >= userIds.length) return;
          const u = userIds[i]!;
          try {
            const r = await generateBriefForUser(u);
            if (r.ok) {
              if (r.skipped) tally.skipped++;
              else tally.ok++;
            } else {
              tally.failed++;
            }
          } catch {
            tally.failed++;
          }
        }
      })
    );
  } catch (err) {
    console.warn("[brief.runner] fan-out failed:", err);
  }
  return tally;
}

// Marker import to satisfy unused-imports lint when only types are used.
void fetchRecentDecisions;
void getAgent;
