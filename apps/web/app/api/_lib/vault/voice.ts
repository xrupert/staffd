/**
 * Brand Voice Fingerprint (Phase 2 / Task #1).
 *
 * Pure-JS, deterministic voice extraction. NO LLM in the hot path — every
 * metric below is computed from regex + word lists + arithmetic so the
 * nightly cron stays cheap and the recompute is fast enough to fire inline
 * on high-signal events (published / shared).
 *
 * Pipeline:
 *
 *   recomputeVoiceProfile(userId)
 *     → fetchTrainingCorpus(userId)       — last 90 days docs + signal weights
 *     → extractVoiceMetrics(weightedDocs) — pure-JS metrics
 *     → renderVoicePrompt(metrics)        — natural-language paragraph
 *     → upsertVoiceProfile(userId, ...)   — PB write
 *
 *   getVoiceBlock(userId, department)
 *     → pulls pre-rendered voicePromptText and returns it as an injectable
 *       block, OR "" when the dept is not voice-applicable OR the profile
 *       is low-confidence (< 5 training docs).
 *
 * Spec choices (locked by user):
 *   • Training corpus (A3): last 90 days, weighted blend
 *       published 3.0 / shared 2.0 / regenerated 1.5 / kept 1.0 / none 0.5
 *   • Update cadence (B3): nightly cron via worker/scheduled +
 *       fire-and-forget on `published` or `shared` patterns (V6 hook).
 *   • Department targeting: apply to marketing / sales / reputation / hr /
 *       design / ceo / paid-media; skip legal / finance / operations.
 *   • Injection format: natural-language prose block with markers, NOT JSON.
 */

import { adminHeaders, getAdminToken, pbEscape, pbFirst, pbUrl } from "../pb";

// ──────────────────────────────────────────────────────────────────────────
// Department applicability
// ──────────────────────────────────────────────────────────────────────────

export const VOICE_APPLICABLE_DEPARTMENTS = new Set<string>([
  "marketing",
  "sales",
  "reputation",
  "hr",
  "design",
  "ceo",
  "paid-media",
]);

export function isVoiceApplicableDepartment(department: string | undefined): boolean {
  if (!department) return false;
  return VOICE_APPLICABLE_DEPARTMENTS.has(department);
}

// ──────────────────────────────────────────────────────────────────────────
// Sample weighting (Spec A3)
// ──────────────────────────────────────────────────────────────────────────

const SAMPLE_WEIGHTS: Record<string, number> = {
  published: 3.0,
  shared: 2.0,
  regenerated: 1.5,
  kept: 1.0,
};
const UNSIGNALED_WEIGHT = 0.5;

const TRAINING_WINDOW_DAYS = 90;
const MIN_DOCS_FOR_PROFILE = 1;
const MIN_DOCS_FOR_MEDIUM = 5;
const MIN_DOCS_FOR_HIGH = 15;

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type PunctuationStyle = {
  emDashPer1000: number;
  exclamationPer1000: number;
  semicolonPer1000: number;
  ellipsisPer1000: number;
  oxfordCommaUsage: number; // 0–1
};

export type VoiceMetrics = {
  avgSentenceLength: number;
  formalityScore: number;       // 0 = informal, 1 = formal
  emojiFrequency: number;       // emoji per 1000 chars
  commonOpeners: string[];      // top 5
  commonClosers: string[];      // top 5
  bannedWords: string[];        // jargon never used by this user
  positivityScore: number;      // 0 = negative, 0.5 = neutral, 1 = positive
  punctuationStyle: PunctuationStyle;
  documentCount: number;
  confidence: "low" | "medium" | "high";
};

export type VoiceProfile = VoiceMetrics & {
  voicePromptText: string;
};

type WeightedDoc = { text: string; weight: number };

// ──────────────────────────────────────────────────────────────────────────
// Training corpus fetch
// ──────────────────────────────────────────────────────────────────────────

function pbDateNDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
}

export async function fetchTrainingCorpus(userId: string): Promise<WeightedDoc[]> {
  if (!userId) return [];
  let token: string;
  let url: string;
  try {
    token = await getAdminToken();
    url = pbUrl();
  } catch {
    return [];
  }
  const since = pbDateNDaysAgo(TRAINING_WINDOW_DAYS);
  const escapedUser = pbEscape(userId);

  // Pull docs + signals in parallel.
  const [docs, patterns] = await Promise.all([
    (async () => {
      try {
        const f = `(user='${escapedUser}' && created>='${since}')`;
        const r = await fetch(
          `${url}/api/collections/documents/records?filter=${encodeURIComponent(f)}&sort=-created&perPage=500&fields=id,output`,
          { headers: { Authorization: token } }
        );
        if (!r.ok) return [] as Array<{ id: string; output?: string }>;
        const d = (await r.json()) as { items?: Array<{ id: string; output?: string }> };
        return d.items ?? [];
      } catch { return []; }
    })(),
    (async () => {
      try {
        const f = `(user='${escapedUser}' && created>='${since}')`;
        const r = await fetch(
          `${url}/api/collections/vault_patterns/records?filter=${encodeURIComponent(f)}&perPage=500&fields=document_id,signal`,
          { headers: { Authorization: token } }
        );
        if (!r.ok) return [] as Array<{ document_id: string; signal: string }>;
        const d = (await r.json()) as { items?: Array<{ document_id: string; signal: string }> };
        return d.items ?? [];
      } catch { return []; }
    })(),
  ]);

  // Doc → strongest signal weight.
  const signalMap = new Map<string, number>();
  for (const p of patterns) {
    const w = SAMPLE_WEIGHTS[p.signal] ?? UNSIGNALED_WEIGHT;
    const current = signalMap.get(p.document_id) ?? 0;
    if (w > current) signalMap.set(p.document_id, w);
  }

  return docs
    .filter((d) => d.output && d.output.trim().length > 0)
    .map((d) => ({
      text: d.output as string,
      weight: signalMap.get(d.id) ?? UNSIGNALED_WEIGHT,
    }));
}

// ──────────────────────────────────────────────────────────────────────────
// Pure-JS metric extraction
// ──────────────────────────────────────────────────────────────────────────

const CORPORATE_JARGON = [
  "synergy", "leverage", "circle back", "deep dive", "low-hanging fruit",
  "move the needle", "touch base", "boil the ocean", "actionable insights",
  "stakeholder", "thought leadership", "value-add", "best of breed",
  "robust", "seamless", "frictionless", "innovative", "disrupt", "pivot",
  "scalable", "optimize", "streamline", "empower", "ecosystem", "holistic",
  "paradigm", "bandwidth", "deliverable", "ideate", "operationalize",
];

const POSITIVE_WORDS = new Set([
  "great", "excellent", "love", "amazing", "wonderful", "fantastic",
  "awesome", "best", "good", "happy", "excited", "appreciate", "thank",
  "thanks", "thrilled", "delighted", "perfect", "win", "wins", "winning",
]);

const NEGATIVE_WORDS = new Set([
  "bad", "poor", "terrible", "awful", "hate", "disappointed", "frustrated",
  "wrong", "fail", "failed", "issue", "problem", "concern", "sorry",
  "unfortunately", "regret", "broken", "worst", "lose", "lost",
]);

const EMOJI_REGEX =
  /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}]/gu;

function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")     // fenced code
    .replace(/`[^`]*`/g, " ")             // inline code
    .replace(/!\[.*?\]\(.*?\)/g, " ")     // images
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")   // links
    .replace(/[#*_>~]/g, " ");            // structural marks
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function topN(values: string[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([v]) => v);
}

function firstWords(text: string, n: number): string {
  return text.split(/\s+/).filter(Boolean).slice(0, n).join(" ");
}

function lastWords(text: string, n: number): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  return tokens.slice(Math.max(0, tokens.length - n)).join(" ");
}

export function extractVoiceMetrics(docs: WeightedDoc[]): VoiceMetrics | null {
  if (docs.length < MIN_DOCS_FOR_PROFILE) return null;
  const cleanedDocs = docs.map((d) => ({ text: stripMarkdown(d.text), weight: d.weight }));
  const allText = cleanedDocs.map((d) => d.text).join("\n\n");
  if (!allText.trim()) return null;

  const allWords = wordCount(allText);
  const charBase = Math.max(1, allText.length / 1000);

  // 1. avgSentenceLength — weighted average per-doc.
  let weightedSentenceLen = 0;
  let totalWeight = 0;
  for (const d of cleanedDocs) {
    const sentences = splitSentences(d.text);
    if (sentences.length === 0) continue;
    const lens = sentences.map((s) => wordCount(s));
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    weightedSentenceLen += avg * d.weight;
    totalWeight += d.weight;
  }
  const avgSentenceLength = totalWeight > 0 ? weightedSentenceLen / totalWeight : 0;

  // 2. formalityScore — sentence length + contraction rate + personal-pronoun rate.
  const contractionMatches = allText.match(/\b\w+'(ll|s|re|ve|d|t|m)\b/gi) ?? [];
  const contractionRate = allWords > 0 ? contractionMatches.length / allWords : 0;
  const personalMatches = allText.match(/\b(I|me|my|mine|we|us|our|ours|you|your|yours)\b/gi) ?? [];
  const personalRate = allWords > 0 ? personalMatches.length / allWords : 0;
  const sentLenScore = Math.min(1, Math.max(0, (avgSentenceLength - 8) / 22)); // 8→0, 30→1
  const contractionPenalty = Math.min(1, contractionRate * 50);
  const personalPenalty = Math.min(1, personalRate * 20);
  const formalityScore = clamp(
    sentLenScore * 0.4 + (1 - contractionPenalty) * 0.3 + (1 - personalPenalty) * 0.3,
    0, 1
  );

  // 3. emojiFrequency — per 1000 chars.
  const emojiCount = (allText.match(EMOJI_REGEX) ?? []).length;
  const emojiFrequency = emojiCount / charBase;

  // 4–5. Common openers / closers — first/last 3 words of each doc.
  const openers = cleanedDocs.map((d) => firstWords(d.text, 3));
  const closers = cleanedDocs.map((d) => lastWords(d.text, 3));
  const commonOpeners = topN(openers, 5);
  const commonClosers = topN(closers, 5);

  // 6. positivityScore — lexicon-based; 0.5 neutral when no signal.
  const tokens = allText.toLowerCase().split(/\W+/).filter(Boolean);
  let pos = 0;
  let neg = 0;
  for (const t of tokens) {
    if (POSITIVE_WORDS.has(t)) pos++;
    if (NEGATIVE_WORDS.has(t)) neg++;
  }
  const positivityScore = pos + neg > 0 ? pos / (pos + neg) : 0.5;

  // 7. punctuationStyle.
  const emDashCount = (allText.match(/—/g) ?? []).length + (allText.match(/--/g) ?? []).length;
  const exclamCount = (allText.match(/!/g) ?? []).length;
  const semicolonCount = (allText.match(/;/g) ?? []).length;
  const ellipsisCount = (allText.match(/\.\.\.|…/g) ?? []).length;
  const withOxford = (allText.match(/,\s+\w+\s+and\b/g) ?? []).length;
  const withoutOxford = (allText.match(/\w+\s+and\s+\w+/g) ?? []).length - withOxford;
  const oxfordTotal = withOxford + Math.max(0, withoutOxford);
  const oxfordCommaUsage = oxfordTotal > 0 ? withOxford / oxfordTotal : 0;

  const punctuationStyle: PunctuationStyle = {
    emDashPer1000: emDashCount / charBase,
    exclamationPer1000: exclamCount / charBase,
    semicolonPer1000: semicolonCount / charBase,
    ellipsisPer1000: ellipsisCount / charBase,
    oxfordCommaUsage,
  };

  // 8. bannedWords — corporate jargon the user has never used.
  const lowerText = allText.toLowerCase();
  const bannedWords = CORPORATE_JARGON.filter((w) => !lowerText.includes(w));

  // 9. documentCount + confidence.
  const documentCount = cleanedDocs.length;
  const confidence: VoiceMetrics["confidence"] =
    documentCount >= MIN_DOCS_FOR_HIGH ? "high" :
    documentCount >= MIN_DOCS_FOR_MEDIUM ? "medium" : "low";

  return {
    avgSentenceLength,
    formalityScore,
    emojiFrequency,
    commonOpeners,
    commonClosers,
    bannedWords,
    positivityScore,
    punctuationStyle,
    documentCount,
    confidence,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ──────────────────────────────────────────────────────────────────────────
// Natural-language rendering
// ──────────────────────────────────────────────────────────────────────────

export function renderVoicePrompt(m: VoiceMetrics): string {
  const lines: string[] = [];

  // Sentence length
  if (m.avgSentenceLength > 0) {
    const lenDesc =
      m.avgSentenceLength < 12 ? "short and punchy" :
      m.avgSentenceLength < 18 ? "medium length, natural rhythm" :
                                 "long and considered";
    lines.push(`Sentence length: ${lenDesc} (avg ${Math.round(m.avgSentenceLength)} words).`);
  }

  // Formality
  const formalityDesc =
    m.formalityScore < 0.4 ? "informal, conversational, uses contractions freely" :
    m.formalityScore < 0.65 ? "professional but approachable" :
                              "formal and polished";
  lines.push(`Tone: ${formalityDesc}.`);

  // Positivity
  const posDesc =
    m.positivityScore < 0.4 ? "balanced or critical — does not over-cheerlead" :
    m.positivityScore <= 0.6 ? "neutral and measured" :
                               "warm and enthusiastic";
  lines.push(`Mood: ${posDesc}.`);

  // Emoji
  if (m.emojiFrequency === 0) {
    lines.push(`Emoji: never.`);
  } else if (m.emojiFrequency < 2) {
    lines.push(`Emoji: rare (less than 1 per 500 words).`);
  } else if (m.emojiFrequency < 10) {
    lines.push(`Emoji: occasional, used for emphasis.`);
  } else {
    lines.push(`Emoji: frequent, expressive.`);
  }

  // Openers
  if (m.commonOpeners.length > 0) {
    const quoted = m.commonOpeners.slice(0, 3).map((s) => `"${s}"`).join(", ");
    lines.push(`Common openers: ${quoted}.`);
  }

  // Closers
  if (m.commonClosers.length > 0) {
    const quoted = m.commonClosers.slice(0, 3).map((s) => `"${s}"`).join(", ");
    lines.push(`Common closers: ${quoted}.`);
  }

  // Punctuation
  const punctNotes: string[] = [];
  if (m.punctuationStyle.emDashPer1000 > 0.5) punctNotes.push("heavy em-dash use");
  else if (m.punctuationStyle.emDashPer1000 > 0.1) punctNotes.push("occasional em-dashes");
  if (m.punctuationStyle.exclamationPer1000 > 2) punctNotes.push("uses exclamation points liberally");
  else if (m.punctuationStyle.exclamationPer1000 < 0.2) punctNotes.push("rarely uses exclamation points");
  if (m.punctuationStyle.semicolonPer1000 > 0.5) punctNotes.push("comfortable with semicolons");
  else if (m.punctuationStyle.semicolonPer1000 < 0.05) punctNotes.push("avoids semicolons");
  if (m.punctuationStyle.oxfordCommaUsage > 0.7) punctNotes.push("uses Oxford commas");
  else if (m.punctuationStyle.oxfordCommaUsage < 0.3) punctNotes.push("no Oxford commas");
  if (punctNotes.length > 0) {
    lines.push(`Punctuation: ${punctNotes.join(", ")}.`);
  }

  // Banned jargon
  if (m.bannedWords.length > 0) {
    const shown = m.bannedWords.slice(0, 8).map((w) => `"${w}"`).join(", ");
    lines.push(`Avoid: ${shown}.`);
  }

  if (lines.length === 0) return "";

  const confNote =
    m.confidence === "low"
      ? "\n(Voice fingerprint is still warming up — apply lightly.)"
      : "";

  return [
    "--- USER VOICE FINGERPRINT ---",
    ...lines,
    "--- END VOICE FINGERPRINT ---",
    "",
    `Internalize this voice. Write as this person would. Do not quote the fingerprint; become them.${confNote}`,
  ].join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Persistence
// ──────────────────────────────────────────────────────────────────────────

type ProfileRow = { id: string } & VoiceProfile & { updated?: string };

async function upsertVoiceProfile(userId: string, profile: VoiceProfile): Promise<void> {
  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const existing = await pbFirst<{ id: string }>(
      "vault_voice_profile",
      `(user='${pbEscape(userId)}')`,
      token,
      { fields: "id" }
    );

    const body = JSON.stringify({
      user: userId,
      avgSentenceLength: profile.avgSentenceLength,
      formalityScore: profile.formalityScore,
      emojiFrequency: profile.emojiFrequency,
      commonOpeners: profile.commonOpeners,
      commonClosers: profile.commonClosers,
      bannedWords: profile.bannedWords,
      positivityScore: profile.positivityScore,
      punctuationStyle: profile.punctuationStyle,
      documentCount: profile.documentCount,
      confidence: profile.confidence,
      voicePromptText: profile.voicePromptText,
    });

    if (existing) {
      await fetch(`${url}/api/collections/vault_voice_profile/records/${existing.id}`, {
        method: "PATCH",
        headers: adminHeaders(token),
        body,
      });
    } else {
      await fetch(`${url}/api/collections/vault_voice_profile/records`, {
        method: "POST",
        headers: adminHeaders(token),
        body,
      });
    }
  } catch {
    /* fail-safe — caller never depends on this throwing */
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Public surface — recompute + read
// ──────────────────────────────────────────────────────────────────────────

export type RecomputeResult =
  | { ok: true; profile: VoiceProfile }
  | { ok: false; reason: string };

/**
 * Recompute one user's voice profile end-to-end. Fail-safe — returns a
 * structured result instead of throwing so the V6 patterns hook and the
 * nightly cron can both call this without try/catch.
 */
export async function recomputeVoiceProfile(userId: string): Promise<RecomputeResult> {
  if (!userId) return { ok: false, reason: "missing_user_id" };
  const corpus = await fetchTrainingCorpus(userId);
  if (corpus.length < MIN_DOCS_FOR_PROFILE) {
    return { ok: false, reason: "insufficient_training_data" };
  }
  const metrics = extractVoiceMetrics(corpus);
  if (!metrics) return { ok: false, reason: "extraction_failed" };
  const voicePromptText = renderVoicePrompt(metrics);
  const profile: VoiceProfile = { ...metrics, voicePromptText };
  await upsertVoiceProfile(userId, profile);
  return { ok: true, profile };
}

/**
 * Read the stored profile for a user. Returns null if absent.
 */
export async function fetchVoiceProfile(userId: string): Promise<ProfileRow | null> {
  if (!userId) return null;
  try {
    const token = await getAdminToken();
    return await pbFirst<ProfileRow>(
      "vault_voice_profile",
      `(user='${pbEscape(userId)}')`,
      token
    );
  } catch {
    return null;
  }
}

/**
 * Return the pre-rendered voice block ready for injection into a system
 * prompt, OR "" when:
 *   • department is not in the voice-applicable allow-list (legal / finance
 *     / operations skip), OR
 *   • profile is absent (user has no training corpus yet), OR
 *   • profile is low-confidence (< 5 docs — too noisy to enforce).
 *
 * Single PB read; safe to call on every agent request.
 */
export async function getVoiceBlock(
  userId: string | undefined,
  department: string | undefined
): Promise<string> {
  if (!userId || !isVoiceApplicableDepartment(department)) return "";
  const profile = await fetchVoiceProfile(userId);
  if (!profile) return "";
  if (profile.confidence === "low") return "";
  if (!profile.voicePromptText) return "";
  return `\n\n${profile.voicePromptText}`;
}

/**
 * Recompute voice profiles for every user who has produced a doc in the
 * last `daysActive` days. Called by the nightly scheduled worker.
 * Returns a tally for logging.
 */
export async function recomputeActiveUserVoiceProfiles(
  daysActive = 7
): Promise<{ scanned: number; ok: number; skipped: number; failed: number }> {
  const tally = { scanned: 0, ok: 0, skipped: 0, failed: 0 };
  let token: string;
  let url: string;
  try {
    token = await getAdminToken();
    url = pbUrl();
  } catch {
    return tally;
  }
  try {
    const since = pbDateNDaysAgo(daysActive);
    // Pull distinct active users via the documents collection.
    const res = await fetch(
      `${url}/api/collections/documents/records?filter=${encodeURIComponent(`(created>='${since}')`)}&perPage=500&fields=user&sort=-created`,
      { headers: { Authorization: token } }
    );
    if (!res.ok) return tally;
    const data = (await res.json()) as { items?: Array<{ user: string }> };
    const userIds = Array.from(new Set((data.items ?? []).map((d) => d.user).filter(Boolean)));
    tally.scanned = userIds.length;

    // Sequential — keeps PB and Vercel function memory bounded. At SMB scale
    // this is fine; if it becomes slow, parallelise with a small p-limit.
    for (const u of userIds) {
      const r = await recomputeVoiceProfile(u);
      if (r.ok) tally.ok++;
      else if (r.reason === "insufficient_training_data") tally.skipped++;
      else tally.failed++;
    }
  } catch {
    /* tally returned as-is */
  }
  return tally;
}
