/**
 * FC-1d — integration reads → agent context.
 *
 * When a specialist runs, it should KNOW the live state of the user's
 * connected tools, not just their vault: the Sales specialist sees the CRM,
 * Marketing sees campaign performance + site traffic, Operations/Reputation
 * see the support inbox. Reads only — writes stay behind confirm-to-commit.
 *
 * Contracts:
 *   - Department-gated: only the readers relevant to the running department
 *     fire (no cross-department latency tax).
 *   - Fail-open + time-boxed: any reader erroring or exceeding READ_TIMEOUT_MS
 *     contributes nothing; the agent still runs. Live data is a bonus, never
 *     a dependency.
 *   - Compact: each reader returns at most a few lines; the whole block is
 *     capped at MAX_BLOCK_CHARS.
 *   - Model B3: all reads go through the tenant-tagged clients — a customer
 *     only ever sees their own slice of the operator-shared vendors.
 */

import { TwentyClient } from "./twenty/client";
import { ChatwootClient } from "./chatwoot/client";
import { ListmonkClient } from "./listmonk/client";
import { PlausibleClient } from "./plausible/client";

export const READ_TIMEOUT_MS = 3_000;
export const MAX_BLOCK_CHARS = 2_000;

export type IntegrationReader = () => Promise<string | null>;
export type ReaderMap = Record<string, IntegrationReader>;

/** Which readers a department gets. Unlisted departments read nothing. */
export const DEPARTMENT_READERS: Readonly<Record<string, ReadonlyArray<string>>> = {
  sales: ["crm"],
  marketing: ["email", "traffic"],
  "paid-media": ["traffic"],
  operations: ["support"],
  reputation: ["support"],
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function defaultReaders(userId: string): ReaderMap {
  return {
    crm: async () => {
      if (!TwentyClient.configured) return null;
      const people = await TwentyClient.forCustomer(userId).listPeople(10);
      if (people.length === 0) return "CRM: no contacts yet.";
      const names = people.slice(0, 5).map((p) => p.name).filter(Boolean).join(", ");
      return `CRM: ${people.length}${people.length === 10 ? "+" : ""} contacts. Recent: ${names}.`;
    },
    support: async () => {
      if (!ChatwootClient.configured) return null;
      const open = await ChatwootClient.forCustomer(userId).listConversations({ status: "open", limit: 5 });
      if (open.length === 0) return "Support inbox: no open conversations.";
      const lines = open.slice(0, 3).map((c) => `  • ${c.sender || "customer"}: ${c.snippet.slice(0, 80)}`);
      return `Support inbox: ${open.length} open conversation${open.length === 1 ? "" : "s"}.\n${lines.join("\n")}`;
    },
    email: async () => {
      if (!ListmonkClient.configured) return null;
      const campaigns = await ListmonkClient.forCustomer(userId).listCampaigns(5);
      if (campaigns.length === 0) return "Email campaigns: none yet.";
      const lines = campaigns.slice(0, 3).map(
        (c) => `  • "${c.name}" (${c.status}): sent ${c.sent}, ${Math.round(c.openRate)}% open, ${c.clicks} clicks`,
      );
      return `Email campaigns (latest ${Math.min(3, campaigns.length)}):\n${lines.join("\n")}`;
    },
    traffic: async () => {
      if (!PlausibleClient.configured) return null;
      if (!(await PlausibleClient.hasSiteFor(userId))) return null;
      const agg = await PlausibleClient.forCustomer(userId).getAggregateStats({ period: "7d" });
      return `Website (last 7 days): ${agg.visitors} visitors, ${agg.pageviews} pageviews, ${Math.round(agg.bounce_rate)}% bounce.`;
    },
  };
}

/**
 * Build the LIVE BUSINESS DATA system-prompt block for this department.
 * Returns "" when the department has no readers, nothing is configured,
 * or every read fails — the agent prompt is unchanged in all those cases.
 */
export async function buildIntegrationReadsBlock(
  userId: string,
  department: string,
  readers: ReaderMap = defaultReaders(userId),
): Promise<string> {
  const wanted = DEPARTMENT_READERS[department] ?? [];
  if (!userId || wanted.length === 0) return "";

  const results = await Promise.all(
    wanted.map((key) => {
      const reader = readers[key];
      return reader ? withTimeout(reader(), READ_TIMEOUT_MS) : Promise.resolve(null);
    }),
  );

  const lines = results.filter((r): r is string => typeof r === "string" && r.length > 0);
  if (lines.length === 0) return "";

  const body = lines.join("\n").slice(0, MAX_BLOCK_CHARS);
  return `\n\n--- LIVE BUSINESS DATA (read just now from your connected tools) ---\n${body}\n--- END LIVE BUSINESS DATA ---`;
}
