"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import pb from "../../lib/pb";
import ThreadPickerDrawer, { type HydratedMessage } from "./ThreadPickerDrawer";
import CommandCenterSuggestions from "./CommandCenterSuggestions";
import ActionAffordances from "./ActionAffordances";
import { anchorTopIfBelowViewport } from "../../lib/scroll";
import { useActionDispatcher } from "../../lib/hooks/useActionDispatcher";
import { runExportDocument } from "../../lib/action-handlers/export-document";
import ScheduleFollowupModal from "./ScheduleFollowupModal";
import VoiceInput from "./VoiceInput";
import ActionRecipientModal, { type RecipientKind } from "./ActionRecipientModal";
import ConfirmActionModal, { type IntentResult } from "./ConfirmActionModal";
import UndoToast from "./UndoToast";
import type { ActionCandidate } from "../api/_lib/orchestrator/action-vocabulary";

interface Message {
  role: "user" | "assistant";
  content: string;
  isOutput?: boolean;
  lockedAlternative?: string;
}


// PR-Tranche-2.6 (W28) — handoff intent response shape (subset; matches
// FollowUp in apps/web/app/api/_lib/orchestrator/types.ts).
interface HandoffSuggestion {
  department: string;
  task: string;
  rationale?: string;
  locked?: boolean;
}

type Phase = "idle" | "routing" | "confirmed" | "generating" | "done";

const DEPT_LABELS: Record<string, string> = {
  marketing: "Marketing", sales: "Sales", legal: "Legal", hr: "HR",
  finance: "Finance", operations: "Operations", design: "Design",
  "paid-media": "Paid Media", reputation: "Reputation", ceo: "The CEO",
};

const DEPT_HREFS: Record<string, string> = {
  marketing: "/dashboard/marketing", sales: "/dashboard/sales",
  legal: "/dashboard/legal", hr: "/dashboard/hr",
  finance: "/dashboard/finance", operations: "/dashboard/operations",
  design: "/dashboard/design", "paid-media": "/dashboard/paid-media",
  reputation: "/dashboard/reputation", ceo: "/dashboard/ceo",
};

const THREAD_STORAGE_KEY = "staffd_command_center_thread_id_v1";

/**
 * PR-Tranche-2.5 (W26 fix) — strip orchestrator-protocol markers from
 * assistant messages before sending the conversation back to the
 * orchestrator on follow-up turns. The `READY:{...}` and `EXECUTE:{...}`
 * lines are UI-side protocol; the orchestrator should see clean
 * conversation context only. Exported for tests.
 */
export function cleanForOrchestrator(content: string): string {
  if (!content) return "";
  return content
    .replace(/\nREADY:\{.+?\}/gs, "")
    .replace(/READY:\{.+?\}/gs, "")
    .replace(/^EXECUTE:\{.+?\}\s*$/gs, "")
    .trim();
}

/**
 * T1-3 (W70.2 fix) — condense the conversation history fed to the ROUTING
 * LLM so it routes the latest user request on its own merits.
 *
 * Root cause of the W70.2 regression: follow-up turns replayed two things
 * that anchored the cheap Haiku router to the PREVIOUS department —
 *   1. coordinator routing-transparency stubs ("Marketing → Content Creator
 *      is on it…"), which read as an explicit "active department" signal, and
 *   2. full prior deliverables (600+ words) that dominated the 512-token
 *      context window.
 * Result: turns 2/3 mis-routed back to the established department.
 *
 * This condenser, applied only to the /api/orchestrate round-trip:
 *   • keeps USER messages verbatim (the real routing signal),
 *   • drops non-deliverable assistant messages (coordinator/status stubs are
 *     UI protocol, the same class as READY/EXECUTE which we already strip),
 *   • keeps deliverable (isOutput) assistant messages but truncates them to a
 *     short excerpt so they provide light context without dominating,
 *   • strips any READY/EXECUTE markers from retained content, and
 *   • filters out anything that becomes empty after cleaning.
 *
 * Exported for tests.
 */
export function condenseForOrchestrator(
  messages: Array<{ role: "user" | "assistant"; content: string; isOutput?: boolean }>,
  opts?: { excerptChars?: number },
): Array<{ role: "user" | "assistant"; content: string }> {
  const excerptChars = opts?.excerptChars ?? 240;
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const m of messages) {
    if (m.role === "user") {
      const content = (m.content ?? "").trim();
      if (content) out.push({ role: "user", content });
      continue;
    }
    // Assistant. Coordinator/status stubs (not isOutput) are UI affordances —
    // drop them entirely so they can't anchor the router.
    if (!m.isOutput) continue;

    const cleaned = cleanForOrchestrator(m.content);
    if (!cleaned) continue;
    const excerpt =
      cleaned.length > excerptChars ? cleaned.slice(0, excerptChars) + "…" : cleaned;
    out.push({ role: "assistant", content: excerpt });
  }

  return out;
}

/**
 * PR-Tranche-2.6.5 (W38 + W39) — detect whether an agent's response ends
 * in a clarifying question (vs. a completed deliverable).
 *
 * Used to:
 *   - W38: skip the handoff intent fetch when the agent is waiting on the
 *     user (handoff suggestions are nonsense if the work isn't done yet)
 *   - W39: switch the input placeholder to "Type your reply…" and
 *     auto-focus the textarea so the user can answer immediately
 *
 * Predicate (intentionally simple, no over-engineering):
 *   - Trailing `?` after trim → question
 *   - Common interrogative phrasings in the last 200 chars → question
 *
 * The 200-char window catches "Which platform are you targeting?" near
 * the end of a multi-paragraph response without false-positiving on
 * questions inside the body (rhetorical questions, etc.).
 */
export function isAgentAskingQuestion(text: string): boolean {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return false;
  if (trimmed.endsWith("?")) return true;
  const tail = trimmed.slice(-200);
  const phrasings = /\b(which|what|how|would you|can you|should (we|i|you)|do you|are you|did you|where|when|why|tell me|let me know|share with me)\b/i;
  return phrasings.test(tail);
}

/**
 * Gate for fetching post-generation action affordances.
 *
 * Specialists frequently finish a deliverable and then OFFER to do more
 * ("…want me to build the full sequence?"). That trailing question must NOT
 * suppress the affordances — the work IS done.
 *
 * The gate is only a cost optimization: the W62 analyzer already returns no
 * candidates for a non-deliverable, so the worst case of fetching too eagerly
 * is one wasted call (→ no buttons anyway). So we only short-circuit the
 * clearly-pointless case: a SHORT response that is essentially just a
 * clarifying question. Anything substantial goes to the analyzer, which is the
 * real filter. Exported for tests.
 */
const DELIVERABLE_MIN_CHARS = 400;
export function shouldFetchAffordances(output: string): boolean {
  const text = (output ?? "").trim();
  if (text.length <= 50) return false;
  if (text.length >= DELIVERABLE_MIN_CHARS) return true;
  return !isAgentAskingQuestion(text);
}

function loadOrCreateThreadId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(THREAD_STORAGE_KEY);
    if (existing) return existing;
    const fresh = (window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    window.localStorage.setItem(THREAD_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export default function CommandCenter() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [outputBuffer, setOutputBuffer] = useState("");
  const [lastLockedAlt, setLastLockedAlt] = useState<string | null>(null);
  // Phase 9 — persistent conversation thread. Survives reloads via localStorage
  // so /api/agent + /api/orchestrate can stitch turns together server-side.
  const [threadId, setThreadId] = useState<string>("");
  // Phase 25 — thread picker drawer.
  const [threadPickerOpen, setThreadPickerOpen] = useState(false);
  // PR-Tranche-2.6 (W28) — cross-functional handoff suggestions surfaced
  // below the generated output. Fetched fire-and-forget after each
  // generation completes; non-blocking on failure.
  const [followUps, setFollowUps] = useState<HandoffSuggestion[]>([]);
  // W63 — the platform-action axis from the same handoff response.
  const [actionCandidates, setActionCandidates] = useState<ActionCandidate[]>([]);
  // Holds the last completed user task + department for downstream handoff
  // requests (the prior task is what `/api/handoff/suggest` uses as
  // sourceDoc.prompt).
  const [lastCompleted, setLastCompleted] = useState<{
    department: string;
    task: string;
    output: string;
    userGoal: string;
  } | null>(null);
  // W68 — anchors the TOP of the newest response into view (once, at
  // generation start, only when it's below the viewport). After that,
  // scroll position belongs to the user — no auto-follow anywhere.
  const responseStartRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // W69 — cancel in-flight agent fetch.
  const abortRef = useRef<AbortController | null>(null);
  // W64 B2 (D13) — shared schedule_followup modal state.
  const [followupOpen, setFollowupOpen] = useState(false);
  const [followupSeed, setFollowupSeed] = useState("");
  // FC-2b — recipient modal for the two integration actions that need an
  // email (Chatwoot ticket / Docuseal signature).
  const [recipientModal, setRecipientModal] = useState<{ kind: RecipientKind } | null>(null);
  const [recipientBusy, setRecipientBusy] = useState(false);
  // W95.1 (Model B3) — conversational intent → confirm-to-commit. Runs
  // alongside the normal routing flow; a parsed intent surfaces this modal.
  const [pendingIntents, setPendingIntents] = useState<IntentResult[]>([]);
  const [graduationOffer, setGraduationOffer] = useState(false);
  const [intentBusy, setIntentBusy] = useState(false);
  const [undoToast, setUndoToast] = useState<{ auditRowId: string; message: string } | null>(null);

  function successCopy(type: string, f: Record<string, string>, data: { expected_completion_message?: string }): string {
    const done: Record<string, string> = {
      create_contact: `Added ${f.name} to your contacts.`,
      log_interaction: `Logged your ${f.interaction_type || "interaction"} with ${f.contact_name}.`,
      schedule_followup: `Set a follow-up with ${f.contact_name}${f.due_date ? ` for ${f.due_date}` : ""}.`,
      add_to_email_list: `Added ${f.email} to your email list.`,
      create_task: `Added "${f.title}" to your tasks.`,
      capture_lead: `Captured ${f.name}${f.company ? ` at ${f.company}` : ""} as a lead.`,
      update_contact: `Updated ${f.contact_identifier}.`,
      log_expense: `Logged ${f.currency || "$"}${f.amount}${f.category ? ` for ${f.category}` : ""}.`,
    };
    return data.expected_completion_message ?? done[type] ?? "Done — your staff have it.";
  }

  // Detection runs alongside the normal chat flow. The server tells us whether
  // to auto-fire (autopilot enabled), offer graduation, or just show the modal
  // (incl. the two-option chooser). Ambiguity never auto-fires.
  async function detectIntent(message: string) {
    try {
      const res = await fetch("/api/intent/extract", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { intents: IntentResult[]; autofire?: boolean; graduationOffer?: boolean };
      if (!data.intents?.length) return;
      if (data.autofire) { void commitIntent(data.intents[0]!.type, data.intents[0]!.fields, "autopilot", false); return; }
      setGraduationOffer(!!data.graduationOffer);
      setPendingIntents(data.intents);
    } catch { /* non-blocking — chat continues regardless */ }
  }

  async function commitIntent(type: string, fields: Record<string, string>, source: string, edited: boolean) {
    setIntentBusy(true);
    try {
      const res = await fetch("/api/intent/commit", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ intent_type: type, fields, source, edited }),
      });
      const ok = res.ok;
      const data = ok ? ((await res.json().catch(() => ({}))) as { expected_completion_message?: string; audit_row_id?: string }) : {};
      const msg = ok ? successCopy(type, fields, data) : "Couldn't save that just now — give it another try.";
      setPendingIntents([]); setGraduationOffer(false);
      if (source === "autopilot" && ok && data.audit_row_id) {
        // Silent fire — the toast IS the notification (with Undo).
        setUndoToast({ auditRowId: data.audit_row_id, message: msg });
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: msg }]);
      }
    } catch {
      setPendingIntents([]); setGraduationOffer(false);
      setMessages((prev) => [...prev, { role: "assistant", content: "Couldn't save that just now — give it another try." }]);
    } finally {
      setIntentBusy(false);
    }
  }

  // Modal Confirm / disambiguation pick. `edited` only meaningful for the
  // single-option case where the chosen type matches what we parsed.
  function handleConfirm(type: string, fields: Record<string, string>) {
    const original = pendingIntents[0];
    const edited = !!original && pendingIntents.length === 1 && type === original.type && JSON.stringify(fields) !== JSON.stringify(original.fields);
    void commitIntent(type, fields, "text", edited);
  }

  async function handleGraduate(choice: "yes" | "not_yet" | "just_once", type: string, fields: Record<string, string>) {
    if (choice === "yes") await fetch("/api/autopilot/enable", { method: "POST", headers: { "Content-Type": "application/json", Authorization: pb.authStore.token }, body: JSON.stringify({ intent_type: type }) }).catch(() => {});
    if (choice === "not_yet") await fetch("/api/autopilot/decline", { method: "POST", headers: { "Content-Type": "application/json", Authorization: pb.authStore.token }, body: JSON.stringify({ intent_type: type }) }).catch(() => {});
    void commitIntent(type, fields, "text", false);
  }

  function cancelIntent() {
    if (intentBusy) return;
    const t = pendingIntents[0];
    if (t && pendingIntents.length === 1) {
      void fetch("/api/autopilot/cancel", { method: "POST", headers: { "Content-Type": "application/json", Authorization: pb.authStore.token }, body: JSON.stringify({ intent_type: t.type }) }).catch(() => {});
    }
    setPendingIntents([]); setGraduationOffer(false);
  }

  useEffect(() => {
    setThreadId(loadOrCreateThreadId());
  }, []);

  // W80.1 — a Front Desk card chip can deep-link here with ?ask=<prompt> to seed
  // the input (surface→specialist). We pre-fill (not auto-send) so the user
  // reviews first, then the existing orchestrator routes it. URL is cleaned
  // so a refresh doesn't re-seed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ask = new URLSearchParams(window.location.search).get("ask");
    if (ask) {
      setInput(ask);
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, []);

  // W64 B1 (SA D3′) — wire W63's chips to real actions on this surface.
  // Export uses the shared docx path with clipboard fallback; failures
  // surface as a plain assistant message in the thread (Decision 6).
  // image/video (inline-media render) + schedule + draft_email land in B2.
  useActionDispatcher({
    export_document: () => {
      const content = lastCompleted?.output ?? "";
      void runExportDocument(content, undefined, (msg) =>
        setMessages((prev) => [...prev, { role: "assistant", content: msg }])
      );
    },
    // W64 B2 (D12) — media generates via the same muapi route DeptRoom
    // uses (credit gates ride along) and renders inline in the thread.
    generate_image: () => { void generateInlineMedia("image"); },
    generate_video: () => { void generateInlineMedia("video"); },
    // W64 B2 (D13) — shared planned-follow-up modal.
    schedule_followup: (candidate) => {
      const suggested = typeof candidate.params?.task === "string" ? candidate.params.task : "";
      setFollowupSeed(
        suggested.trim() ||
          `Follow up on this work and produce the next step:\n\n${(lastCompleted?.task ?? lastCompleted?.output ?? "").slice(0, 400)}`
      );
      setFollowupOpen(true);
    },
    // W64 B2 — W35 one-click: user's chip click IS the consent, so the
    // direct-execute path (skipConfirm + preselect) routes straight to the
    // Email Marketer with the completed work as context.
    draft_email: () => {
      const sourceOutput = lastCompleted?.output ?? "";
      if (!sourceOutput.trim()) {
        console.warn("[W64] draft_email with no completed output — noop");
        return;
      }
      const preview = sourceOutput.length > 1200 ? sourceOutput.slice(0, 1200) + "…" : sourceOutput;
      void send(
        `Draft the email announcing this work to our audience:\n\n---\n${preview}\n---`,
        { skipConfirm: true, preselectDept: "marketing", preselectAgent: "marketing-email-marketer" }
      );
    },
    // FC-2 (SA-authorized) — integration platform actions. Fire to the
    // connected write routes (Twenty / Listmonk); the result surfaces as a
    // thread message with a deep link. No recipient input needed: CRM gets
    // an opportunity derived from the task, Listmonk gets a reviewable draft.
    send_to_crm: () => { void sendToCrm(); },
    send_email_campaign: () => { void sendEmailCampaign(); },
    // FC-2b — these need a recipient email, so they open the modal first.
    open_support_ticket: () => {
      if (!(lastCompleted?.output ?? "").trim()) { console.warn("[FC-2] open_support_ticket with no output — noop"); return; }
      setRecipientModal({ kind: "support" });
    },
    send_for_signature: () => {
      if (!(lastCompleted?.output ?? "").trim()) { console.warn("[FC-2] send_for_signature with no output — noop"); return; }
      setRecipientModal({ kind: "signature" });
    },
  });

  // FC-2 — push a finished artifact to Twenty as an opportunity. Name is
  // derived from the task; the output rides along as notes. Result (or a
  // friendly failure) lands in the thread.
  async function sendToCrm() {
    const output = lastCompleted?.output ?? "";
    const task = lastCompleted?.task ?? "";
    if (!output.trim()) { console.warn("[FC-2] send_to_crm with no completed output — noop"); return; }
    const name = task.trim().slice(0, 80) || "New opportunity from STAFFD";
    setMessages((prev) => [...prev, { role: "assistant", content: "Adding this to your CRM…" }]);
    try {
      const res = await fetch("/api/integrations/twenty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "opportunity", name, notes: output.slice(0, 1000), userId: pb.authStore.record?.id }),
      });
      const data = (await res.json()) as { success?: boolean; crmUrl?: string; message?: string; error?: string };
      if (!res.ok || !data.success) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.message ?? data.error ?? "Couldn't add to your CRM — try again." }]);
        return;
      }
      const link = data.crmUrl ? ` [View in CRM](${data.crmUrl})` : "";
      setMessages((prev) => [...prev, { role: "assistant", content: `Added to your CRM as an opportunity.${link}` }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Couldn't reach the CRM: ${err instanceof Error ? err.message : String(err)}` }]);
    }
  }

  // FC-2 — turn a finished artifact into a Listmonk draft campaign (subject
  // from the task, body from the output). Always a DRAFT — the user reviews
  // + sends from Listmonk, so this is safe to fire on a click.
  async function sendEmailCampaign() {
    const output = lastCompleted?.output ?? "";
    const task = lastCompleted?.task ?? "";
    if (!output.trim()) { console.warn("[FC-2] send_email_campaign with no completed output — noop"); return; }
    const subject = task.trim().slice(0, 120) || "New campaign from STAFFD";
    setMessages((prev) => [...prev, { role: "assistant", content: "Creating an email campaign draft…" }]);
    try {
      const res = await fetch("/api/integrations/listmonk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body: output, userId: pb.authStore.record?.id }),
      });
      const data = (await res.json()) as { success?: boolean; campaignUrl?: string; message?: string; error?: string };
      if (!res.ok || !data.success) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.message ?? data.error ?? "Couldn't create the campaign — try again." }]);
        return;
      }
      const link = data.campaignUrl ? ` [Review the draft](${data.campaignUrl})` : "";
      setMessages((prev) => [...prev, { role: "assistant", content: `Created a draft campaign for your review.${link}` }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Couldn't reach email: ${err instanceof Error ? err.message : String(err)}` }]);
    }
  }

  // FC-2b — the recipient modal collected an email; fire the Chatwoot or
  // Docuseal write and surface the result (or a friendly failure).
  async function submitRecipientAction(recipient: { name: string; email: string }) {
    const modal = recipientModal;
    if (!modal) return;
    const output = lastCompleted?.output ?? "";
    const task = lastCompleted?.task ?? "";
    if (!output.trim()) { setRecipientModal(null); return; }
    setRecipientBusy(true);
    try {
      if (modal.kind === "support") {
        const res = await fetch("/api/integrations/chatwoot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName: recipient.name || "Customer",
            customerEmail: recipient.email,
            subject: task.slice(0, 120),
            reply: output,
            userId: pb.authStore.record?.id,
          }),
        });
        const data = (await res.json()) as { success?: boolean; conversationUrl?: string; message?: string; error?: string };
        if (!res.ok || !data.success) {
          setMessages((prev) => [...prev, { role: "assistant", content: data.message ?? data.error ?? "Couldn't open the support ticket — try again." }]);
        } else {
          const link = data.conversationUrl ? ` [Open the conversation](${data.conversationUrl})` : "";
          setMessages((prev) => [...prev, { role: "assistant", content: `Opened a support ticket with this reply.${link}` }]);
        }
      } else {
        const res = await fetch("/api/integrations/docuseal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: task.slice(0, 120) || "Document for signature",
            documentContent: output,
            signerEmail: recipient.email,
            signerName: recipient.name,
            userId: pb.authStore.record?.id,
          }),
        });
        const data = (await res.json()) as { success?: boolean; signingUrl?: string; message?: string; error?: string };
        if (!res.ok || !data.success) {
          setMessages((prev) => [...prev, { role: "assistant", content: data.message ?? data.error ?? "Couldn't send for signature — try again." }]);
        } else {
          const link = data.signingUrl ? ` [Signing link](${data.signingUrl})` : "";
          setMessages((prev) => [...prev, { role: "assistant", content: `Sent to ${recipient.email} for signature.${link}` }]);
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Couldn't reach the service: ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setRecipientBusy(false);
      setRecipientModal(null);
    }
  }

  // W64 B2 (D12) — inline media generation for the Command Center thread.
  // Same /api/integrations/muapi contract as DeptRoom (503 unconfigured,
  // 402 out of credits, else {url}); result lands as markdown in an
  // assistant message so ReactMarkdown renders the image inline.
  async function generateInlineMedia(kind: "image" | "video") {
    const prompt = lastCompleted?.output ?? "";
    if (!prompt.trim()) {
      console.warn(`[W64] generate_${kind} with no completed output — noop`);
      return;
    }
    const userId = pb.authStore.record?.id ?? "";
    if (!userId) return;
    const label = kind === "image" ? "visual" : "video";
    setMessages((prev) => [...prev, { role: "assistant", content: `Generating the ${label} — one moment…` }]);
    try {
      const res = await fetch("/api/integrations/muapi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, kind, prompt, aspectRatio: "16:9" }),
      });
      const data = (await res.json()) as { url?: string; message?: string; error?: string; detail?: string };
      if (!res.ok || !data.url) {
        const reason = data.message ?? data.detail ?? data.error ?? `Couldn't generate the ${label} — try again.`;
        setMessages((prev) => [...prev, { role: "assistant", content: reason }]);
        return;
      }
      const media = kind === "image"
        ? `![Generated visual](${data.url})`
        : `Your video is ready: [▶ Watch it here](${data.url})`;
      setMessages((prev) => [...prev, { role: "assistant", content: media }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: `Couldn't reach the generation service: ${err instanceof Error ? err.message : String(err)}`,
      }]);
    }
  }

  // PR-Tranche-2.6.5 (W39) — derived state: is the agent's most recent
  // assistant message a clarifying question? Drives placeholder switch +
  // auto-focus below. `useMemo` would be overkill — the messages array
  // doesn't churn fast enough to matter.
  const lastAgentMessage = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (m.role === "assistant" && m.content) return cleanContent(m.content);
    }
    return "";
  })();
  const agentAwaitingReply = phase === "done" && isAgentAskingQuestion(lastAgentMessage);

  // PR-Tranche-2.6.5 (W39) — auto-focus the textarea when the agent finishes
  // by asking a question. Reduces friction: user doesn't have to click into
  // the input to answer.
  useEffect(() => {
    if (agentAwaitingReply) {
      inputRef.current?.focus();
    }
  }, [agentAwaitingReply]);

  // Phase 25 — switch to an existing thread (hydrates message history).
  function switchToThread(newThreadId: string, hydrated: HydratedMessage[]) {
    setThreadId(newThreadId);
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(THREAD_STORAGE_KEY, newThreadId); } catch { /* silent */ }
    }
    setMessages(hydrated.map((m) => ({ role: m.role, content: m.content })));
    setOutputBuffer("");
    setLastLockedAlt(null);
    setPhase("idle");
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function anchorNewResponse() {
    // setTimeout lets React commit the new response element first.
    setTimeout(() => anchorTopIfBelowViewport(responseStartRef.current), 50);
  }

  /**
   * PR-Tranche-2.6.4 (W35) — `send()` options.
   * `skipConfirm` + `preselectDept` together short-circuit the orchestrate
   * round-trip AND the Yes/Cancel confirm gate. Used by Next Steps button
   * clicks where the followUp already knows the target department, so the
   * user's click IS explicit consent — no second-step confirm needed.
   * `preselectAgent` is optional (handoff intent doesn't currently emit
   * agentId; runAgent's existing smart-keyword picker fills in).
   */
  type SendOptions = {
    skipConfirm?: boolean;
    preselectDept?: string;
    preselectAgent?: string;
  };

  async function send(text?: string, options?: SendOptions) {
    const content = (text ?? input).trim();
    if (!content || phase === "routing" || phase === "generating") return;

    // PR-Tranche-2.5 (W26 fix) — auto-transition done → idle so the input
    // stays alive for follow-ups. Was previously trapped at "done" until
    // the user clicked the destructive "+ New request" reset.
    if (phase === "done") setPhase("idle");

    const newMessages: Message[] = [...messages, { role: "user", content }];
    setMessages(newMessages);
    setInput("");
    setPhase("routing");

    // W95.1 — detect a confirm-to-commit intent in parallel (non-blocking).
    void detectIntent(content);

    const userId = pb.authStore.record?.id ?? "";
    const pbToken = pb.authStore.token;

    // PR-Tranche-2.6.4 (W35) — direct-execute path. Bypasses orchestrate
    // round-trip AND confirm gate when caller already knows the target
    // dept (Next Steps button click). User's click IS the explicit consent.
    if (options?.skipConfirm && options?.preselectDept) {
      setPhase("generating");
      await runAgent(options.preselectDept, content, userId, pbToken, options.preselectAgent);
      return;
    }

    // Route through orchestrator
    try {
      // T1-3 (W70.2 fix) — condense routing history so the latest user
      // request drives the decision. Drops coordinator/status stubs (UI
      // protocol, same class as the READY/EXECUTE markers W26 strips) and
      // truncates prior deliverables to a short excerpt, so neither anchors
      // the cheap Haiku router back to the previous department. User
      // messages stay verbatim.
      const cleanedMessages = condenseForOrchestrator(newMessages);
      const res = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: cleanedMessages,
          userId,
          pbToken,
        }),
      });
      if (!res.ok) throw new Error("Orchestrate failed");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No stream");

      let assistantText = "";
      // Add placeholder assistant message
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      anchorNewResponse();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: assistantText };
          return updated;
        });
      }

      // W69 D1 — auto-execute: when the orchestrator is ready, skip the
      // confirm gate. Post a routing-transparency coordinator message and
      // run the agent immediately. AbortController stop is in runAgent.
      const readyMatch = assistantText.match(/READY:(\{.+?\})/s);
      if (readyMatch?.[1]) {
        try {
          const action = JSON.parse(readyMatch[1]) as {
            department: string; task: string; agentId?: string; lockedAlternative?: string;
          };
          const deptLabel = DEPT_LABELS[action.department] ?? action.department;
          const agentLabel = (() => {
            if (!action.agentId) return deptLabel;
            const parts = action.agentId.split("-").slice(1);
            return parts.length
              ? parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ")
              : deptLabel;
          })();
          setMessages((prev) => [...prev, { role: "assistant", content: `${deptLabel} \u2192 ${agentLabel} is on it\u2026` }]);
          setLastLockedAlt(action.lockedAlternative?.trim() ? action.lockedAlternative : null);
          setPhase("generating");
          await runAgent(action.department, action.task, userId, pbToken, action.agentId);
        } catch {
          setPhase("idle");
        }
      } else {
        setPhase("idle");
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Something went wrong. Try again." },
      ]);
      setPhase("idle");
    }
  }

  // PR-Tranche-2.6 (W28) — fire the handoff intent after a successful
  // generation; render returned followUps as buttons below the output.
  // Non-blocking: failures are logged but never surface a UI error
  // (handoff is a polish feature, not a critical path).
  async function fetchHandoffSuggestions(
    department: string,
    task: string,
    output: string,
    userGoal: string,
    userId: string,
    pbToken: string,
    documentIdPromise?: Promise<string | undefined>,
  ): Promise<void> {
    try {
      const res = await fetch("/api/handoff/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          pbToken,
          documentId: await documentIdPromise?.catch(() => undefined),
          sourceDoc: {
            department,
            prompt: task,
            outputExcerpt: output.length > 1200 ? output.slice(0, 1200) + "…" : output,
          },
          query: userGoal,
        }),
      });
      if (!res.ok) {
        console.warn("[CommandCenter] handoff fetch failed", { status: res.status });
        return;
      }
      const data = (await res.json()) as {
        ok?: boolean;
        followUps?: HandoffSuggestion[];
        actionCandidates?: ActionCandidate[];
        degraded?: { followUps?: HandoffSuggestion[]; actionCandidates?: ActionCandidate[] };
      };
      const suggestions = data.followUps ?? data.degraded?.followUps ?? [];
      setFollowUps(suggestions.slice(0, 3));
      // W63 — the platform-action axis arrives in the same response.
      setActionCandidates(data.actionCandidates ?? data.degraded?.actionCandidates ?? []);
    } catch (err) {
      console.warn("[CommandCenter] handoff fetch errored (non-blocking)", err);
    }
  }

  /**
   * W49 (GAP #2) — persist a completed Command Center generation to the
   * documents collection so it appears in the Library, mirroring
   * DepartmentRoom's saveDocument pattern. agent_name resolves from the
   * routed agentId via the roster endpoint, falling back to the department
   * label. Fire-and-forget; a failed save never disturbs the chat.
   */
  async function saveGeneratedDocument(
    department: string,
    task: string,
    output: string,
    userId: string,
    agentId?: string
  ): Promise<string | undefined> {
    try {
      let agentName = DEPT_LABELS[department] ?? department;
      if (agentId) {
        try {
          const rosterRes = await fetch(`/api/agents/${encodeURIComponent(department)}?userId=${encodeURIComponent(userId)}`);
          if (rosterRes.ok) {
            const roster = (await rosterRes.json()) as Array<{ id: string; name: string }>;
            agentName = roster.find((a) => a.id === agentId)?.name ?? agentName;
          }
        } catch { /* fall back to department label */ }
      }
      const activeClientId = typeof window !== "undefined"
        ? localStorage.getItem("staffd_active_client")
        : null;
      const rec = await pb.collection("documents").create({
        user: userId,
        department,
        agent_name: agentName,
        prompt: task,
        output,
        client: activeClientId ?? "",
      });
      // V4b pattern — fire-and-forget Vault ingestion enqueue.
      void fetch("/api/vault/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: rec.id, kind: "document", pbToken: pb.authStore.token }),
      }).catch(() => {});
      return rec.id;
    } catch (err) {
      console.error("[W49] Command Center document save failed:", err);
      return undefined;
    }
  }

  async function runAgent(department: string, task: string, userId: string, pbToken: string, agentId?: string) {
    setOutputBuffer("");
    setFollowUps([]); // clear any previous handoff suggestions before this run
    setActionCandidates([]);
    // Add a generating message placeholder
    setMessages((prev) => [...prev, { role: "assistant", content: "", isOutput: true }]);
    anchorNewResponse();

    // PR-Tranche-2.6.3 (W28 fix) — hoist the streamed result to function
    // scope so the `finally` block reads the ACTUAL streamed text instead
    // of the stale React-state closure of `outputBuffer`. React state
    // updates queue for future renders; the running `finally` closure
    // sees the pre-stream value (empty). Without this hoist,
    // `completedOutput.length > 50` always fails and the handoff fetch
    // never fires — the visible W28 symptom.
    let streamedResult = "";
    let savedDocIdPromise: Promise<string | undefined> | undefined;
    let aborted = false;

    // W69 — per-request abort controller wired to the Stop button.
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const activeClientId = typeof window !== "undefined"
        ? localStorage.getItem("staffd_active_client")
        : null;
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          task,
          department,
          // Hotfix A2 — orchestrator-picked specialist id (when set).
          // Without this, /api/agent falls back to the dept's first-listed
          // agent, which routed SEO questions to the Content Creator.
          agentId: agentId || undefined,
          userId,
          pbToken,
          clientId: activeClientId ?? undefined,
          // Phase 9 — threadId persists conversation turns across reloads.
          threadId: threadId || undefined,
        }),
      });
      if (!res.ok) throw new Error("Agent failed");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No stream");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // PR-Tranche-2.6.3 — accumulate into the function-scope hoist;
        // setOutputBuffer is retained for the streaming UI render but
        // is no longer the source of truth for the finally block.
        streamedResult += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: streamedResult, isOutput: true };
          return updated;
        });
        setOutputBuffer(streamedResult);
      }

      // W49 (GAP #2) — success path only (Decision 3: failed generations
      // don't persist; the catch below never reaches this line).
      if (streamedResult.trim().length > 0 && userId) {
        // W62 — capture the save promise so the handoff request can carry
        // the document id (server persists action_candidates onto it).
        savedDocIdPromise = saveGeneratedDocument(department, task, streamedResult, userId, agentId);
      }
    } catch (err) {
      // W69 — abort is user-initiated: remove the empty placeholder silently.
      if (err instanceof Error && err.name === "AbortError") {
        aborted = true;
        setMessages((prev) => prev.slice(0, -1));
      } else {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: "Something went wrong. Try again.", isOutput: false };
          return updated;
        });
      }
    } finally {
      abortRef.current = null;
      if (aborted) { setPhase("idle"); return; }
      setPhase("done");

      // PR-Tranche-2.6 (W28) — fire handoff suggestions after generation
      // completes. PR-Tranche-2.6.3 fix: read from `streamedResult`
      // (function-scope accumulator) NOT `outputBuffer` (React-state
      // closure — captured stale at runAgent call time, never updated
      // by the stream's setState calls).
      const completedOutput = streamedResult;
      const userGoal = (() => {
        // Most recent user message is the last { role: "user" } before
        // this generation kicked off
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i]!;
          if (m.role === "user") return m.content;
        }
        return task;
      })();
      setLastCompleted({ department, task, output: completedOutput, userGoal });
      // PR-Tranche-2.6.5 (W38) — skip handoff fetch when agent is asking
      // a clarifying question. Handoff suggestions are nonsense if the
      // work isn't done — the user needs to answer first.
      // A finished deliverable that ends with a friendly "want me to do
      // more?" must still surface its action affordances — only a short, pure
      // clarifying question (no work done yet) skips the handoff fetch.
      if (shouldFetchAffordances(completedOutput)) {
        void fetchHandoffSuggestions(department, task, completedOutput, userGoal, userId, pbToken, savedDocIdPromise);
      }
    }
  }

  function reset() {
    setMessages([]);
    setInput("");
    setPhase("idle");
    setOutputBuffer("");
    setLastLockedAlt(null);
    // PR-Tranche-2.6 (W28) — clear handoff state on explicit reset
    setFollowUps([]);
    setLastCompleted(null);
    // Phase 9 — rotate the threadId on reset so the next chat is a fresh
    // conversation. Server-side `conversations` rows stay intact under the
    // old threadId for future thread-picker UX.
    if (typeof window !== "undefined") {
      try {
        const fresh = (window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        window.localStorage.setItem(THREAD_STORAGE_KEY, fresh);
        setThreadId(fresh);
      } catch { /* silent */ }
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const isWorking = phase === "routing" || phase === "generating";

  // Strip the READY:{...} line from display
  function cleanContent(content: string) {
    return content.replace(/\nREADY:\{.+?\}/s, "").replace(/READY:\{.+?\}/s, "").trim();
  }

  return (
    <div
      className="rounded-2xl overflow-hidden mb-8"
      style={{ background: "#111118", border: "1px solid rgba(91,33,232,0.3)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3.5"
        style={{ borderBottom: "1px solid #1E1E2A" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-base"
            style={{ background: "rgba(91,33,232,0.2)", border: "1px solid rgba(91,33,232,0.35)" }}
          >
            ⚡
          </div>
          <div>
            <p className="text-xs font-semibold" style={{ color: "#F0F0F8" }}>Command Center</p>
            <p className="text-xs" style={{ color: "#5A5A70" }}>Tell me what you need — I'll route it to the right specialist</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Phase 25 — thread picker entry point. Always visible so users
              know past conversations are recoverable. */}
          <button
            onClick={() => setThreadPickerOpen(true)}
            className="text-xs transition-colors hover:text-white"
            style={{ color: "#A07BFF" }}
            title="Switch, rename, or archive past threads"
          >
            Threads
          </button>
          {messages.length > 0 && (
            <button
              onClick={reset}
              className="text-xs transition-colors hover:text-white"
              style={{ color: "#3A3A55" }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Phase 25 — thread picker drawer. Renders nothing when closed. */}
      <ThreadPickerDrawer
        open={threadPickerOpen}
        onClose={() => setThreadPickerOpen(false)}
        currentThreadId={threadId}
        onSwitch={switchToThread}
        onNewThread={reset}
      />

      {/* Phase 29 — suggested prompts row. Only rendered before the first
          message so the chrome stays clean during conversations. */}
      {messages.length === 0 && phase === "idle" && (
        <CommandCenterSuggestions onPick={(prompt) => { setInput(prompt); setTimeout(() => void send(prompt), 0); }} />
      )}

      {/* Message thread — PR-Tranche-2.6 (W29): removed `max-h-96
          overflow-y-auto` which capped the thread at 384px and forced
          internal scroll while page space sat unused. Matches
          DepartmentRoom semantics — content flows, page scrolls. */}
      {messages.length > 0 && (
        <div className="px-5 py-4 flex flex-col gap-3">
          {messages.map((msg, i) => {
            if (msg.role === "user") {
              return (
                <div key={i} className="flex justify-end">
                  <div
                    className="max-w-xs px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm"
                    style={{ background: "rgba(91,33,232,0.18)", color: "#F0F0F8", border: "1px solid rgba(91,33,232,0.25)" }}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            }

            const display = cleanContent(msg.content);
            const isExec = msg.content.startsWith("EXECUTE:");

            if (isExec) return null;

            return (
              <div
                key={i}
                ref={i === messages.length - 1 ? responseStartRef : undefined}
                className="flex flex-col gap-1"
              >
                {msg.isOutput ? (
                  // Generated document output
                  <>
                    {/* Locked-match nudge — appears when a better-fit dept is locked */}
                    {phase === "done" && lastLockedAlt && DEPT_LABELS[lastLockedAlt] && (
                      <div
                        className="rounded-xl px-4 py-3 mb-2 flex items-center gap-3"
                        style={{ background: "rgba(91,33,232,0.08)", border: "1px solid rgba(91,33,232,0.25)" }}
                      >
                        <span style={{ fontSize: "16px" }}>💡</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs" style={{ color: "#D0D0E8", lineHeight: 1.5 }}>
                            We routed this to your team. <strong style={{ color: "#A07BFF" }}>{DEPT_LABELS[lastLockedAlt]}</strong> would be a sharper fit.
                          </p>
                          <a
                            href={DEPT_HREFS[lastLockedAlt] ?? "/dashboard"}
                            className="text-xs font-semibold"
                            style={{ color: "#A07BFF", textDecoration: "none" }}
                          >
                            Try it free →
                          </a>
                        </div>
                      </div>
                    )}
                    <div
                      className="rounded-xl p-4"
                      style={{ background: "#0D0D16", border: "1px solid #2A2A38" }}
                    >
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#5B21E8" }} />
                        <span className="text-xs font-semibold" style={{ color: "#7070A0" }}>Generated</span>
                        {display && (
                          <button
                            onClick={() => navigator.clipboard.writeText(display)}
                            className="ml-auto text-xs transition-colors hover:text-white"
                            style={{ color: "#5A5A70" }}
                          >
                            Copy
                          </button>
                        )}
                      </div>
                      {display ? (
                        <div className="agent-output text-xs">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{display}</ReactMarkdown>
                        </div>
                      ) : (
                        <span className="inline-block w-0.5 h-3.5 animate-pulse" style={{ background: "#5B21E8", verticalAlign: "middle" }} />
                      )}
                    </div>
                  </>
                ) : (
                  // Coordinator message
                  <div className="flex gap-2.5">
                    <div
                      className="w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center text-sm mt-0.5"
                      style={{ background: "rgba(91,33,232,0.15)" }}
                    >
                      ⚡
                    </div>
                    <div className="flex-1">
                      {display && (
                        <p className="text-sm" style={{ color: "#D0D0E8", lineHeight: "1.7" }}>
                          {display}
                        </p>
                      )}
                      {!display && isWorking && (
                        <span className="inline-block w-0.5 h-3.5 animate-pulse" style={{ background: "#5B21E8", verticalAlign: "middle" }} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {/* PR-Tranche-2.6 (W28) — cross-functional handoff suggestions.
              Rendered after the message thread; only when phase is done
              (output is complete) and the handoff intent returned
              suggestions. Empty array → renders nothing. */}
          {phase === "done" && (followUps.length > 0 || actionCandidates.length > 0) && lastCompleted && (
            <div className="flex flex-col gap-2 pt-2" style={{ borderTop: "1px solid #1E1E2A" }}>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#7070A0" }}>
                Next steps
              </p>
              <div className="flex flex-wrap gap-2">
                {followUps.map((f, i) => {
                  const deptLabel = DEPT_LABELS[f.department] ?? f.department;
                  const dimmed = f.locked === true;
                  return (
                    <button
                      key={`${f.department}-${i}`}
                      onClick={() => {
                        // Locked dept → route to its dashboard page as an upsell;
                        // unlocked → submit the suggested task as the next turn
                        if (dimmed) {
                          window.location.href = DEPT_HREFS[f.department] ?? "/dashboard";
                          return;
                        }
                        // PR-Tranche-2.6.4 (W35) — bypass orchestrate +
                        // confirm gate. Button click IS explicit consent;
                        // the followUp already knows target dept.
                        void send(f.task, { skipConfirm: true, preselectDept: f.department });
                      }}
                      title={f.rationale ?? `Send to ${deptLabel}`}
                      className="text-xs px-3 py-1.5 rounded-lg transition-colors hover:text-white"
                      style={{
                        background: dimmed ? "rgba(91,33,232,0.05)" : "rgba(91,33,232,0.12)",
                        border: `1px solid ${dimmed ? "rgba(91,33,232,0.15)" : "rgba(91,33,232,0.30)"}`,
                        color: dimmed ? "#5A5A70" : "#A07BFF",
                        cursor: "pointer",
                      }}
                    >
                      {dimmed ? "🔒 " : ""}
                      {deptLabel} · {f.task.length > 60 ? f.task.slice(0, 60) + "…" : f.task}
                    </button>
                  );
                })}
              </div>

              {/* W63 — the platform-action axis (W62 candidates), rendered
                  beneath the cross-department chips. D10' coexistence: the
                  static affordances elsewhere stay untouched until W64. */}
              <ActionAffordances
                candidates={actionCandidates}
                context={{ department: lastCompleted.department }}
              />
            </div>
          )}

        </div>
      )}

      {/* Input — PR-Tranche-2.5 (W26 fix): always visible while the chat has
          life, including after phase === "done". The textarea is disabled
          during in-flight work (isWorking), but visible — the user has a
          clear affordance to continue the conversation. */}
      <div style={{ borderTop: messages.length > 0 ? "1px solid #1E1E2A" : "none" }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={
            messages.length === 0
              ? "What do you need? — e.g. 'write an invoice for a client' or 'I need to hire a designer'…"
              : // PR-Tranche-2.6.5 (W39) — when agent's most recent message
                // ends in a question, switch placeholder + signal answer mode
                agentAwaitingReply
                ? "Type your reply…"
                : phase === "done"
                  ? "Refine, follow up, or ask for something else…"
                  : "Reply…"
          }
          rows={messages.length === 0 ? 2 : 1}
          disabled={isWorking}
          className="w-full px-5 py-4 text-sm outline-none resize-none"
          style={{
            background: "transparent",
            color: "#F0F0F8",
            lineHeight: "1.6",
            caretColor: "#5B21E8",
            opacity: isWorking ? 0.5 : 1,
          }}
        />
        <div className="flex items-center justify-between px-5 pb-3">
          <span className="text-xs" style={{ color: "#2E2E45" }}>
            {isWorking ? (
              <span className="flex items-center gap-1.5" style={{ color: "#5A5A70" }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#5B21E8" }} />
                {phase === "generating" ? (
                  <>
                    generating…
                    <button
                      onClick={() => abortRef.current?.abort()}
                      className="ml-1 text-xs font-medium transition-colors hover:text-white"
                      style={{ color: "#A07BFF", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    >
                      Stop →
                    </button>
                  </>
                ) : "thinking…"}
              </span>
            ) : phase === "done" ? (
              <span style={{ color: "#5A5A70" }}>
                Enter to continue · or{" "}
                <button
                  onClick={reset}
                  className="underline transition-colors hover:text-white"
                  style={{ color: "#A07BFF", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  start fresh
                </button>
              </span>
            ) : "Enter to send"}
          </span>
          <div className="flex items-center gap-2">
            {/* W67 — voice input. Hidden automatically on unsupported
                browsers; text flows through the same Send path as typing. */}
            <VoiceInput value={input} onChange={setInput} disabled={isWorking} />
            <button
              onClick={() => void send()}
              disabled={!input.trim() || isWorking}
              className="btn-primary px-4 py-1.5 rounded-xl text-xs font-semibold text-white"
              style={{ opacity: !input.trim() || isWorking ? 0.3 : 1, cursor: !input.trim() || isWorking ? "not-allowed" : "pointer" }}
            >
              Send →
            </button>
          </div>
        </div>
      </div>

      <ScheduleFollowupModal
        open={followupOpen}
        onClose={() => setFollowupOpen(false)}
        department={lastCompleted?.department ?? "marketing"}
        agentName={DEPT_LABELS[lastCompleted?.department ?? ""] ?? "Your team"}
        seedTask={followupSeed}
      />

      <ActionRecipientModal
        open={recipientModal !== null}
        kind={recipientModal?.kind ?? "support"}
        busy={recipientBusy}
        onClose={() => { if (!recipientBusy) setRecipientModal(null); }}
        onSubmit={(r) => { void submitRecipientAction(r); }}
      />

      {pendingIntents.length > 0 && (
        <ConfirmActionModal
          intentOptions={pendingIntents}
          busy={intentBusy}
          showGraduationOffer={graduationOffer}
          onConfirm={(type, f) => { handleConfirm(type, f); }}
          onGraduate={(choice, type, f) => { void handleGraduate(choice, type, f); }}
          onCancel={cancelIntent}
        />
      )}

      {undoToast && (
        <UndoToast auditRowId={undoToast.auditRowId} message={undoToast.message} onClose={() => setUndoToast(null)} />
      )}
    </div>
  );
}
