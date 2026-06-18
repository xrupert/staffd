/**
 * W95.7.1 — FC-2 action→intent mapping is sound: every mapped intent is a real
 * V1 intent wired to a commit handler, and the unmapped support-ticket action
 * is hidden. Pins the migration so a button can't drift to a dead intent.
 */

import { describe, it, expect } from "vitest";
import { FC2_ACTION_INTENT, ACTION_UI, ACTION_VOCABULARY } from "../../app/api/_lib/orchestrator/action-vocabulary";
import { INTENT_FIELDS } from "../../app/api/_lib/orchestrator/intent-policy";
import { COMMIT_HANDLERS } from "../../app/api/_lib/intent/commit-handlers";

describe("FC2_ACTION_INTENT (W95.7.1)", () => {
  it("maps the three migrated buttons to the expected intents", () => {
    expect(FC2_ACTION_INTENT).toMatchObject({
      send_to_crm: "create_contact",
      send_email_campaign: "draft_campaign",
      send_for_signature: "send_for_signature",
    });
  });

  it("every mapped intent is a real V1 intent with a commit handler", () => {
    for (const intent of Object.values(FC2_ACTION_INTENT)) {
      expect(INTENT_FIELDS[intent as keyof typeof INTENT_FIELDS], `${intent} in INTENT_FIELDS`).toBeTruthy();
      expect(COMMIT_HANDLERS[intent as string], `${intent} in COMMIT_HANDLERS`).toBeTruthy();
    }
  });

  it("open_support_ticket is NOT mapped and IS hidden (no covering intent yet)", () => {
    expect(FC2_ACTION_INTENT.open_support_ticket).toBeUndefined();
    expect(ACTION_UI.open_support_ticket.hidden).toBe(true);
  });

  it("the three migrated actions still render (not hidden)", () => {
    expect(ACTION_UI.send_to_crm.hidden).toBeFalsy();
    expect(ACTION_UI.send_email_campaign.hidden).toBeFalsy();
    expect(ACTION_UI.send_for_signature.hidden).toBeFalsy();
  });

  it("the action vocabulary size is unchanged (10 actions, SA-locked)", () => {
    expect(ACTION_VOCABULARY).toHaveLength(10);
  });
});
