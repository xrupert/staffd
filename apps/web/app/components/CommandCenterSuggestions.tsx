"use client";

/**
 * CommandCenterSuggestions — Phase 29 (CC UX upgrades).
 *
 * Renders a horizontal row of suggested prompts when the Command Center has
 * no messages yet. Suggestions are time-of-day-aware and lightly informed by
 * the user's most-recently-active department (read from documents). Two
 * fallback "generic" suggestions always render so the row is never empty.
 *
 * Stateless w.r.t. CommandCenter — just emits a callback when the user picks
 * a chip. CommandCenter calls send(prompt) with that text.
 */

import { useEffect, useState } from "react";
import pb from "../../lib/pb";

type Suggestion = { label: string; prompt: string };

type Props = {
  /** Called when the user picks a suggestion. */
  onPick: (prompt: string) => void;
};

const GENERIC_SUGGESTIONS: Suggestion[] = [
  { label: "Write today's social post",  prompt: "Write today's social post for my business." },
  { label: "Draft a sales follow-up",    prompt: "Draft a follow-up email to a prospect who went quiet last week." },
  { label: "Outline a new offer",        prompt: "Outline a new offer I can run this month — propose the angle, pricing, and the channel mix." },
];

function timeOfDaySuggestion(): Suggestion {
  const h = new Date().getHours();
  if (h < 11) return { label: "Plan my day",   prompt: "What are the three things I should focus on today? Pull from my brief and recent work." };
  if (h < 16) return { label: "Mid-day check", prompt: "What's still open from this morning? Surface anything that needs my attention before EOD." };
  return        { label: "Wrap-up",      prompt: "Summarize what got done today and what's queued for tomorrow." };
}

function deptSuggestion(department: string | null): Suggestion | null {
  if (!department) return null;
  const map: Record<string, Suggestion> = {
    marketing:    { label: "Marketing — next campaign",  prompt: "Propose the next marketing campaign I should run, based on what's worked recently." },
    sales:        { label: "Sales — pipeline status",     prompt: "Where do I stand with my open deals? What's the single most important follow-up?" },
    legal:        { label: "Legal — what needs review",   prompt: "Are there any open legal items I should review or sign this week?" },
    hr:           { label: "HR — open roles",             prompt: "What's the status of my open roles? Draft the next outreach." },
    finance:      { label: "Finance — quick read",        prompt: "Give me a one-paragraph financial pulse on the business right now." },
    operations:   { label: "Operations — bottlenecks",    prompt: "Where am I likely bottlenecked operationally? One thing I can fix this week." },
    design:       { label: "Design — what to refresh",    prompt: "What's the single most impactful visual asset I should refresh next?" },
    "paid-media": { label: "Paid media — what's working", prompt: "Which channels and creatives are pulling weight? What should I cut?" },
    reputation:   { label: "Reviews — top response",      prompt: "Draft a response to my most recent customer review." },
    ceo:          { label: "CEO — decisions queue",       prompt: "What decisions need me this week? Brief them, then recommend." },
  };
  return map[department] ?? null;
}

export default function CommandCenterSuggestions({ onPick }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>(GENERIC_SUGGESTIONS);

  useEffect(() => {
    const userId = pb.authStore.record?.id ?? "";
    if (!userId) {
      setSuggestions([timeOfDaySuggestion(), ...GENERIC_SUGGESTIONS.slice(0, 2)]);
      return;
    }
    void (async () => {
      let recentDept: string | null = null;
      try {
        const res = await pb.collection("documents").getList(1, 1, {
          filter: `user = '${userId}'`,
          sort: "-created",
          fields: "department",
        });
        recentDept = (res.items[0]?.department as string | undefined) ?? null;
      } catch { /* silent */ }

      const tod = timeOfDaySuggestion();
      const dept = deptSuggestion(recentDept);
      // 4 chips total: time-of-day, dept-specific (if any), then 2-3 generics
      const final: Suggestion[] = [tod];
      if (dept) final.push(dept);
      for (const g of GENERIC_SUGGESTIONS) {
        if (final.length >= 4) break;
        if (!final.some((x) => x.label === g.label)) final.push(g);
      }
      setSuggestions(final);
    })();
  }, []);

  return (
    <div className="px-5 py-3" style={{ borderBottom: "1px solid #1E1E2A" }}>
      <p className="text-xs uppercase tracking-widest mb-2" style={{ color: "#3A3A50", fontWeight: 600 }}>
        Try
      </p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s.label}
            onClick={() => onPick(s.prompt)}
            className="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
            style={{
              background: "rgba(91,33,232,0.08)",
              border: "1px solid rgba(91,33,232,0.25)",
              color: "#A07BFF",
              cursor: "pointer",
            }}
            title={s.prompt}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
