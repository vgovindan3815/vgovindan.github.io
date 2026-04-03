import {
  AlignmentType,
  BorderStyle,
  convertInchesToTwip,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

export interface TableData {
  name: string;
  section: string;
  rows: string[][];
}

export type PlaceholderMap = Record<string, string>;

// ─── Contract body template (placeholders replaced at runtime) ────────────────
const CONTRACT_BODY_TEMPLATE: string[] = [
  'This Freight Logistics Contract ("Agreement") is entered into as of {{ContractDate}} by and between:',
  '',
  'PROVIDER: {{ProviderName}}, located at {{ProviderAddress}},',
  'represented by {{ProviderContact}} ({{ProviderEmail}});',
  '',
  'and',
  '',
  'CUSTOMER: {{CustomerName}}, located at {{CustomerAddress}},',
  'represented by {{CustomerContact}} ({{CustomerEmail}}).',
  '',
  '1. TERM',
  'This Agreement shall be effective from {{StartDate}} through {{EndDate}}.',
  '',
  '2. PRICING MODEL',
  'The parties agree to pricing based on the {{PricingModel}} model as detailed in the appendices.',
  '',
  '3. PAYMENT TERMS',
  '{{PaymentTerms}}',
  '',
  '4. GOVERNING LAW',
  'This Agreement shall be governed by the laws of {{GoverningLaw}}.',
  '',
  '5. BILLING CURRENCY',
  'All pricing is denominated in {{Currency}}.',
  '',
  'The detailed pricing schedules, surcharges, service levels, and terms are set forth in the',
  'Appendices attached hereto and incorporated herein by reference.',
  '',
  'IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first written above.',
  '',
  '____________________________              ____________________________',
  'Authorized Signature (Provider)           Authorized Signature (Customer)',
  '{{ProviderName}}                          {{CustomerName}}',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function replacePlaceholders(text: string, ph: PlaceholderMap): string {
  return Object.entries(ph).reduce(
    (acc, [key, val]) => acc.replaceAll(key, val || key),
    text,
  );
}

function buildWordTable(rows: string[][]): Table {
  if (!rows.length) {
    return new Table({
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ text: '(empty)' })],
            }),
          ],
        }),
      ],
    });
  }

  const colCount = Math.max(1, ...rows.map((r) => r.length));

  const normalizedRows = rows.map((row) => {
    const padded = Array.from({ length: colCount }, (_, idx) => row[idx] ?? '');
    return padded;
  });

  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'AAAAAA' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
    },
    rows: normalizedRows.map(
      (row, rowIdx) =>
        new TableRow({
          tableHeader: rowIdx === 0,
          children: row.map(
            (cell) =>
              new TableCell({
                shading:
                  rowIdx === 0
                    ? { type: ShadingType.SOLID, color: '1A1A6E', fill: '1A1A6E' }
                    : rowIdx % 2 === 0
                      ? { type: ShadingType.SOLID, color: 'F5F5FF', fill: 'F5F5FF' }
                      : undefined,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: cell && cell.length > 0 ? cell : '\u00A0',
                        bold: rowIdx === 0,
                        color: rowIdx === 0 ? 'FFFFFF' : '111111',
                        size: 18,
                        font: 'Calibri',
                      }),
                    ],
                    spacing: { before: 60, after: 60 },
                  }),
                ],
              }),
          ),
        }),
    ),
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function buildContract(
  pricingModel: string,
  placeholders: PlaceholderMap,
  tables: TableData[],
): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  // ── Cover / Title ────────────────────────────────────────────────────────
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: 'FREIGHT LOGISTICS CONTRACT',
          bold: true,
          size: 52,
          color: '1A1A6E',
          font: 'Calibri',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Pricing Model: ${pricingModel}`,
          italics: true,
          size: 26,
          color: '555577',
          font: 'Calibri',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Generated: ${new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}`,
          italics: true,
          size: 20,
          color: '888888',
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 800 },
    }),
  );

  // ── Contract Body ────────────────────────────────────────────────────────
  for (const line of CONTRACT_BODY_TEMPLATE) {
    const text = replacePlaceholders(line, placeholders);
    const isSection = /^\d+\.\s/.test(line);
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text,
            size: 22,
            bold: isSection,
            font: 'Calibri',
          }),
        ],
        spacing: { after: line === '' ? 100 : isSection ? 240 : 180 },
        indent: isSection ? undefined : { left: 0 },
      }),
    );
  }

  // ── Page break before appendices ────────────────────────────────────────
  children.push(new Paragraph({ children: [new PageBreak()] }));

  children.push(
    new Paragraph({
      text: 'APPENDICES — PRICING SCHEDULES',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 400, after: 400 },
    }),
  );

  // ── Appendix tables ──────────────────────────────────────────────────────
  for (const table of tables) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${table.section}: ${table.name.replaceAll('_', ' ')}`,
            bold: true,
            size: 28,
            color: '1A1A6E',
            font: 'Calibri',
          }),
        ],
        spacing: { before: 480, after: 200 },
      }),
    );

    if (table.rows.length > 0) {
      children.push(buildWordTable(table.rows));
    } else {
      children.push(
        new Paragraph({
          text: '(No data available for this section)',
          spacing: { after: 200 },
        }),
      );
    }

    // Spacer after table
    children.push(new Paragraph({ text: '', spacing: { after: 160 } }));
  }

  // ── Assemble Document ────────────────────────────────────────────────────
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22 },
        },
        heading1: {
          run: { bold: true, size: 32, color: '1A1A6E' },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.25),
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
