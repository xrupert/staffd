"use client";

/**
 * DraftEditor — Phase 24's Live Draft Editing surface.
 *
 * Toggles between a Markdown-rendered view (default) and a raw-Markdown
 * textarea edit mode. Save patches the document via /api/documents/[id]/save-edit
 * (which also fires a force re-index into the Vault). Regenerate constructs
 * a "build on my edits" prompt and bubbles it up to the caller — caller
 * routes back through /api/agent.
 *
 * Stateless w.r.t. the underlying document data — controlled by parent via
 * `content` + `onContentChange`. This keeps the editor composable across
 * DepartmentRoom, AgentPage, and any future surface.
 */

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import pb from "../../lib/pb";

type Props = {
  /** Current rendered content. Parent owns the source of truth. */
  content: string;
  /** When set, Save is enabled — Save patches this document id. */
  documentId?: string | null;
  /**
   * Called after a successful save with the saved text so the parent can
   * update its `content` state to the persisted value. The text will equal
   * what was passed to save (no server-side mutation today).
   */
  onSaved?: (savedContent: string) => void;
  /**
   * Called when the user clicks "Regenerate with my edits." Parent is
   * responsible for routing back through /api/agent. The text passed is
   * the user's edited draft (NOT the original).
   */
  onRegenerate?: (editedContent: string) => void;
  /**
   * Disable Regenerate when the parent's generation pipeline is mid-flight
   * (avoids overlap with the current LLM call).
   */
  regenerateDisabled?: boolean;
  /** Optional className for the wrapper div. */
  className?: string;
};

export default function DraftEditor({
  content,
  documentId,
  onSaved,
  onRegenerate,
  regenerateDisabled,
  className,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(content);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Keep local `draft` in sync when parent's content changes from outside
  // (e.g., a new generation completes). Only when we're NOT actively editing.
  useEffect(() => {
    if (!editing) setDraft(content);
  }, [content, editing]);

  const canSave = !!documentId;

  async function save() {
    if (!documentId) return;
    setSaving(true);
    setMsg(null);
    try {
      const userId = pb.authStore.record?.id ?? "";
      const token = pb.authStore.token;
      if (!userId || !token) {
        setMsg({ ok: false, text: "Not signed in." });
        return;
      }
      const res = await fetch(`/api/documents/${encodeURIComponent(documentId)}/save-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, pbToken: token, content: draft }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        onSaved?.(draft);
        setEditing(false);
        setMsg({ ok: true, text: "Saved. Your staff will refresh their memory in a moment." });
      } else {
        setMsg({ ok: false, text: data.error ?? "save_failed" });
      }
    } catch {
      setMsg({ ok: false, text: "network_error" });
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(content);
    setEditing(false);
    setMsg(null);
  }

  function regenerate() {
    if (regenerateDisabled || !onRegenerate) return;
    onRegenerate(draft);
    setEditing(false);
    setMsg({ ok: true, text: "Regenerating from your edits…" });
  }

  return (
    <div className={className}>
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={saving}
            spellCheck
            className="w-full rounded-xl px-4 py-3 text-sm outline-none resize-vertical"
            style={{
              minHeight: "320px",
              background: "#0D0D14",
              border: "1px solid #2A2A38",
              color: "#F0F0F8",
              lineHeight: 1.7,
              fontFamily: "inherit",
              caretColor: "#5B21E8",
            }}
            placeholder="Edit the draft. Markdown supported."
          />
          <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => void save()}
                disabled={saving || !canSave}
                className="btn-primary px-4 py-1.5 rounded-lg text-xs font-semibold text-white"
                style={{ opacity: (saving || !canSave) ? 0.5 : 1 }}
                title={canSave ? "" : "Save once your first generation has been persisted"}
              >
                {saving ? "Saving…" : "Save"}
              </button>
              {onRegenerate && (
                <button
                  onClick={() => regenerate()}
                  disabled={saving || regenerateDisabled}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{
                    background: "rgba(91,33,232,0.10)",
                    border: "1px solid rgba(91,33,232,0.25)",
                    color: "#A07BFF",
                    opacity: (saving || regenerateDisabled) ? 0.5 : 1,
                  }}
                  title="Build a fresh draft on top of your edits"
                >
                  Regenerate with my edits
                </button>
              )}
            </div>
            <button
              onClick={cancel}
              disabled={saving}
              className="text-xs transition-colors hover:text-white"
              style={{ color: "#5A5A70", opacity: saving ? 0.5 : 1 }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="agent-output">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
          <div className="flex items-center justify-end gap-3 mt-3">
            <button
              onClick={() => { setEditing(true); setMsg(null); }}
              className="text-xs font-semibold transition-colors"
              style={{
                color: "#A07BFF",
                background: "rgba(91,33,232,0.08)",
                border: "1px solid rgba(91,33,232,0.20)",
                padding: "4px 10px",
                borderRadius: "6px",
              }}
              title="Edit this draft, then save or regenerate"
            >
              Edit draft
            </button>
          </div>
        </>
      )}

      {msg && (
        <p className="text-xs mt-2" style={{ color: msg.ok ? "#22C55E" : "#EF4444" }}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
