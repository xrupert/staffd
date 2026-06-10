/**
 * W44 — Outcome card pool contract tests.
 *
 * Pins the brand-voice and schema rules for the canonical card pool:
 * schema completeness, id uniqueness + format, department alignment,
 * per-department count ranges, label/seed voice rules (verb-first,
 * length caps, forbidden words, no specialist-name leakage), tag
 * vocabulary, weights, and aggregator correctness.
 */

import { describe, it, expect } from "vitest";

import {
  ALL_OUTCOME_CARDS,
  getOutcomeCardsByDepartment,
  getOutcomeCardById,
  marketingOutcomeCards,
  salesOutcomeCards,
  legalOutcomeCards,
  hrOutcomeCards,
  financeOutcomeCards,
  operationsOutcomeCards,
  paidMediaOutcomeCards,
  designOutcomeCards,
  reputationOutcomeCards,
  ceoOutcomeCards,
} from "../outcome-cards";
import type { OutcomeCard, OutcomeCardTag } from "../outcome-cards";

import { marketingAgents } from "../departments/marketing";
import { salesAgents } from "../departments/sales";
import { legalAgents } from "../departments/legal";
import { hrAgents } from "../departments/hr";
import { financeAgents } from "../departments/finance";
import { operationsAgents } from "../departments/operations";
import { designAgents } from "../departments/design";
import { paidMediaAgents } from "../departments/paid-media";
import { reputationAgents } from "../departments/reputation";
import { ceoAgents } from "../departments/ceo";

const DEPT_FILES: Array<[string, OutcomeCard[], number, number]> = [
  ["marketing",  marketingOutcomeCards,  25, 30],
  ["sales",      salesOutcomeCards,      20, 25],
  ["legal",      legalOutcomeCards,      15, 20],
  ["hr",         hrOutcomeCards,         15, 20],
  ["finance",    financeOutcomeCards,    20, 25],
  ["operations", operationsOutcomeCards, 25, 30],
  ["paid-media", paidMediaOutcomeCards,  20, 25],
  ["design",     designOutcomeCards,     20, 25],
  ["reputation", reputationOutcomeCards, 15, 20],
  ["ceo",        ceoOutcomeCards,        15, 20],
];

const ALLOWED_VERBS = [
  "Write", "Build", "Launch", "Draft", "Plan", "Audit", "Run", "Generate",
  "Create", "Set up", "Review", "Respond", "Design", "Forecast", "Map",
  "Reply", "Outline", "Refine", "Open", "Close", "Send",
];

// Word-boundaried so "agenda" doesn't trip on "agent", "subscriptions"
// doesn't trip on "subscribe". "can't" handled separately (apostrophe).
const FORBIDDEN_WORDS =
  /\b(ai|agents?|bots?|tools?|features?|subscribe|upgrades?|limits?|unable|wheelhouse)\b/i;
const FORBIDDEN_CANT = /can['’]t/i;
const FORBIDDEN_COMPETITORS =
  /\b(midjourney|dall[- ]?e|gpt|chatgpt|semrush|ahrefs|hubspot|canva|mailchimp|notion|asana|stable diffusion|perplexity|gemini|copilot)\b/i;

// Every specialist display name from the 10 department files — labels and
// seeds must never contain one (case-insensitive).
const SPECIALIST_NAMES = [
  ...marketingAgents, ...salesAgents, ...legalAgents, ...hrAgents,
  ...financeAgents, ...operationsAgents, ...designAgents,
  ...paidMediaAgents, ...reputationAgents, ...ceoAgents,
].map((a) => a.name.toLowerCase());

const ALLOWED_TAGS: ReadonlySet<string> = new Set<OutcomeCardTag>([
  "weekly", "monthly", "quarterly", "one-shot", "ongoing",
  "b2b", "b2c", "ecommerce", "service", "agency",
  "law", "real-estate", "restaurants", "coaches",
  "trades", "salons", "consultants",
  "content", "ops", "growth", "revenue", "compliance",
  "people", "money", "creative", "support",
]);

const ALLOWED_WEIGHTS = new Set([0.5, 1.0, 1.5]);

describe("outcome cards — schema completeness (Test 1)", () => {
  it("every card has all 5 required fields with correct types", () => {
    for (const card of ALL_OUTCOME_CARDS) {
      expect(typeof card.id, `id missing on ${JSON.stringify(card)}`).toBe("string");
      expect(typeof card.department, `department missing on ${card.id}`).toBe("string");
      expect(typeof card.label, `label missing on ${card.id}`).toBe("string");
      expect(typeof card.seed, `seed missing on ${card.id}`).toBe("string");
      expect(Array.isArray(card.tags), `tags missing on ${card.id}`).toBe(true);
      expect(typeof card.weight, `weight missing on ${card.id}`).toBe("number");
    }
  });
});

describe("outcome cards — id rules (Tests 2–3)", () => {
  it("ids are unique across the entire pool (Test 2)", () => {
    const ids = ALL_OUTCOME_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every id matches {dept-short}-{verb}-{noun} format (Test 3)", () => {
    for (const card of ALL_OUTCOME_CARDS) {
      expect(card.id, `bad id format: ${card.id}`).toMatch(/^[a-z]{2,4}-[a-z]+-[a-z]+$/);
    }
  });

  it("no two cards in a department share the same verb+noun root", () => {
    for (const [dept, cards] of DEPT_FILES) {
      const pairs = cards.map((c) => c.id.split("-").slice(1).join("-"));
      expect(new Set(pairs).size, `verb+noun overlap in ${dept}`).toBe(pairs.length);
    }
  });
});

describe("outcome cards — department alignment + counts (Tests 4–5)", () => {
  it("every card's department matches its file (Test 4)", () => {
    for (const [dept, cards] of DEPT_FILES) {
      for (const card of cards) {
        expect(card.department, `${card.id} in ${dept} file`).toBe(dept);
      }
    }
  });

  it("per-department counts are within target range; total in [190, 240] (Test 5)", () => {
    let total = 0;
    for (const [dept, cards, min, max] of DEPT_FILES) {
      expect(cards.length, `${dept} count ${cards.length} not in [${min}, ${max}]`).toBeGreaterThanOrEqual(min);
      expect(cards.length, `${dept} count ${cards.length} not in [${min}, ${max}]`).toBeLessThanOrEqual(max);
      total += cards.length;
    }
    expect(total).toBeGreaterThanOrEqual(190);
    expect(total).toBeLessThanOrEqual(240);
  });
});

describe("outcome cards — label voice rules (Test 6)", () => {
  it("every label is ≤ 50 chars", () => {
    for (const card of ALL_OUTCOME_CARDS) {
      expect(card.label.length, `label too long on ${card.id}: "${card.label}"`).toBeLessThanOrEqual(50);
    }
  });

  it("every label starts with an allowed action verb", () => {
    for (const card of ALL_OUTCOME_CARDS) {
      const ok = ALLOWED_VERBS.some((v) => card.label.startsWith(v + " ") || card.label === v);
      expect(ok, `label not verb-first on ${card.id}: "${card.label}"`).toBe(true);
    }
  });

  it("no label contains forbidden words or competitor names", () => {
    for (const card of ALL_OUTCOME_CARDS) {
      expect(card.label, `forbidden word in label of ${card.id}`).not.toMatch(FORBIDDEN_WORDS);
      expect(card.label, `"can't" in label of ${card.id}`).not.toMatch(FORBIDDEN_CANT);
      expect(card.label, `competitor in label of ${card.id}`).not.toMatch(FORBIDDEN_COMPETITORS);
    }
  });

  it("no label contains a specialist name (dynamic, from department files)", () => {
    for (const card of ALL_OUTCOME_CARDS) {
      const lower = card.label.toLowerCase();
      for (const name of SPECIALIST_NAMES) {
        expect(lower.includes(name), `label of ${card.id} contains specialist name "${name}"`).toBe(false);
      }
    }
  });
});

describe("outcome cards — seed voice rules (Test 7)", () => {
  it("every seed is between 20 and 280 chars", () => {
    for (const card of ALL_OUTCOME_CARDS) {
      expect(card.seed.length, `seed length ${card.seed.length} on ${card.id}`).toBeGreaterThanOrEqual(20);
      expect(card.seed.length, `seed length ${card.seed.length} on ${card.id}`).toBeLessThanOrEqual(280);
    }
  });

  it("no seed contains forbidden words, competitor names, or placeholder brackets", () => {
    for (const card of ALL_OUTCOME_CARDS) {
      expect(card.seed, `forbidden word in seed of ${card.id}`).not.toMatch(FORBIDDEN_WORDS);
      expect(card.seed, `"can't" in seed of ${card.id}`).not.toMatch(FORBIDDEN_CANT);
      expect(card.seed, `competitor in seed of ${card.id}`).not.toMatch(FORBIDDEN_COMPETITORS);
      expect(card.seed.includes("["), `bracket in seed of ${card.id}`).toBe(false);
      expect(card.seed.includes("]"), `bracket in seed of ${card.id}`).toBe(false);
    }
  });

  it("no seed contains a specialist name (dynamic, from department files)", () => {
    for (const card of ALL_OUTCOME_CARDS) {
      const lower = card.seed.toLowerCase();
      for (const name of SPECIALIST_NAMES) {
        expect(lower.includes(name), `seed of ${card.id} contains specialist name "${name}"`).toBe(false);
      }
    }
  });
});

describe("outcome cards — tag rules (Test 8)", () => {
  it("every tag is in the OutcomeCardTag union; 1–5 tags per card", () => {
    for (const card of ALL_OUTCOME_CARDS) {
      expect(card.tags.length, `tag count on ${card.id}`).toBeGreaterThanOrEqual(1);
      expect(card.tags.length, `tag count on ${card.id}`).toBeLessThanOrEqual(5);
      for (const tag of card.tags) {
        expect(ALLOWED_TAGS.has(tag), `unknown tag "${tag}" on ${card.id}`).toBe(true);
      }
    }
  });
});

describe("outcome cards — weight rules (Test 9)", () => {
  it("every weight is one of {0.5, 1.0, 1.5}", () => {
    for (const card of ALL_OUTCOME_CARDS) {
      expect(ALLOWED_WEIGHTS.has(card.weight), `weight ${card.weight} on ${card.id}`).toBe(true);
    }
  });
});

describe("outcome cards — aggregate index (Test 10)", () => {
  it("ALL_OUTCOME_CARDS length equals the sum of all department arrays", () => {
    const sum = DEPT_FILES.reduce((acc, [, cards]) => acc + cards.length, 0);
    expect(ALL_OUTCOME_CARDS.length).toBe(sum);
  });

  it("getOutcomeCardsByDepartment returns only that department's cards", () => {
    const mkt = getOutcomeCardsByDepartment("marketing");
    expect(mkt.length).toBe(marketingOutcomeCards.length);
    expect(mkt.every((c) => c.department === "marketing")).toBe(true);
  });

  it("getOutcomeCardById returns the right card / undefined for unknown", () => {
    const known = getOutcomeCardById("mkt-write-blog");
    expect(known?.label).toBe("Write this week's blog post");
    expect(getOutcomeCardById("nonexistent")).toBeUndefined();
  });
});
