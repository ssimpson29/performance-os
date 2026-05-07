import * as XLSX from 'xlsx';

import type { ParsedTrainingPlan, PhaseBlock, PhaseWeekTarget, SupportTemplate, SupportTemplateItem, WeeklyStructureSession } from './types';

function normalizeCell(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeRow(row: unknown[]): string[] {
  return row.map(normalizeCell);
}

function isBlankRow(row: string[]): boolean {
  return row.every((cell) => !cell);
}

function firstNonEmptyCell(row: string[]): string {
  return row.find((cell) => cell) ?? '';
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function parseWeeklyStructure(rows: string[][]): WeeklyStructureSession[] {
  const headerIndex = rows.findIndex((row) => row.includes('Day') && row.includes('Run Session'));
  if (headerIndex === -1) return [];

  const sessions: WeeklyStructureSession[] = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    const day = row[1];
    if (!day) break;
    sessions.push({
      day,
      runSession: row[2] ?? '',
      details: row[3] ?? '',
      strengthMobility: row[4] ?? '',
      exactWork: row[5] ?? '',
    });
  }
  return sessions;
}

function parsePhaseHeaders(row: string[]): string[] {
  return row.filter(Boolean);
}

function buildPhaseWeekTarget(headers: string[], row: string[]): PhaseWeekTarget {
  const values = headers.map((header, idx) => [header, row[idx] ?? ''] as const);
  const metadata = Object.fromEntries(values.map(([header, value]) => [header, value]));
  const weekLabel = metadata.Week ?? row[0] ?? '';
  const notes = metadata.Notes || metadata['Key Focus'] || metadata.G || row[7] || '';
  const fuelTarget = metadata['Fuel Target'] || metadata.Fuel || row[6] || row[5] || '';

  return {
    weekLabel,
    mileageTarget: metadata['Mileage Target'] || metadata.Mileage || row[1] || '',
    vertTarget: metadata['Vert Target'] || metadata.Vert || row[2] || '',
    saturdayTarget: metadata['Saturday Long Run'] || metadata.Saturday || row[3] || '',
    sundayTarget: metadata['Sunday Run'] || metadata.Sunday || row[4] || '',
    thursdayTarget: metadata['Thursday Vert'] || metadata.Thursday || row[5] || '',
    fuelTarget,
    notes,
    keyFocus: metadata['Key Focus'] || '',
    isDeload: /deload/i.test(weekLabel),
    metadata,
  };
}

function parsePhaseBlocks(rows: string[][]): PhaseBlock[] {
  const blocks: PhaseBlock[] = [];
  let i = 0;

  while (i < rows.length) {
    const row = rows[i];
    const marker = firstNonEmptyCell(row);
    if (!/^PHASE\s+/i.test(marker)) {
      i += 1;
      continue;
    }

    const phaseName = marker;
    let headerIndex = i + 1;
    while (headerIndex < rows.length && isBlankRow(rows[headerIndex])) headerIndex += 1;
    const headers = parsePhaseHeaders(rows[headerIndex] ?? []);
    const weeks: PhaseWeekTarget[] = [];

    let dataIndex = headerIndex + 1;
    while (dataIndex < rows.length) {
      const current = rows[dataIndex];
      const currentMarker = firstNonEmptyCell(current);
      if (!currentMarker) {
        dataIndex += 1;
        continue;
      }
      if (/^PHASE\s+/i.test(currentMarker)) break;
      if (currentMarker === 'Week') {
        dataIndex += 1;
        continue;
      }
      weeks.push(buildPhaseWeekTarget(headers, current));
      dataIndex += 1;
    }

    blocks.push({ phaseName, headers, weeks });
    i = dataIndex;
  }

  return blocks;
}

function buildTemplateItems(headers: string[], rows: string[][]): SupportTemplateItem[] {
  return rows
    .filter((row) => !isBlankRow(row))
    .map((row) => {
      const metadata = Object.fromEntries(headers.map((header, idx) => [header, row[idx] ?? '']));
      return {
        label: row[0] ?? '',
        prescription: row[1] ?? '',
        focus: row[2] ?? '',
        notes: row[3] ?? row[4] ?? '',
        metadata,
      };
    });
}

function parseTemplateSections(rows: string[][], sheetName: string): SupportTemplate[] {
  const templates: SupportTemplate[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const marker = firstNonEmptyCell(rows[i]);
    if (!marker) continue;

    const next = rows[i + 1] ?? [];
    const hasHeaderRow = next.filter(Boolean).length >= 2 && /exercise/i.test(next[0] ?? '');
    if (!hasHeaderRow) continue;

    const headers = next.filter(Boolean);
    const itemRows: string[][] = [];
    let cursor = i + 2;
    while (cursor < rows.length) {
      const row = rows[cursor];
      const firstCell = firstNonEmptyCell(row);
      const nextRow = rows[cursor + 1] ?? [];
      const startsNewSection = firstCell && nextRow.filter(Boolean).length >= 2 && /exercise/i.test(nextRow[0] ?? '');
      if (startsNewSection) break;
      if (firstCell && /^MONDAY|^FRIDAY|^MOBILITY|^EVENING|^OPTIONAL/i.test(firstCell) && itemRows.length > 0 && !row[1]) {
        break;
      }
      itemRows.push(row);
      cursor += 1;
    }

    templates.push({
      name: marker
        .replace(/^MONDAY\s+—\s+/i, '')
        .replace(/^FRIDAY\s+—\s+/i, '')
        .replace(/^MOBILITY\s+\([^)]*\)/i, 'Mobility')
        .replace(/^Optional Add-On.*$/i, 'Optional Add-On')
        .replace(/^Evening Recovery Routine.*$/i, 'Evening Recovery Routine')
        .replace(/^On Strength Days.*$/i, 'Daily Routine')
        .replace(/^Do daily.*$/i, 'Daily Routine')
        .trim(),
      sourceSheet: sheetName,
      items: buildTemplateItems(headers, itemRows),
    });

    i = cursor - 1;
  }

  return templates.filter((template) => template.items.length > 0);
}

function parseDailySheet(rows: string[][]): SupportTemplate[] {
  const templates: SupportTemplate[] = [];

  const dailyHeaderIndex = rows.findIndex((row) => (row[0] ?? '') === 'Exercise' && (row[1] ?? '').includes('Sets x Reps'));
  if (dailyHeaderIndex !== -1) {
    const items = buildTemplateItems(rows[dailyHeaderIndex], rows.slice(dailyHeaderIndex + 1, 13));
    templates.push({ name: 'Daily Routine', sourceSheet: 'Daily', items });
  }

  const eveningIndex = rows.findIndex((row) => /^Evening Recovery Routine/i.test(row[0] ?? ''));
  if (eveningIndex !== -1) {
    const items = buildTemplateItems(rows[eveningIndex + 1], rows.slice(eveningIndex + 2, 21));
    templates.push({ name: 'Evening Recovery Routine', sourceSheet: 'Daily', items });
  }

  const optionalIndex = rows.findIndex((row) => /^Optional Add-On/i.test(row[0] ?? ''));
  if (optionalIndex !== -1) {
    const items = buildTemplateItems(rows[optionalIndex + 1], rows.slice(optionalIndex + 2));
    templates.push({ name: 'Optional Add-On', sourceSheet: 'Daily', items });
  }

  return templates;
}

function parseStrengthSheet(rows: string[][]): SupportTemplate[] {
  return parseTemplateSections(rows, 'Strength Days').map((template) => ({
    ...template,
    name: template.name
      .replace(/^Strength Day A \(Posterior Chain Focus\)$/i, 'Strength Day A')
      .replace(/^Strength Day C \(Foot \+ Core Stability\)$/i, 'Strength Day C'),
  }));
}

function parseSpeedWarmup(rows: string[][]): SupportTemplate[] {
  const headers = rows[0];
  const items = buildTemplateItems(headers, rows.slice(1));
  return [{ name: 'Speed Warmup', sourceSheet: 'Speed Warmup', items }];
}

export function parseTrainingPlanWorkbook(fileBuffer: Buffer | Uint8Array, fileName: string): ParsedTrainingPlan {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellText: true, cellDates: false });
  const sheetNames = workbook.SheetNames;
  const normalizedSheets = Object.fromEntries(
    sheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
        header: 1,
        raw: false,
        defval: '',
        blankrows: false,
      }).map((row) => normalizeRow(row as unknown[]));
      return [sheetName, rows];
    }),
  ) as Record<string, string[][]>;

  const weeklyRows = normalizedSheets['Weekly Schedule'] ?? [];
  const dailyRows = normalizedSheets.Daily ?? [];
  const strengthRows = normalizedSheets['Strength Days'] ?? [];
  const speedRows = normalizedSheets['Speed Warmup'] ?? [];

  return {
    planName: stripExtension(fileName),
    sourceFileName: fileName,
    sheetNames,
    weeklyStructure: parseWeeklyStructure(weeklyRows),
    phaseBlocks: parsePhaseBlocks(weeklyRows),
    supportTemplates: [
      ...parseDailySheet(dailyRows),
      ...parseStrengthSheet(strengthRows),
      ...parseSpeedWarmup(speedRows),
    ],
  };
}
