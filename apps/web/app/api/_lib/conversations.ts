/**
 * Conversation thread helpers (Phase 25).
 *
 * One responsibility today: ensure a `conversation_threads` row exists when
 * a brand-new `thread_id` shows up in a turn write. Fire-and-forget; never
 * blocks the turn-persistence pipeline. Subsequent turns under the same
 * thread_id are no-ops via the unique index.
 *
 * The name is derived from the first user-role turn's content, truncated
 * to 80 chars. User can rename later via PATCH /api/conversations/[id].
 */

import { adminHeaders, getAdminToken, pbEscape, pbFirst, pbUrl } from "./pb";

const NAME_DEFAULT_MAX = 80;

function deriveThreadName(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return "Untitled thread";
  return clean.length <= NAME_DEFAULT_MAX ? clean : clean.slice(0, NAME_DEFAULT_MAX - 1) + "…";
}

export type EnsureThreadOpts = {
  userId: string;
  threadId: string;
  /** Used to derive the default name only on the FIRST turn. */
  firstTurnContent: string;
};

/**
 * Ensure a `conversation_threads` row exists for the given (user, thread_id).
 * Idempotent — does nothing when the thread is already known.
 * Fail-safe — any PB error is swallowed; the conversation turn still writes.
 */
export async function ensureConversationThreadRow(opts: EnsureThreadOpts): Promise<void> {
  if (!opts.userId || !opts.threadId) return;
  try {
    const token = await getAdminToken();
    const url = pbUrl();

    // Cheap existence check via the unique index.
    const existing = await pbFirst<{ id: string }>(
      "conversation_threads",
      `(thread_id='${pbEscape(opts.threadId)}')`,
      token,
      { fields: "id" }
    );
    if (existing) return;

    const name = deriveThreadName(opts.firstTurnContent);
    await fetch(`${url}/api/collections/conversation_threads/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        user: opts.userId,
        thread_id: opts.threadId,
        name,
        archived: false,
      }),
    });
  } catch {
    /* fire-and-forget */
  }
}
