"use client";

/**
 * export_document handler (W64 B1) — wraps the existing docx export with
 * the SA-locked clipboard fallback (Decision 6): if export throws, the
 * content lands on the clipboard and the surface gets a plain-language
 * notice instead of a broken click.
 *
 * Shared by DepartmentRoom and CommandCenter; the PDF path (window.print)
 * stays a DeptRoom static-toolbar concern — print CSS is page-scoped.
 */

import { exportToDocx } from "../../app/components/DocExport";

export async function runExportDocument(
  output: string,
  businessName: string | undefined,
  notify: (message: string) => void
): Promise<void> {
  if (!output?.trim()) {
    console.warn("[W64] export_document invoked with empty output — noop");
    return;
  }
  try {
    await exportToDocx(output, businessName);
  } catch (err) {
    console.warn("[W64] export failed — falling back to clipboard:", err);
    try {
      await navigator.clipboard.writeText(output);
      notify("Document export failed — the content is copied to your clipboard instead.");
    } catch {
      notify("Document export failed. Copy the work manually from the output above.");
    }
  }
}
