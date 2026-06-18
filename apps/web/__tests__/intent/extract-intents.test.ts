/**
 * W95.4a/.4b — extractIntent parses all 10 intent types and returns a ranked
 * IntentResult[] with top-2 disambiguation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const llm = vi.hoisted(() => ({ resp: { ok: true, text: "" } as { ok: boolean; text: string } }));
vi.mock("../../app/api/_lib/orchestrator/llm", () => ({ callLLM: vi.fn(async () => llm.resp) }));

import { extractIntent, DELEGATE_INTENTS } from "../../app/api/_lib/orchestrator/intent";

describe("DELEGATE_INTENTS", () => {
  it("contains exactly the two delegate-to-specialist intents", () => {
    expect([...DELEGATE_INTENTS].sort()).toEqual(["draft_campaign", "send_for_signature"]);
  });
});

/** Feed the LLM a candidate list (becomes {"intents":[...]}). */
function say(...intents: unknown[]) { llm.resp = { ok: true, text: JSON.stringify({ intents }) }; }
beforeEach(() => { llm.resp = { ok: true, text: "" }; });
afterEach(() => vi.restoreAllMocks());

describe("extractIntent — positive parse per type", () => {
  const cases: { type: string; fields: Record<string, string>; check: Record<string, string> }[] = [
    { type: "create_contact", fields: { name: "Jane", email: "j@x.com" }, check: { name: "Jane" } },
    { type: "log_interaction", fields: { contact_name: "Jane", interaction_type: "call" }, check: { interaction_type: "call" } },
    { type: "schedule_followup", fields: { contact_name: "Jane", due_date: "next Tue" }, check: { contact_name: "Jane" } },
    { type: "add_to_email_list", fields: { email: "j@x.com" }, check: { email: "j@x.com" } },
    { type: "create_task", fields: { title: "Call accountant" }, check: { title: "Call accountant" } },
    { type: "capture_lead", fields: { name: "John", company: "Acme" }, check: { company: "Acme" } },
    { type: "update_contact", fields: { contact_identifier: "Jane", new_email: "j@new.com" }, check: { new_email: "j@new.com" } },
    { type: "log_expense", fields: { amount: "45" }, check: { amount: "45" } },
    { type: "draft_campaign", fields: { message_summary: "launch announcement" }, check: { message_summary: "launch announcement" } },
    { type: "send_for_signature", fields: { document_identifier: "consulting agreement", signer_name: "Jane" }, check: { document_identifier: "consulting agreement" } },
    { type: "disable_autopilot", fields: { intent_type: "create_contact" }, check: { intent_type: "create_contact" } },
    { type: "reply_to_ticket", fields: { conversation_identifier: "John", message_summary: "we can do next week", tone: "friendly" }, check: { message_summary: "we can do next week" } },
    { type: "resolve_ticket", fields: { conversation_identifier: "John" }, check: { conversation_identifier: "John" } },
    { type: "tag_conversation", fields: { conversation_identifier: "John", label: "pricing" }, check: { label: "pricing" } },
  ];
  for (const c of cases) {
    it(`parses ${c.type}`, async () => {
      say({ type: c.type, fields: c.fields, confidence: 0.9 });
      const r = await extractIntent("msg");
      expect(r).toHaveLength(1);
      expect(r[0]!.type).toBe(c.type);
      expect(r[0]!.fields).toMatchObject(c.check);
    });
  }
});

describe("extractIntent — disambiguation + ranking", () => {
  it("returns BOTH when two clear 0.7 and differ by < 0.15", async () => {
    say({ type: "capture_lead", fields: { name: "John", company: "Acme" }, confidence: 0.82 },
        { type: "create_contact", fields: { name: "John" }, confidence: 0.78 });
    const r = await extractIntent("John at Acme wants consulting, add him");
    expect(r).toHaveLength(2);
    expect(r[0]!.type).toBe("capture_lead"); // higher confidence first
    expect(r[1]!.type).toBe("create_contact");
  });

  it("returns only the top when the gap is >= 0.15", async () => {
    say({ type: "capture_lead", fields: { name: "John" }, confidence: 0.95 },
        { type: "create_contact", fields: { name: "John" }, confidence: 0.72 });
    const r = await extractIntent("msg");
    expect(r).toHaveLength(1);
    expect(r[0]!.type).toBe("capture_lead");
  });

  it("returns only the top when the second is below the floor", async () => {
    say({ type: "create_contact", fields: { name: "Jane" }, confidence: 0.88 },
        { type: "capture_lead", fields: { name: "Jane" }, confidence: 0.5 });
    expect(await extractIntent("msg")).toHaveLength(1);
  });

  it("re-ranks unordered candidates by confidence", async () => {
    say({ type: "create_contact", fields: { name: "Jane" }, confidence: 0.74 },
        { type: "capture_lead", fields: { name: "Jane" }, confidence: 0.80 });
    const r = await extractIntent("msg");
    expect(r[0]!.type).toBe("capture_lead");
  });
});

describe("extractIntent — null paths", () => {
  it("empty intents → []", async () => { say(); expect(await extractIntent("how do I find leads?")).toEqual([]); });
  it("top below floor → []", async () => { say({ type: "create_task", fields: { title: "x" }, confidence: 0.4 }); expect(await extractIntent("x")).toEqual([]); });
  it("unknown type filtered out → []", async () => { say({ type: "launch_rocket", fields: {}, confidence: 0.99 }); expect(await extractIntent("x")).toEqual([]); });
  it("missing required field filtered out → []", async () => { say({ type: "create_task", fields: { notes: "no title" }, confidence: 0.9 }); expect(await extractIntent("x")).toEqual([]); });
  it("non-JSON → []", async () => { llm.resp = { ok: true, text: "I think..." }; expect(await extractIntent("x")).toEqual([]); });
  it("LLM failure → []", async () => { llm.resp = { ok: false, text: "" }; expect(await extractIntent("x")).toEqual([]); });
});
