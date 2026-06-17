/**
 * Contacts CSV parser (W95.3) — dependency-free, RFC-4180-ish.
 *
 * Cold-start ingestion: an SMB owner uploads their existing contact list so
 * their staff have context from day one. Kept small and in-memory on purpose —
 * /api/upload/contacts caps the file at 5 MB, so the whole document fits in
 * memory comfortably; true streaming is unnecessary under that cap.
 *
 * Recognizes (case-insensitive, any order): name (required), email, phone,
 * context. Unknown columns are ignored. Quoted fields may contain commas,
 * newlines, and escaped double-quotes (""). Blank rows are skipped. A row
 * missing the required `name` is reported in `errors` (1-based line number,
 * header included) without dropping the good rows.
 */

export type ParsedContact = { name: string; email: string; phone: string; context: string };
export type CsvRowError = { row: number; reason: string };
export type CsvParseResult = { rows: ParsedContact[]; errors: CsvRowError[]; headers: string[] };

const FIELD_ALIASES: Record<keyof ParsedContact, string[]> = {
  name: ["name", "full name", "contact", "contact name"],
  email: ["email", "e-mail", "email address"],
  phone: ["phone", "phone number", "mobile", "tel", "telephone"],
  context: ["context", "notes", "note", "description"],
};

/** Tokenize CSV text into an array of records (each an array of raw cells). */
function tokenize(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let started = false; // whether the current record has any content/cells yet

  const pushField = () => { record.push(field); field = ""; };
  const pushRecord = () => { pushField(); records.push(record); record = []; started = false; };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }      // escaped quote
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; started = true; continue; }
    if (c === ",") { pushField(); started = true; continue; }
    if (c === "\r") continue;                                  // swallow CR (CRLF → LF)
    if (c === "\n") { if (started || field.length) pushRecord(); continue; }
    field += c;
    started = true;
  }
  if (started || field.length) pushRecord();                   // trailing record w/o newline
  return records;
}

function isBlank(cells: string[]): boolean {
  return cells.every((c) => c.trim() === "");
}

export function parseContactsCsv(text: string): CsvParseResult {
  const records = tokenize(text);
  if (records.length === 0) return { rows: [], errors: [{ row: 1, reason: "empty file" }], headers: [] };

  const headerCells = records[0]!.map((h) => h.trim());
  const headersLower = headerCells.map((h) => h.toLowerCase());

  // Resolve each field to a column index via its aliases.
  const colOf = (field: keyof ParsedContact): number => {
    for (const alias of FIELD_ALIASES[field]) {
      const idx = headersLower.indexOf(alias);
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const idx = {
    name: colOf("name"),
    email: colOf("email"),
    phone: colOf("phone"),
    context: colOf("context"),
  };

  if (idx.name === -1) {
    return { rows: [], errors: [{ row: 1, reason: "no recognizable 'name' column in header" }], headers: headerCells };
  }

  const rows: ParsedContact[] = [];
  const errors: CsvRowError[] = [];
  const cell = (cells: string[], i: number) => (i === -1 ? "" : (cells[i] ?? "").trim());

  for (let r = 1; r < records.length; r++) {
    const cells = records[r]!;
    if (isBlank(cells)) continue;                              // skip blank rows
    const name = cell(cells, idx.name);
    if (!name) { errors.push({ row: r + 1, reason: "missing required 'name'" }); continue; }
    rows.push({
      name,
      email: cell(cells, idx.email),
      phone: cell(cells, idx.phone),
      context: cell(cells, idx.context),
    });
  }

  return { rows, errors, headers: headerCells };
}
