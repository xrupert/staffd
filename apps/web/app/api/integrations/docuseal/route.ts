/**
 * Docuseal integration — submits a document for e-signature.
 * Requires DOCUSEAL_URL + DOCUSEAL_API_KEY env vars.
 * Returns 503 with setup instructions when not yet configured.
 */

import { recordDecision } from "../../_lib/vault/outcomes";

const DOCUSEAL_URL = process.env.DOCUSEAL_URL ?? "";
const DOCUSEAL_KEY = process.env.DOCUSEAL_API_KEY ?? "";

export async function POST(req: Request) {
  if (!DOCUSEAL_URL || !DOCUSEAL_KEY) {
    return Response.json(
      {
        error: "not_configured",
        message:
          "E-signatures are not set up yet. Deploy Docuseal and add DOCUSEAL_URL and DOCUSEAL_API_KEY to your environment variables.",
      },
      { status: 503 }
    );
  }

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
