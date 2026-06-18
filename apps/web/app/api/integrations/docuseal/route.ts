/**
 * Docuseal integration — submits a document for e-signature.
 * Requires DOCUSEAL_URL + DOCUSEAL_API_KEY env vars.
 * Returns 503 with setup instructions when not yet configured.
 *
 * ⚠️ OPERATOR-ONLY per Standard #22. Customer-facing signature actions go through
 * /api/intent/commit (send_for_signature → review → docuseal_send_worker, the
 * per-customer mirror path, W95.6.x/.7.1). Do not call this from customer UI.
 */

import { recordDecision } from "../../_lib/vault/outcomes";
import { resolveCredentials } from "../../_lib/integrations/resolve";

export async function POST(req: Request) {
  try {
    const { name, documentContent, signerEmail, signerName, userId } = (await req.json()) as {
      name: string;
      documentContent: string;
      signerEmail: string;
      signerName?: string;
      userId?: string; // FC-3 — when present, the outcome is recorded to the vault
    };

    if (!name?.trim() || !documentContent?.trim() || !signerEmail?.trim()) {
      return Response.json(
        { error: "name, documentContent, and signerEmail are required" },
        { status: 400 }
      );
    }

    // W91 — per-user creds (own → operator fallback). No direct env reads.
    const creds = await resolveCredentials({ id: userId ?? "" }, "docuseal");
    if (!creds) {
      return Response.json(
        { error: "not_configured", message: "E-signatures aren't connected yet. Add your Docuseal URL and API key in Settings → Connect Your Tools." },
        { status: 503 }
      );
    }
    const DOCUSEAL_URL = creds.url.replace(/\/$/, ""), DOCUSEAL_KEY = creds.key;

    // Create a submission in Docuseal
    const res = await fetch(`${DOCUSEAL_URL}/api/submissions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": DOCUSEAL_KEY,
      },
      body: JSON.stringify({
        template_id: null, // will use inline HTML
        send_email: true,
        submitters: [
          {
            role: "First Party",
            email: signerEmail,
            name: signerName ?? "",
          },
        ],
        // Pass document content as plain template body
        source: documentContent,
        name,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: "Docuseal error", detail: text }, { status: 502 });
    }

    const data = (await res.json()) as { id?: number; slug?: string };

    // FC-3 — a document sent for signature is a real business event; record it
    // so the CEO brief reflects momentum. Fire-and-forget.
    if (userId) {
      void recordDecision({
        userId,
        decision_kind: "contract_sent_for_signature",
        title: `Sent "${name}" for signature`,
        source_kind: "docuseal",
        source_id: data.id ? String(data.id) : undefined,
      });
    }

    return Response.json({
      success: true,
      submissionId: data.id,
      signingUrl: data.slug ? `${DOCUSEAL_URL}/s/${data.slug}` : null,
    });
  } catch (err) {
    console.error("Docuseal route error:", err);
    return Response.json({ error: "Failed to create submission" }, { status: 500 });
  }
}
