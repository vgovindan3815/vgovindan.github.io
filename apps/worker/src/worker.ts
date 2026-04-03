import 'dotenv/config';
import { Job, Worker } from 'bullmq';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { createClient } from 'redis';
import { buildContract, PlaceholderMap, TableData } from './contract-builder';
import { downloadExcel, getOboToken } from './graph';

// ─── Config ───────────────────────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const MAPPING_PATH = path.resolve(
  __dirname,
  '../../../shared/mapping/PricingTemplate_To_Contract_Mapping.json',
);

const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf-8')) as {
  templates: Array<{
    templateId: string;
    pricingModel: string;
    placeholders: Record<
      string,
      | { sheet: string; field?: string; cell?: string }
      | { preferred: { sheet: string; cell: string }; fallback: { sheet: string; field: string } }
    >;
    tables: Array<{
      name: string;
      sheet: string;
      contractSection: string;
      headerRow?: number;
      detectHeaders?: string[];
      cells?: string[];
      tableDelimiter?: {
        emptyLine?: boolean;
        newHeader?: boolean;
      };
    }>;
  }>;
};

// ─── Redis ────────────────────────────────────────────────────────────────────
const redisUrl = new URL(REDIS_URL);
const bullConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
};
const redis = createClient({ url: REDIS_URL });

type JobData = {
  requestId: string;
  pricingModel: 'Zone-based' | 'Mileage-based' | 'Auto';
  input: { driveId?: string; itemId?: string; name: string; localFileBase64?: string };
  output: { localPath: string; fileName: string };
  accessToken: string;
  submittedBy: string;
  submittedAt: string;
  batchId?: string;
};

function toBufferFromBase64(base64: string): Buffer {
  const normalized = base64.includes(',') ? base64.split(',')[1] ?? '' : base64;
  return Buffer.from(normalized, 'base64');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function updateStatus(requestId: string, update: Record<string, unknown>): Promise<void> {
  const existing = await redis.get(`request:${requestId}`);
  const current = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
  await redis.set(`request:${requestId}`, JSON.stringify({ ...current, ...update }), { EX: 86400 });
}

async function detectPricingModelFromWorkbook(buffer: Buffer): Promise<'Zone-based' | 'Mileage-based'> {
  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const readMe = workbook.getWorksheet('0_ReadMe');
  const b4 = readMe?.getCell('B4').value?.toString()?.trim().toLowerCase() ?? '';
  if (b4.includes('zone')) return 'Zone-based';
  if (b4.includes('mileage')) return 'Mileage-based';

  const profile = workbook.getWorksheet('1_Customer_Profile');
  let detected: 'Zone-based' | 'Mileage-based' | null = null;
  profile?.eachRow((row) => {
    if (detected) return;
    const field = row.getCell(1).value?.toString()?.trim().toLowerCase();
    const value = row.getCell(2).value?.toString()?.trim().toLowerCase() ?? '';
    if (field === 'pricing model') {
      if (value.includes('zone')) detected = 'Zone-based';
      if (value.includes('mileage')) detected = 'Mileage-based';
    }
  });

  if (detected) return detected;
  throw new Error('Unable to detect pricing model from workbook. Expected 0_ReadMe!B4 or 1_Customer_Profile Pricing Model.');
}

// ─── Workbook parser ──────────────────────────────────────────────────────────
async function parseWorkbook(
  buffer: Buffer,
  templateConfig: (typeof mapping.templates)[0],
): Promise<{ placeholders: PlaceholderMap; tables: TableData[] }> {
  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);

  const placeholders: PlaceholderMap = {};

  // Extract from 1_Customer_Profile (Field/Value pair rows)
  const profileSheet = workbook.getWorksheet('1_Customer_Profile');
  if (profileSheet) {
    profileSheet.eachRow((row) => {
      const field = row.getCell(1).value?.toString()?.trim();
      const value = row.getCell(2).value?.toString()?.trim() ?? '';
      if (!field) return;

      for (const [ph, cfg] of Object.entries(templateConfig.placeholders)) {
        const c = cfg as Record<string, unknown>;
        // Direct sheet/field reference
        if (c['sheet'] === '1_Customer_Profile' && c['field'] === field) {
          placeholders[ph] = value;
        }
        // Fallback (preferred/fallback pattern)
        const fallback = c['fallback'] as { sheet?: string; field?: string } | undefined;
        if (fallback?.sheet === '1_Customer_Profile' && fallback?.field === field) {
          if (!placeholders[ph]) placeholders[ph] = value;
        }
      }
    });
  }

  // Preferred cell values override fallback values (e.g. 0_ReadMe B4 for PricingModel)
  for (const [ph, cfg] of Object.entries(templateConfig.placeholders)) {
    const c = cfg as Record<string, unknown>;
    const preferred = c['preferred'] as { sheet?: string; cell?: string } | undefined;
    if (preferred?.sheet && preferred?.cell) {
      const sheet = workbook.getWorksheet(preferred.sheet);
      if (sheet) {
        const cellVal = sheet.getCell(preferred.cell).value?.toString();
        if (cellVal) placeholders[ph] = cellVal;
      }
    }
  }

  // Extract tables
  const tables: TableData[] = [];

  const toTrimmedStrings = (row: ExcelJS.Row, width: number): string[] => {
    const vals: string[] = [];
    for (let i = 1; i <= width; i++) {
      vals.push(row.getCell(i).value?.toString()?.trim() ?? '');
    }
    return vals;
  };

  const isEmptyRow = (vals: string[]): boolean => vals.every((v) => v === '');

  const includesHeaders = (vals: string[], required: string[]): boolean =>
    required.every((h) => vals.includes(h));

  const getSheetHeaderSets = (sheetName: string): string[][] =>
    templateConfig.tables
      .filter((t) => t.sheet === sheetName && !!t.detectHeaders?.length)
      .map((t) => t.detectHeaders as string[]);

  for (const tableDef of templateConfig.tables) {
    const sheet = workbook.getWorksheet(tableDef.sheet);
    if (!sheet) {
      tables.push({ name: tableDef.name, section: tableDef.contractSection, rows: [] });
      continue;
    }

    const rows: string[][] = [];

    if (tableDef.cells) {
      // Specific named cells (e.g. Workbook_Selection)
      for (const cellRef of tableDef.cells) {
        const cell = sheet.getCell(cellRef);
        rows.push([`Cell ${cellRef}`, cell.value?.toString() ?? '']);
      }
    } else if (tableDef.detectHeaders?.length) {
      // Find the header row by detecting required column headers, then extract until delimiter.
      let headerRowNum: number | null = null;
      let headerWidth = 0;
      const allHeaderSets = getSheetHeaderSets(tableDef.sheet);

      sheet.eachRow((row, rowNum) => {
        if (headerRowNum !== null) return;
        const vals: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          vals.push(cell.value?.toString()?.trim() ?? '');
        });
        if (tableDef.detectHeaders!.every((h) => vals.includes(h))) {
          headerRowNum = rowNum;
          headerWidth = Math.max(vals.length, row.cellCount, row.actualCellCount, 1);
        }
      });

      if (headerRowNum !== null) {
        const delim = tableDef.tableDelimiter ?? { emptyLine: true, newHeader: true };
        for (let rowNum = headerRowNum; rowNum <= sheet.rowCount; rowNum++) {
          const row = sheet.getRow(rowNum);
          const cells = toTrimmedStrings(row, headerWidth);

          if (rowNum > headerRowNum) {
            const isBlank = isEmptyRow(cells);
            const isHeaderRepeat = includesHeaders(cells, tableDef.detectHeaders!);
            const isOtherTableHeader = allHeaderSets.some(
              (headerSet) =>
                headerSet !== tableDef.detectHeaders && includesHeaders(cells, headerSet),
            );

            if (
              (delim.emptyLine && isBlank) ||
              (delim.newHeader && isHeaderRepeat) ||
              (delim.newHeader && isOtherTableHeader)
            ) {
              break;
            }
          }

          if (cells.some((c) => c !== '')) {
            rows.push(cells);
          }
        }
      }
    } else if (tableDef.headerRow) {
      // From specified headerRow onwards, stop at empty line or repeated header.
      const header = sheet.getRow(tableDef.headerRow);
      const headerWidth = Math.max(header.cellCount, header.actualCellCount, 1);
      const headerVals = toTrimmedStrings(header, headerWidth);
      const delim = tableDef.tableDelimiter ?? { emptyLine: true, newHeader: true };

      for (let rowNum = tableDef.headerRow; rowNum <= sheet.rowCount; rowNum++) {
        const row = sheet.getRow(rowNum);
        const cells = toTrimmedStrings(row, headerWidth);

        if (rowNum > tableDef.headerRow) {
          const isBlank = isEmptyRow(cells);
          const isHeaderRepeat = cells.join('|') === headerVals.join('|');
          if ((delim.emptyLine && isBlank) || (delim.newHeader && isHeaderRepeat)) {
            break;
          }
        }

        if (cells.some((c) => c !== '')) {
          rows.push(cells);
        }
      }
    }

    tables.push({ name: tableDef.name, section: tableDef.contractSection, rows });
  }

  return { placeholders, tables };
}

// ─── Worker ───────────────────────────────────────────────────────────────────
redis.connect().then(() => {
  console.log('Worker: Redis connected');

  new Worker<JobData>(
    'contract-generation',
    async (job: Job<JobData>) => {
      const { requestId, pricingModel, input, output, accessToken } = job.data;
      console.log(`[${requestId}] Starting — model: ${pricingModel}`);

      await updateStatus(requestId, {
        status: 'Processing',
        progress: 5,
        message: 'Starting processing',
      });

      // ── 1. OBO token for Graph (only needed for OneDrive input) ─────────
      let graphToken: string | null = null;
      if (!input.localFileBase64) {
        try {
          graphToken = await getOboToken(accessToken);
          await updateStatus(requestId, { progress: 10, message: 'Authenticated with Microsoft Graph' });
        } catch (err) {
          await updateStatus(requestId, { status: 'Failed', message: 'Graph authentication failed' });
          throw err;
        }
      }

      // ── 2. Get Excel (OneDrive or local upload) ──────────────────────────
      let excelBuffer: Buffer;
      try {
        if (input.localFileBase64) {
          excelBuffer = toBufferFromBase64(input.localFileBase64);
          await updateStatus(requestId, { progress: 30, message: 'Local Excel file loaded' });
        } else {
          excelBuffer = await downloadExcel(input.driveId!, input.itemId!, graphToken!);
          await updateStatus(requestId, { progress: 30, message: 'Excel file downloaded' });
        }
      } catch (err) {
        await updateStatus(requestId, {
          status: 'Failed',
          message: 'Failed to load Excel input file',
        });
        throw err;
      }

      // ── 3. Select template definition ────────────────────────────────────
      let effectivePricingModel: 'Zone-based' | 'Mileage-based';
      try {
        effectivePricingModel =
          pricingModel === 'Auto'
            ? await detectPricingModelFromWorkbook(excelBuffer)
            : pricingModel;
      } catch (err) {
        await updateStatus(requestId, {
          status: 'Failed',
          progress: 0,
          message: (err as Error).message,
        });
        throw err;
      }

      const template = mapping.templates.find((t) => t.pricingModel === effectivePricingModel);
      if (!template) {
        await updateStatus(requestId, {
          status: 'Failed',
          progress: 0,
          message: `Unsupported pricing model: ${effectivePricingModel}`,
        });
        throw new Error(`Unsupported pricing model: ${effectivePricingModel}`);
      }
      await updateStatus(requestId, {
        progress: 40,
        message: `Template selected (${effectivePricingModel})`,
      });

      // ── 4. Parse workbook ────────────────────────────────────────────────
      let placeholders: PlaceholderMap;
      let tables: TableData[];
      try {
        ({ placeholders, tables } = await parseWorkbook(excelBuffer, template));
        await updateStatus(requestId, { progress: 50, message: 'Workbook parsed successfully' });
      } catch (err) {
        await updateStatus(requestId, {
          status: 'Failed',
          message: 'Failed to parse Excel workbook',
        });
        throw err;
      }

      // ── 5. Build Word document ───────────────────────────────────────────
      let docBuffer: Buffer;
      try {
        docBuffer = await buildContract(effectivePricingModel, placeholders, tables);
        await updateStatus(requestId, { progress: 70, message: 'Contract document generated' });
      } catch (err) {
        await updateStatus(requestId, {
          status: 'Failed',
          message: 'Failed to generate contract document',
        });
        throw err;
      }

      // ── 6. Write contract to local filesystem ────────────────────────────
      let outputPath: string;
      try {
        const targetDir =
          output.localPath === 'browser-handle'
            ? path.resolve(__dirname, '../../../output')
            : output.localPath;
        fs.mkdirSync(targetDir, { recursive: true });
        outputPath = path.join(targetDir, output.fileName);
        fs.writeFileSync(outputPath, docBuffer);
        const outputBase64 = docBuffer.toString('base64');
        await updateStatus(requestId, {
          status: 'Completed',
          progress: 100,
          message: `Contract saved to ${outputPath}`,
          outputPath,
          outputBase64,
        });
      } catch (err) {
        await updateStatus(requestId, {
          status: 'Failed',
          message: 'Failed to save contract to disk',
        });
        throw err;
      }

      console.log(`[${requestId}] Completed → ${outputPath}`);
      return { requestId, status: 'Completed', outputPath };
    },
    {
      connection: bullConnection,
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? '2'),
    },
  );

  console.log('Worker: Listening for contract-generation jobs...');
});

