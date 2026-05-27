import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";

// Parse inline markdown: **bold**, *italic*, `code`
function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`(.+?)`|([^*_`]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) runs.push(new TextRun({ text: match[1], bold: true, italics: true }));
    else if (match[2]) runs.push(new TextRun({ text: match[2], bold: true }));
    else if (match[3]) runs.push(new TextRun({ text: match[3], italics: true }));
    else if (match[4]) runs.push(new TextRun({ text: match[4], italics: true }));
    else if (match[5]) runs.push(new TextRun({ text: match[5], font: { name: "Courier New" }, size: 19 }));
    else if (match[6]) runs.push(new TextRun({ text: match[6] }));
  }
  return runs.length ? runs : [new TextRun({ text: "" })];
}

function stripMarkdown(text: string): string {
  return text.replace(/\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`(.+?)`/g, "$1$2$3$4$5");
}

// Parse a markdown table into a docx Table
function parseTable(lines: string[]): Table {
  const rows = lines
    .filter((l) => l.startsWith("|"))
    .filter((l) => !/^\|[-| :]+\|$/.test(l.trim()));

  const docxRows = rows.map((row, rowIdx) => {
    const cells = row
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    return new TableRow({
      children: cells.map(
        (cell) =>
          new TableCell({
            children: [
              new Paragraph({
                children: parseInline(cell),
                style: rowIdx === 0 ? "TableHeader" : "TableBody",
              }),
            ],
            shading: rowIdx === 0 ? { fill: "F0F0F0" } : undefined,
          })
      ),
    });
  });

  return new Table({
    rows: docxRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

export async function exportToDocx(content: string, businessName?: string): Promise<void> {
  const lines = content.split("\n");
  const children: (Paragraph | Table)[] = [];

  // Company header
  if (businessName) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: businessName, bold: true, size: 26, color: "1A1A1A" })],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 80 },
      })
    );
    children.push(
      new Paragraph({
        border: { bottom: { color: "CCCCCC", size: 6, style: BorderStyle.SINGLE } },
        children: [new TextRun("")],
        spacing: { after: 240 },
      })
    );
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Heading 1
    if (line.startsWith("# ")) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: parseInline(line.slice(2)),
          spacing: { before: 320, after: 120 },
        })
      );
    }
    // Heading 2
    else if (line.startsWith("## ")) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: parseInline(line.slice(3)),
          spacing: { before: 240, after: 80 },
        })
      );
    }
    // Heading 3
    else if (line.startsWith("### ")) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: parseInline(line.slice(4)),
          spacing: { before: 160, after: 60 },
        })
      );
    }
    // Horizontal rule
    else if (/^---+$/.test(line.trim())) {
      children.push(
        new Paragraph({
          border: { bottom: { color: "CCCCCC", size: 6, style: BorderStyle.SINGLE } },
          children: [new TextRun("")],
          spacing: { before: 120, after: 120 },
        })
      );
    }
    // Table — collect all table lines
    else if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("|")) {
        tableLines.push(lines[i] ?? "");
        i++;
      }
      children.push(parseTable(tableLines));
      children.push(new Paragraph({ children: [new TextRun("")], spacing: { after: 80 } }));
      continue;
    }
    // Bullet list (- or *)
    else if (/^[\-\*] /.test(line)) {
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInline(line.slice(2)),
          spacing: { after: 60 },
        })
      );
    }
    // Sub-bullet (  - or  *)
    else if (/^  [\-\*] /.test(line)) {
      children.push(
        new Paragraph({
          bullet: { level: 1 },
          children: parseInline(line.slice(4)),
          spacing: { after: 40 },
        })
      );
    }
    // Ordered list (1. 2. etc.)
    else if (/^\d+\. /.test(line)) {
      const text = line.replace(/^\d+\. /, "");
      children.push(
        new Paragraph({
          numbering: { reference: "staffd-numbering", level: 0 },
          children: parseInline(text),
          spacing: { after: 60 },
        })
      );
    }
    // Note/disclaimer line (starts with Note:)
    else if (line.startsWith("Note:") || line.startsWith("DISCLAIMER:")) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line,
              italics: true,
              color: "666666",
              size: 18,
            }),
          ],
          spacing: { before: 120, after: 120 },
        })
      );
    }
    // Blank line → spacer
    else if (line.trim() === "") {
      children.push(new Paragraph({ children: [new TextRun("")], spacing: { after: 80 } }));
    }
    // Regular paragraph
    else {
      children.push(
        new Paragraph({
          children: parseInline(line),
          spacing: { after: 100 },
        })
      );
    }

    i++;
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "staffd-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.START,
              style: {
                paragraph: { indent: { left: 720, hanging: 360 } },
                run: { size: 22 },
              },
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: { font: { name: "Calibri" }, size: 22, color: "1A1A1A" },
          paragraph: { spacing: { after: 100 }, alignment: AlignmentType.LEFT },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 32, bold: true, color: "111111", font: { name: "Calibri" } },
          paragraph: { spacing: { before: 320, after: 120 } },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 26, bold: true, color: "222222", font: { name: "Calibri" } },
          paragraph: { spacing: { before: 240, after: 80 } },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 22, bold: true, color: "333333", font: { name: "Calibri" } },
          paragraph: { spacing: { before: 160, after: 60 } },
        },
        {
          id: "TableHeader",
          name: "Table Header",
          basedOn: "Normal",
          run: { bold: true, size: 20 },
        },
        {
          id: "TableBody",
          name: "Table Body",
          basedOn: "Normal",
          run: { size: 20 },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1260, bottom: 1440, left: 1260 },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const filename = businessName
    ? `${businessName.toLowerCase().replace(/\s+/g, "-")}-document.docx`
    : "document.docx";
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
