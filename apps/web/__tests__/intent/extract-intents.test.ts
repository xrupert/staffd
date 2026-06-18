/**
 * W95.4a — extractIntent parses all 8 intent types (flat field model) and
 * returns null on no-intent / unknown type / missing required field.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const llm = vi.hoisted(() => ({ resp: { ok: true, text: "" } as { ok: boolean; text: string } }));
vi.mock("../../app/api/_lib/orchestrator/llm", () => ({ callLLM: vi.fn(async () => llm.resp) }));

import { extractIntent } from "../../app/api/_lib/orchestrator/intent";

function say(obj: unknown) { llm.resp = { ok: true, text: JSON.stringify(obj) }; }
beforeEach(() => { llm.resp = { ok: true, text: "" }; });
afterEach(() => vi.restoreAllMocks());

describe("extractIntent — positive parse per type", () => {
  const cases: { type: string; fields: Record<string, string>; check: Record<string, string> }[] = [
    { type: "create_contact", fields: { name: "Jane", email: "j@x.com" }, check: { name: "Jane" } },
    { type: "log_interaction", fields: { contact_name: "Jane", interaction_type: "call", notes: "pricing" }, check: { contact_name: "Jane", interaction_type: "call" } },
    { type: "schedule_followup", fields: { contact_name: "Jane", due_date: "next Tue" }, check: { contact_name: "Jane" } },
    { type: "add_to_email_list", fields: { email: "j@x.com", name: "Jane" }, check: { email: "j@x.com" } },
    { type: "create_task", fields: { title: "Call accountant", due_date: "tomorrow" }, check: { title: "Call accountant" } },
    { type: "capture_lead", fields: { name: "John", company: "Acme", interest_summary: "consulting" }, check: { name: "John", company: "Acme" } },
    { type: "update_contact", fields: { contact_identifier: "Jane", new_email: "jane@new.com" }, check: { contact_identifier: "Jane", new_email: "jane@new.com" } },
    { type: "log_expense", fields: { amount: "45", category: "office supplies" }, check: { amount: "45" } },
  ];
  for (const c of cases) {
    it(`parses ${c.type}`, async () => {
      say({ type: c.type, fields: c.fields, confidence: 0.9 });
      const r = await extractIntent("user message");
      expect(r).not.toBeNull();
      expect(r!.type).toBe(c.type);
      expect(r!.fields).toMatchObject(c.check);
      expect(r!.confidence).toBe(0.9);
    });
  }
});

describe("extractIntent — null paths", () => {
  it("returns null for type 'none'", async () => { say({ type: "none", confidence: 0 }); expect(await extractIntent("how do I find leads?")).toBeNull(); });
  it("returns null for an unknown type", async () => { say({ type: "launch_rocket", fields: {}, confidence: 0.99 }); expect(await extractIntent("x")).toBeNull(); });
  it("returns null when the required field is missing", async () => { say({ type: "create_task", fields: { notes: "no title" }, confidence: 0.9 }); expect(await extractIntent("x")).toBeNull(); });
  it("returns null on non-JSON output", async () => { llm.resp = { ok: true, text: "I think you mean..." }; expect(await extractIntent("x")).toBeNull(); });
  it("returns null when the LLM call fails", async () => { llm.resp = { ok: false, text: "" }; expect(await extractIntent("x")).toBeNull(); });
  it("coerces a numeric amount to a string for log_expense", async () => { say({ type: "log_expense", fields: { amount: 200, category: "lunch" }, confidence: 0.8 }); const r = await extractIntent("x"); expect(r!.fields.amount).toBe("200"); });
});
