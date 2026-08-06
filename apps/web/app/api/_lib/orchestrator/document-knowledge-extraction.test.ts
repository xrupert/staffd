import { describe, expect, it } from "vitest";
import {
  documentCandidateToObservation,
  documentCandidatesToObservations,
  type BusinessDocumentSource,
} from "./document-knowledge-extraction";

const source: BusinessDocumentSource = {
  id: "doc-1",
  ownerId: "owner-1",
  title: "Customer refund policy",
  uri: "vault://doc-1",
  uploadedAt: "2026-08-06T13:00:00.000Z",
};

describe("document knowledge extraction", () => {
  it("creates observed knowledge with document provenance", () => {
    const record = documentCandidateToObservation(source, {
      kind: "policy",
      subject: "Refund approval",
      statement: "Refunds above $500 require owner approval.",
      confidence: 0.9,
      usageScopes: ["finance", "support"],
    });

    expect(record.stage).toBe("observed");
    expect(record.ownerId).toBe("owner-1");
    expect(record.sources[0]?.sourceType).toBe("business_document");
    expect(record.approvedBy).toBeUndefined();
  });

  it("never treats extracted text as approved knowledge", () => {
    const record = documentCandidateToObservation(source, {
      kind: "rule",
      subject: "Response time",
      statement: "Customer messages should receive a reply within one business day.",
      confidence: 1,
      usageScopes: ["support"],
    });

    expect(record.stage).toBe("observed");
    expect(record.approvedAt).toBeUndefined();
  });

  it("rejects unscoped and unbounded extraction", () => {
    expect(() => documentCandidateToObservation(source, {
      kind: "fact",
      subject: "Company name",
      statement: "Example Company",
      confidence: 0.8,
      usageScopes: [],
    })).toThrow("usage scope");

    expect(() => documentCandidatesToObservations(source, Array.from({ length: 101 }, () => ({
      kind: "fact" as const,
      subject: "Fact",
      statement: "Value",
      confidence: 0.5,
      usageScopes: ["operations"],
    })))).toThrow("candidate limit");
  });
});
