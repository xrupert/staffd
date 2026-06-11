/**
 * W49 Tests 5, 8 — Library surfaces CEO work; the control persistence
 * pattern (DepartmentRoom's client-side saveDocument) is shape-pinned so
 * a regression to the canonical pattern is caught.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

void React;

vi.mock("../../lib/pb", () => ({
  default: {
    authStore: { record: { id: "user-1" }, isValid: true, token: "tok" },
    collection: (name: string) => ({
      getList: async () => {
        if (name === "documents") {
          return {
            items: [{
              id: "doc_ceo_1",
              department: "ceo",
              agent_name: "Chief of Staff",
              prompt: "Weekly briefing — June 11, 2026",
              output: "## Weekly Briefing\n\nPersisted brief content.",
              created: "2026-06-11 08:00:00",
            }],
          };
        }
        return { items: [] };
      },
    }),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import LibraryPage from "../../app/dashboard/library/page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Library — CEO work surfaces (W49 Test 5)", () => {
  it("a department='ceo' document renders, and the CEO filter tab exists", async () => {
    const { container, findByText } = render(<LibraryPage />);
    expect(await findByText(/Weekly briefing — June 11, 2026/)).toBeTruthy();
    // CEO filter tab present (pre-existing — pinned so it can't silently vanish).
    const ceoTab = Array.from(container.querySelectorAll("button"))
      .find((b) => /ceo/i.test(b.textContent ?? ""));
    expect(ceoTab).toBeTruthy();
    await waitFor(() => expect(container.textContent).toContain("Weekly briefing"));
  });
});

describe("control pattern pin (W49 Test 8)", () => {
  it("DepartmentRoom's canonical saveDocument shape is unchanged", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "app", "components", "DepartmentRoom.tsx"),
      "utf8"
    );
    // The canonical client-side persistence shape — /api/agent stays
    // persistence-free on the server; clients own the documents write.
    expect(src).toContain('await pb.collection("documents").create({');
    expect(src).toContain("agent_name: activeAgent?.name ?? department,");
    expect(src).toMatch(/user: userId,\s*\n\s*department,/);
  });
});
