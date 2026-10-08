import * as XLSX from 'xlsx';

export type ImportKind = 'sale' | 'expense';
export type ImportCell = string | number | boolean | Date | null | undefined;

export type ParsedImportSheet = {
  name: string;
  rows: ImportCell[][];
};

export type ImportMapping = {
  date: number;
  time: number;
  amount: number;
  channel: number;
  category: number;
  note: number;
  reference: number;
};

export type KnownImportIdentityColumn = {
  key: string;
  index: number;
};

export type KnownImportPreset = {
  id: string;
  provider: string;
  label: string;
  sheetIndex: number;
  headerRow: number;
  kind: ImportKind;
  mapping: ImportMapping;
  identityNamespace?: string;
  identityColumns?: KnownImportIdentityColumn[];
  legacyMappings?: ImportMapping[];
};

export type PreparedImportRow = {
  rowNumber: number;
  id: number;
  kind: ImportKind;
  date: string;
  amount: number;
  category: string;
  note: string;
  reference: string;
  channel?: string;
  occurredAt?: string;
  matchedExistingId?: number;
  reconciliationExplicit?: boolean;
  recurringCostId?: number;
  recurringOccurrenceDate?: string;
  duplicate: boolean;
  error: string;
};

export const MAX_IMPORT_ROWS = 10000;

function normalizeHeader(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cellText(value: ImportCell) {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value ?? '').trim();
}

export function makeHeaders(row: ImportCell[]) {
  const seen = new Map<string, number>();
  return row.map((cell, index) => {
    const base = cellText(cell) || `Columna ${index + 1}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}


function exactHeaderIndex(headers: string[], names: string[]) {
  const normalizedNames = names.map(normalizeHeader);
  return headers.findIndex((header) => normalizedNames.includes(normalizeHeader(header)));
}

export function detectKnownImportPreset(sheets: ParsedImportSheet[]): KnownImportPreset | null {
  const fudoSheetIndex = sheets.findIndex((sheet) => normalizeHeader(sheet.name) === 'ventas');
  if (fudoSheetIndex < 0) return null;

  const fudoSheet = sheets[fudoSheetIndex];
  const headerRow = detectHeaderRow(fudoSheet.rows);
  const headers = makeHeaders(fudoSheet.rows[headerRow] || []);
  const required = ['fecha', 'caja', 'estado', 'medio de pago', 'total', 'tipo de venta', 'origen'];
  const normalizedHeaders = new Set(headers.map(normalizeHeader));
  const hits = required.filter((header) => normalizedHeaders.has(header)).length;
  if (hits < 6) return null;

  const date = exactHeaderIndex(headers, ['Fecha']);
  const amount = exactHeaderIndex(headers, ['Total']);
  if (date < 0 || amount < 0) return null;

  const note = exactHeaderIndex(headers, ['Medio de Pago']);
  const channel = exactHeaderIndex(headers, ['Origen', 'Canal', 'Canal de venta', 'Tipo de Venta']);
  const reference = exactHeaderIndex(headers, ['Id. Origen', 'ID Origen']);
  const comment = exactHeaderIndex(headers, ['Comentario']);
  const time = exactHeaderIndex(headers, ['Hora', 'Creación', 'Creacion', 'Cerrada']);
  const currentMapping: ImportMapping = { date, time, amount, channel, category: -1, note, reference };

  const identityCandidates: Array<[string, string[]]> = [
    ['created', ['Creación', 'Creacion']],
    ['closed', ['Cerrada']],
    ['cash_register', ['Caja']],
    ['payment', ['Medio de Pago']],
    ['total', ['Total']],
    ['sale_type', ['Tipo de Venta']],
    ['origin', ['Origen']],
  ];
  const identityColumns = identityCandidates
    .map(([key, names]) => ({ key, index: exactHeaderIndex(headers, names) }))
    .filter((column) => column.index >= 0);

  // Antes del preset de Fudo, el mapeo automático solía usar "Comentario" como nota.
  // Conservamos variantes históricas para reconocer ventas ya importadas con versiones anteriores.
  const legacyMappings: ImportMapping[] = [];
  const addLegacy = (candidate: ImportMapping) => {
    const key = `${candidate.date}|${candidate.amount}|${candidate.category}|${candidate.note}|${candidate.reference}`;
    if (legacyMappings.some((item) => `${item.date}|${item.amount}|${item.category}|${item.note}|${item.reference}` === key)) return;
    legacyMappings.push(candidate);
  };
  addLegacy({ ...currentMapping, time: -1, note: comment });
  addLegacy({ ...currentMapping, time: -1, note: -1 });
  addLegacy({ ...currentMapping, time: -1, note: comment, reference: -1 });
  addLegacy({ ...currentMapping, time: -1, note: -1, reference: -1 });

  return {
    id: 'fudo-sales-v2',
    provider: 'Fudo',
    label: 'Reporte de ventas de Fudo',
    sheetIndex: fudoSheetIndex,
    headerRow,
    kind: 'sale',
    mapping: currentMapping,
    identityNamespace: 'fudo-sales',
    identityColumns,
    legacyMappings,
  };
}

const headerKeywords = ['fecha', 'date', 'dia', 'importe', 'monto', 'total', 'amount', 'valor', 'venta', 'ingreso', 'gasto', 'egreso', 'canal', 'origen', 'marketplace', 'categoria', 'category', 'descripcion', 'detalle', 'concepto', 'referencia', 'transaction', 'transaccion', 'comprobante', 'ticket'];

export function detectHeaderRow(rows: ImportCell[][]) {
  const limit = Math.min(rows.length, 10);
  let bestIndex = 0;
  let bestScore = -Infinity;

  for (let index = 0; index < limit; index += 1) {
    const row = rows[index] || [];
    const populated = row.filter((cell) => cellText(cell) !== '');
    if (populated.length < 2) continue;
    const normalized = populated.map(normalizeHeader);
    const textCells = populated.filter((cell) => typeof cell === 'string').length;
    const keywordHits = normalized.reduce((sum, value) => sum + headerKeywords.filter((keyword) => value.includes(keyword)).length, 0);
    const unique = new Set(normalized.filter(Boolean)).size;
    const score = populated.length + textCells * 1.4 + keywordHits * 5 + unique * 0.3;
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  return bestIndex;
}

function scoreHeader(header: string, keywords: string[]) {
  const normalized = normalizeHeader(header);
  let score = 0;
  for (const keyword of keywords) {
    if (normalized === keyword) score += 10;
    else if (normalized.startsWith(`${keyword} `) || normalized.endsWith(` ${keyword}`)) score += 7;
    else if (normalized.includes(keyword)) score += 4;
  }
  return score;
}

function bestColumn(headers: string[], keywords: string[]) {
  let best = -1;
  let bestScore = 0;
  headers.forEach((header, index) => {
    const score = scoreHeader(header, keywords);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

export function autoMapHeaders(headers: string[]): ImportMapping {
  return {
    date: bestColumn(headers, ['fecha', 'date', 'dia', 'created at', 'created', 'timestamp']),
    time: bestColumn(headers, ['hora', 'time', 'horario', 'creacion', 'creación', 'cerrada', 'created at', 'timestamp']),
    amount: bestColumn(headers, ['importe', 'monto', 'amount', 'total', 'valor', 'neto', 'bruto', 'venta', 'ingreso', 'gasto', 'egreso']),
    channel: bestColumn(headers, ['canal', 'canal de venta', 'origen', 'origin', 'marketplace', 'delivery', 'plataforma', 'tipo de venta']),
    category: bestColumn(headers, ['categoria', 'category', 'rubro', 'tipo', 'grupo']),
    note: bestColumn(headers, ['descripcion', 'detalle', 'concepto', 'nota', 'note', 'observacion', 'comentario']),
    reference: bestColumn(headers, ['referencia', 'reference', 'ref', 'transaction id', 'transaccion', 'comprobante', 'ticket', 'numero', 'nro', 'id']),
  };
}

export function inferImportKind(headers: string[]): ImportKind {
  const normalized = headers.map(normalizeHeader).join(' | ');
  const expenseHits = ['gasto', 'egreso', 'costo', 'coste', 'proveedor', 'compra'].filter((word) => normalized.includes(word)).length;
  const saleHits = ['venta', 'ingreso', 'facturacion', 'cobro', 'payment', 'recaudacion'].filter((word) => normalized.includes(word)).length;
  return expenseHits > saleHits ? 'expense' : 'sale';
}

function localISO(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function excelSerialToISO(serial: number) {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return '';
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.floor(serial) * 86400000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function parseImportDate(value: ImportCell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return localISO(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number') return excelSerialToISO(value);
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^\d{5}(?:\.\d+)?$/.test(text)) return excelSerialToISO(Number(text));

  let match = text.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T].*)?$/);
  if (match) return localISO(Number(match[1]), Number(match[2]), Number(match[3]));

  match = text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})(?:[ T].*)?$/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return localISO(year, Number(match[2]), Number(match[1]));
  }

  return '';
}

export function parseImportTime(value: ImportCell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const h = String(value.getHours()).padStart(2, '0');
    const m = String(value.getMinutes()).padStart(2, '0');
    const sec = String(value.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel representa una hora pura como fracción del día.
    const fraction = ((value % 1) + 1) % 1;
    const totalSeconds = Math.round(fraction * 86400) % 86400;
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const sec = String(totalSeconds % 60).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  }
  const text = String(value ?? '').trim();
  if (!text) return '';
  const match = text.match(/(?:^|[ T])(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap])\.?m\.?)?/i);
  if (!match) return '';
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  const meridiem = String(match[4] || '').toLowerCase();
  if (minute > 59 || second > 59) return '';
  if (meridiem) {
    if (hour < 1 || hour > 12) return '';
    if (meridiem === 'p' && hour < 12) hour += 12;
    if (meridiem === 'a' && hour === 12) hour = 0;
  } else if (hour > 23) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
}

export function parseImportOccurredAt(dateValue: ImportCell, timeValue?: ImportCell) {
  const date = parseImportDate(dateValue);
  if (!date) return '';
  const explicitTime = parseImportTime(timeValue);
  const embeddedTime = explicitTime || parseImportTime(dateValue);
  if (!embeddedTime) return '';
  // Sin offset a propósito: representa hora local del negocio tal como vino del Excel.
  return `${date}T${embeddedTime}`;
}

export function parseImportAmount(value: ImportCell) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  let text = String(value ?? '').trim();
  if (!text) return NaN;
  const negativeByParentheses = /^\(.*\)$/.test(text);
  text = text.replace(/[()]/g, '').replace(/[^0-9,.-]/g, '');
  if (!text) return NaN;

  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    const thousands = decimal === ',' ? /\./g : /,/g;
    text = text.replace(thousands, '').replace(decimal, '.');
  } else if (comma >= 0) {
    const decimals = text.length - comma - 1;
    text = decimals > 0 && decimals <= 2 ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (dot >= 0) {
    const dotCount = (text.match(/\./g) || []).length;
    const decimals = text.length - dot - 1;
    if (dotCount > 1 || decimals === 3) text = text.replace(/\./g, '');
  }

  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return NaN;
  return negativeByParentheses ? -Math.abs(numeric) : numeric;
}

function hash32(text: string, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function deterministicImportId(sourceKey: string) {
  // Dos hashes de 32 bits combinados en un entero seguro de JavaScript.
  // Evitamos literales BigInt para mantener compatibilidad con target ES2017.
  const high = hash32(sourceKey) & 0x1fffff;
  const low = hash32(`lebu|${sourceKey}`, 0x9e3779b9);
  const combined = high * 0x100000000 + low;
  const range = 2_000_000_000_000_000;
  return 6_000_000_000_000_000 + (combined % range);
}

function identityCellText(value: ImportCell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    const hour = String(value.getHours()).padStart(2, '0');
    const minute = String(value.getMinutes()).padStart(2, '0');
    const second = String(value.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function legacyCanonicalForMapping({
  row, mapping, kind, fallbackCategory,
}: {
  row: ImportCell[];
  mapping: ImportMapping;
  kind: ImportKind;
  fallbackCategory: string;
}) {
  const date = mapping.date >= 0 ? parseImportDate(row[mapping.date]) : '';
  const rawAmount = mapping.amount >= 0 ? parseImportAmount(row[mapping.amount]) : NaN;
  const amount = kind === 'expense' && Number.isFinite(rawAmount) ? Math.abs(rawAmount) : rawAmount;
  const categoryValue = mapping.category >= 0 ? cellText(row[mapping.category]) : '';
  const category = kind === 'expense' ? (categoryValue || fallbackCategory || 'Otros') : '';
  const note = mapping.note >= 0 ? cellText(row[mapping.note]) : '';
  const reference = mapping.reference >= 0 ? cellText(row[mapping.reference]) : '';
  if (!date || !Number.isFinite(amount) || amount <= 0) return '';
  return reference
    ? `${kind}|ref:${reference}|${date}|${amount}`
    : `${kind}|${date}|${amount}|${category}|${note}`;
}

function presetCanonicalForRow({
  row, preset, reference, fallbackCanonical,
}: {
  row: ImportCell[];
  preset: KnownImportPreset;
  reference: string;
  fallbackCanonical: string;
}) {
  if (!preset.identityNamespace) return fallbackCanonical;

  const originColumn = preset.identityColumns?.find((column) => column.key === 'origin');
  const origin = originColumn ? identityCellText(row[originColumn.index]) : '';
  if (reference) {
    return `${preset.identityNamespace}|origin:${origin || 'direct'}|ref:${reference}`;
  }

  const parts = (preset.identityColumns || [])
    .map((column) => [column.key, identityCellText(row[column.index])] as const)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key}:${value}`);
  return parts.length ? `${preset.identityNamespace}|${parts.join('|')}` : fallbackCanonical;
}

export function prepareImportRows({
  rows,
  headerRow,
  mapping,
  kind,
  fallbackCategory,
  existingIds,
  knownPreset = null,
}: {
  rows: ImportCell[][];
  headerRow: number;
  mapping: ImportMapping;
  kind: ImportKind;
  fallbackCategory: string;
  existingIds: Set<number>;
  knownPreset?: KnownImportPreset | null;
}) {
  const dataRows = rows.slice(headerRow + 1, headerRow + 1 + MAX_IMPORT_ROWS);
  const primaryOccurrences = new Map<string, number>();
  const legacyMappings = knownPreset
    ? [knownPreset.mapping, ...(knownPreset.legacyMappings || [])]
    : [];
  const legacyOccurrences = legacyMappings.map(() => new Map<string, number>());

  return dataRows
    .map((row, index): PreparedImportRow | null => {
      const absoluteRow = headerRow + index + 2;
      if (!row.some((cell) => cellText(cell) !== '')) return null;
      const date = mapping.date >= 0 ? parseImportDate(row[mapping.date]) : '';
      const rawAmount = mapping.amount >= 0 ? parseImportAmount(row[mapping.amount]) : NaN;
      const occurredAt = parseImportOccurredAt(row[mapping.date], mapping.time >= 0 ? row[mapping.time] : undefined);
      const amount = kind === 'expense' && Number.isFinite(rawAmount) ? Math.abs(rawAmount) : rawAmount;
      const categoryValue = mapping.category >= 0 ? cellText(row[mapping.category]) : '';
      const category = kind === 'expense' ? (categoryValue || fallbackCategory || 'Otros') : '';
      const channel = kind === 'sale' && mapping.channel >= 0 ? cellText(row[mapping.channel]) : '';
      const note = mapping.note >= 0 ? cellText(row[mapping.note]) : '';
      const reference = mapping.reference >= 0 ? cellText(row[mapping.reference]) : '';

      let error = '';
      if (!date) error = 'Fecha inválida';
      else if (!Number.isFinite(amount) || amount <= 0) error = kind === 'sale' && rawAmount < 0 ? 'Venta negativa' : 'Importe inválido';
      else if (kind === 'expense' && !category) error = 'Falta categoría';

      const legacyCanonical = reference
        ? `${kind}|ref:${reference}|${date}|${amount}`
        : `${kind}|${date}|${amount}|${category}|${note}`;
      const primaryCanonical = knownPreset
        ? presetCanonicalForRow({ row, preset: knownPreset, reference, fallbackCanonical: legacyCanonical })
        : legacyCanonical;
      const occurrence = (primaryOccurrences.get(primaryCanonical) || 0) + 1;
      primaryOccurrences.set(primaryCanonical, occurrence);
      const id = deterministicImportId(`${primaryCanonical}|${occurrence}`);

      let matchedExistingId: number | undefined = existingIds.has(id) ? id : undefined;
      let duplicate = matchedExistingId != null;
      if (!duplicate && knownPreset) {
        // Compatibilidad hacia atrás: la identidad de importación evolucionó en 1.12/1.13.1.
        // Probamos los hashes que Lebu podía haber generado antes para la misma fila.
        for (let legacyIndex = 0; legacyIndex < legacyMappings.length; legacyIndex += 1) {
          const candidateCanonical = legacyCanonicalForMapping({
            row,
            mapping: legacyMappings[legacyIndex],
            kind,
            fallbackCategory,
          });
          if (!candidateCanonical) continue;
          const occurrenceMap = legacyOccurrences[legacyIndex];
          const candidateOccurrence = (occurrenceMap.get(candidateCanonical) || 0) + 1;
          occurrenceMap.set(candidateCanonical, candidateOccurrence);
          const legacyId = deterministicImportId(`${candidateCanonical}|${candidateOccurrence}`);
          if (existingIds.has(legacyId)) {
            matchedExistingId = legacyId;
            duplicate = true;
            break;
          }
        }
      }

      return {
        rowNumber: absoluteRow,
        id,
        kind,
        date,
        amount: Number.isFinite(amount) ? amount : 0,
        category,
        note,
        reference,
        channel: channel || undefined,
        occurredAt: occurredAt || undefined,
        matchedExistingId,
        duplicate,
        error,
      };
    })
    .filter((row): row is PreparedImportRow => Boolean(row));
}

export async function readImportWorkbook(file: File): Promise<ParsedImportSheet[]> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  let workbook: any;

  if (extension === 'csv' || extension === 'txt') {
    const buffer = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buffer);
    // Algunos sistemas de gestión todavía exportan CSV en Windows-1252.
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buffer);
    workbook = XLSX.read(text, { type: 'string', cellDates: true, dense: true });
  } else {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true, dense: true });
  }

  return workbook.SheetNames.map((name: string) => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: true }) as ImportCell[][],
  })).filter((sheet: ParsedImportSheet) => sheet.rows.length > 0);
}
