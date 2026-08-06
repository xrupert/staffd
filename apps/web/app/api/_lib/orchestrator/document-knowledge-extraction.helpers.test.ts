import { describe, expect, it } from "vitest";
import { documentCandidateToObservation, type BusinessDocumentSource } from "./document-knowledge-extraction";

const baseSource: BusinessDocumentSource = {
  id: " doc-1 ",
  ownerId: " owner-1 ",
  title: "  Customer   refund   policy  ",
  uri: "vault://doc-1",
  uploadedAt: "2026-08-06T13:00:00.000Z",
};

describe("document extraction normalization", () => {
  it("normalizes whitespace and timestamps through the public contract", () => {
    const record = documentCandidateToObservation(baseSource, {
      kind: "policy",
      subject: "  Refund   approval ",
      statement: "  Refunds   above $500 require owner approval. ",
      confidence: 0.9,
      usageScopes: [" finance ", "finance"],
    });

    expect(record.ownerId).toBe("owner-1");
    expect(record.subject).toBe("Refund approval");
    expect(record.statement).toBe("Refunds above $500 require owner approval.");
    expect(record.sources[0]?.title).toBe("Customer refund policy");
    expect(record.sources[0]?.verifiedAt).toBe("2026-08-06T13:00:00.000Z");
    expect(record.usageScopes).toEqual(["finance"]);
  });

  it("rejects invalid source timestamps through the public contract", () => {
    expect(() => documentCandidateToObservation(
      { ...baseSource, uploadedAt: "not-a-date" },
      {
        kind: "fact",
        subject: "Company name",
        statement: "Example Company",
        confidence: 0.8,
        usageScopes: ["operations"],
      },
    )).toThrow("Document timestamp is invalid");
  });
});
