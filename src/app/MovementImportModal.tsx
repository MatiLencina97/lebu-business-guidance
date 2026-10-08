'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, ChevronDown, Clock3, FileSpreadsheet, Sparkles, Upload, X } from 'lucide-react';
import {
  autoMapHeaders,
  detectHeaderRow,
  detectKnownImportPreset,
  inferImportKind,
  makeHeaders,
  MAX_IMPORT_ROWS,
  prepareImportRows,
  readImportWorkbook,
  type ImportKind,
  type ImportMapping,
  type KnownImportPreset,
  type ParsedImportSheet,
  type PreparedImportRow,
} from './import-utils';
import { recurringOccurrenceCandidates, recurringOccurrenceDateForExpense, suggestRecurringMatch, type ReconciliationRecurringCost } from '../lib/recurring-reconciliation';

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

type ExistingMovement = { id: number; occurredAt?: string; channel?: string; recurringCostId?: number; recurringOccurrenceDate?: string };

type Props = {
  categories: string[];
  existingSales: ExistingMovement[];
  existingExpenses: ExistingMovement[];
  recurringCosts: ReconciliationRecurringCost[];
  onClose: () => void;
  onImport: (kind: ImportKind, rows: PreparedImportRow[]) => void;
  businessKey?: string;
  sessionMode?: boolean;
};

const emptyMapping: ImportMapping = { date: -1, time: -1, amount: -1, channel: -1, category: -1, note: -1, reference: -1 };
const IMPORT_PROFILES_KEY = 'lebu-import-profiles-v1';
const IMPORT_HISTORY_KEY = 'lebu-import-history-v1';

type ImportProfile = {
  id: string;
  signature: string;
  name: string;
  kind: ImportKind;
  dateHeader: string;
  timeHeader: string;
  amountHeader: string;
  channelHeader?: string;
  categoryHeader: string;
  noteHeader: string;
  referenceHeader: string;
  fallbackCategory: string;
  lastUsedAt: string;
};

type ImportHistoryItem = {
  id: string;
  fileName: string;
  kind: ImportKind;
  imported: number;
  duplicates: number;
  invalid: number;
  importedAt: string;
  recognized: boolean;
};

function normalizeForSignature(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function headerSignature(headers: string[]) {
  return headers.map(normalizeForSignature).filter(Boolean).sort().join('|');
}

function readProfiles(): ImportProfile[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(IMPORT_PROFILES_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.signature === 'string') : [];
  } catch { return []; }
}

function historyStorageKey(businessKey: string) {
  return `${IMPORT_HISTORY_KEY}:${businessKey || 'local'}`;
}

function readHistory(businessKey: string): ImportHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(historyStorageKey(businessKey)) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.fileName === 'string') : [];
  } catch { return []; }
}

function profileName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base.length > 36 ? `${base.slice(0, 33)}…` : (base || 'Formato de importación');
}

function mappingFromProfile(profile: ImportProfile, headers: string[]): ImportMapping {
  const find = (saved: string) => {
    if (!saved) return -1;
    const normalized = normalizeForSignature(saved);
    return headers.findIndex((header) => normalizeForSignature(header) === normalized);
  };
  return {
    date: find(profile.dateHeader),
    time: find(profile.timeHeader || '') >= 0 ? find(profile.timeHeader || '') : headers.findIndex((header) => /(^|\s)(hora|time|horario|creaci[oó]n|cerrada|timestamp)(\s|$)/i.test(header)),
    amount: find(profile.amountHeader),
    channel: find(profile.channelHeader || ''),
    category: find(profile.categoryHeader),
    note: find(profile.noteHeader),
    reference: find(profile.referenceHeader),
  };
}

const historyDate = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function occurrenceOptionLabel(item: ReconciliationRecurringCost, dateISO: string) {
  const date = new Date(`${dateISO}T12:00:00`);
  if (item.frequency === 'monthly') {
    const label = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(date);
    return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
  }
  const short = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short' }).format(date);
  return item.frequency === 'weekly' ? `Semana · ${short}` : `Quincena · ${short}`;
}

export default function MovementImportModal({ categories, existingSales, existingExpenses, recurringCosts, onClose, onImport, businessKey = 'local', sessionMode = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<ParsedImportSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [kind, setKind] = useState<ImportKind>('sale');
  const [mapping, setMapping] = useState<ImportMapping>(emptyMapping);
  const [fallbackCategory, setFallbackCategory] = useState(categories[0] || 'Otros');
  const [profiles, setProfiles] = useState<ImportProfile[]>(() => readProfiles());
  const [history, setHistory] = useState<ImportHistoryItem[]>(() => readHistory(businessKey));
  const [matchedProfileId, setMatchedProfileId] = useState<string | null>(null);
  const [knownPreset, setKnownPreset] = useState<KnownImportPreset | null>(null);
  const [configExpanded, setConfigExpanded] = useState(true);
  const [recurringOverrides, setRecurringOverrides] = useState<Record<number, number | null>>({});
  const [recurringOccurrenceOverrides, setRecurringOccurrenceOverrides] = useState<Record<number, string>>({});
  const [previewQuery, setPreviewQuery] = useState('');
  const [previewPage, setPreviewPage] = useState(0);
  const PREVIEW_PAGE_SIZE = 25;

  const sheet = sheets[sheetIndex] || null;
  const headers = useMemo(() => sheet ? makeHeaders(sheet.rows[headerRow] || []) : [], [sheet, headerRow]);

  useEffect(() => {
    if (!sheet) return;
    if (knownPreset && knownPreset.sheetIndex === sheetIndex) {
      setHeaderRow(knownPreset.headerRow);
      return;
    }
    setHeaderRow(detectHeaderRow(sheet.rows));
  }, [sheetIndex, sheet?.name, knownPreset]);

  useEffect(() => {
    if (!sheet || !headers.length) return;
    if (knownPreset && knownPreset.sheetIndex === sheetIndex && knownPreset.headerRow === headerRow) {
      setMapping(knownPreset.mapping);
      setKind(knownPreset.kind);
      setMatchedProfileId(null);
      setConfigExpanded(false);
      return;
    }
    const signature = headerSignature(headers);
    const matched = profiles.find((profile) => profile.signature === signature) || null;
    if (matched) {
      const learnedMapping = mappingFromProfile(matched, headers);
      if (learnedMapping.date >= 0 && learnedMapping.amount >= 0) {
        setMapping(learnedMapping);
        setKind(matched.kind);
        if (matched.fallbackCategory) setFallbackCategory(matched.fallbackCategory);
        setMatchedProfileId(matched.id);
        setConfigExpanded(false);
        return;
      }
    }
    setMatchedProfileId(null);
    setConfigExpanded(true);
    setMapping(autoMapHeaders(headers));
    setKind(inferImportKind(headers));
  }, [headerRow, sheetIndex, sheet?.name, profiles, knownPreset]);

  const existingMovements = kind === 'sale' ? existingSales : existingExpenses;
  const existingIds = useMemo(() => new Set(existingMovements.map((item) => item.id)), [existingMovements]);
  const existingById = useMemo(() => new Map(existingMovements.map((item) => [item.id, item])), [existingMovements]);
  const preparedBase = useMemo(() => {
    if (!sheet || mapping.date < 0 || mapping.amount < 0) return [];
    return prepareImportRows({ rows: sheet.rows, headerRow, mapping, kind, fallbackCategory, existingIds, knownPreset });
  }, [sheet, headerRow, mapping, kind, fallbackCategory, existingIds, knownPreset]);

  const prepared = useMemo(() => preparedBase.map((row) => {
    if (kind !== 'expense' || row.error) return row;
    const hasOverride = Object.prototype.hasOwnProperty.call(recurringOverrides, row.id);
    const hasOccurrenceOverride = Object.prototype.hasOwnProperty.call(recurringOccurrenceOverrides, row.id);
    const overriddenId = hasOverride ? recurringOverrides[row.id] : undefined;
    const overriddenOccurrence = hasOccurrenceOverride ? recurringOccurrenceOverrides[row.id] : undefined;
    const existing = row.matchedExistingId == null ? undefined : existingById.get(row.matchedExistingId);

    // Una fila ya importada nunca se reconcilia automáticamente al reimportarla: solo cambia
    // si el usuario elige explícitamente un recurrente/ocurrencia en la vista previa.
    if (row.duplicate && !hasOverride && !hasOccurrenceOverride) {
      return {
        ...row,
        recurringCostId: existing?.recurringCostId,
        recurringOccurrenceDate: existing?.recurringOccurrenceDate,
      };
    }

    const suggestion = hasOverride ? null : suggestRecurringMatch(row, recurringCosts);
    const recurringCostId = overriddenId === null ? undefined : (overriddenId ?? (row.duplicate ? existing?.recurringCostId : suggestion?.recurringCostId) ?? existing?.recurringCostId);
    const recurring = recurringCostId == null ? null : recurringCosts.find((item) => Number(item.id) === Number(recurringCostId)) || null;
    if (!recurring) return { ...row, reconciliationExplicit: hasOverride || hasOccurrenceOverride, recurringCostId: undefined, recurringOccurrenceDate: undefined };
    return {
      ...row,
      reconciliationExplicit: hasOverride || hasOccurrenceOverride,
      recurringCostId: Number(recurring.id),
      recurringOccurrenceDate: overriddenOccurrence || (row.duplicate && existing?.recurringOccurrenceDate ? existing.recurringOccurrenceDate : recurringOccurrenceDateForExpense(recurring, row.date)),
    };
  }), [preparedBase, kind, recurringCosts, recurringOverrides, recurringOccurrenceOverrides, existingById]);

  const validRows = useMemo(() => prepared.filter((row) => !row.error && !row.duplicate), [prepared]);
  const saleEnrichmentRows = useMemo(() => prepared.filter((row) => {
    if (kind !== 'sale' || row.error || !row.duplicate || row.matchedExistingId == null) return false;
    const current = existingById.get(row.matchedExistingId);
    const timeChanged = Boolean(row.occurredAt && (!current?.occurredAt || current.occurredAt !== row.occurredAt));
    const channelChanged = Boolean(row.channel && String(current?.channel || '').trim() !== String(row.channel).trim());
    return timeChanged || channelChanged;
  }), [prepared, kind, existingById]);
  const expenseEnrichmentRows = useMemo(() => prepared.filter((row) => {
    if (kind !== 'expense' || row.error || !row.duplicate || !row.reconciliationExplicit || row.matchedExistingId == null) return false;
    const current = existingById.get(row.matchedExistingId);
    return Number(current?.recurringCostId || 0) !== Number(row.recurringCostId || 0) || String(current?.recurringOccurrenceDate || '') !== String(row.recurringOccurrenceDate || '');
  }), [prepared, kind, existingById]);
  const importRows = useMemo(() => [...validRows, ...saleEnrichmentRows, ...expenseEnrichmentRows], [validRows, saleEnrichmentRows, expenseEnrichmentRows]);
  const invalidRows = useMemo(() => prepared.filter((row) => row.error), [prepared]);
  const duplicateRows = useMemo(() => prepared.filter((row) => !row.error && row.duplicate), [prepared]);
  const reconciledRows = useMemo(() => validRows.filter((row) => kind === 'expense' && row.recurringCostId != null), [validRows, kind]);
  const filteredPreviewRows = useMemo(() => {
    const query = previewQuery.trim().toLowerCase();
    if (!query) return prepared;
    return prepared.filter((row) => [row.rowNumber, row.date, row.amount, row.channel, row.category, row.note, row.reference, row.occurredAt].some((value) => String(value ?? '').toLowerCase().includes(query)));
  }, [prepared, previewQuery]);
  const previewPageCount = Math.max(1, Math.ceil(filteredPreviewRows.length / PREVIEW_PAGE_SIZE));
  const previewRows = filteredPreviewRows.slice(previewPage * PREVIEW_PAGE_SIZE, (previewPage + 1) * PREVIEW_PAGE_SIZE);

  useEffect(() => { setPreviewPage(0); }, [previewQuery, fileName, kind, sheetIndex]);
  useEffect(() => { if (previewPage >= previewPageCount) setPreviewPage(Math.max(0, previewPageCount - 1)); }, [previewPage, previewPageCount]);

  async function handleFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const parsed = await readImportWorkbook(file);
      if (!parsed.length) throw new Error('No encontramos filas para importar en ese archivo.');
      const preset = detectKnownImportPreset(parsed);
      setFileName(file.name);
      setRecurringOverrides({});
      setRecurringOccurrenceOverrides({});
      setMatchedProfileId(null);
      setKnownPreset(preset);
      setConfigExpanded(!preset);
      setSheets(parsed);
      setSheetIndex(preset?.sheetIndex ?? 0);
      if (preset) {
        setHeaderRow(preset.headerRow);
        setKind(preset.kind);
        setMapping(preset.mapping);
      }
    } catch (caught) {
      setSheets([]);
      setFileName('');
      setError(caught instanceof Error ? caught.message : 'No pudimos leer ese archivo.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function updateMapping(key: keyof ImportMapping, value: string) {
    setMatchedProfileId(null);
    setKnownPreset(null);
    setMapping((current) => ({ ...current, [key]: Number(value) }));
  }

  function rememberCurrentFormat() {
    if (!headers.length || mapping.date < 0 || mapping.amount < 0) return;
    const signature = headerSignature(headers);
    const now = new Date().toISOString();
    const currentId = matchedProfileId || `profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const nextProfile: ImportProfile = {
      id: currentId,
      signature,
      name: profileName(fileName),
      kind,
      dateHeader: headers[mapping.date] || '',
      timeHeader: mapping.time >= 0 ? headers[mapping.time] || '' : '',
      amountHeader: headers[mapping.amount] || '',
      channelHeader: mapping.channel >= 0 ? headers[mapping.channel] || '' : '',
      categoryHeader: mapping.category >= 0 ? headers[mapping.category] || '' : '',
      noteHeader: mapping.note >= 0 ? headers[mapping.note] || '' : '',
      referenceHeader: mapping.reference >= 0 ? headers[mapping.reference] || '' : '',
      fallbackCategory: kind === 'expense' && mapping.category < 0 ? fallbackCategory : '',
      lastUsedAt: now,
    };
    const next = [nextProfile, ...profiles.filter((profile) => profile.id !== currentId && profile.signature !== signature)].slice(0, 20);
    setProfiles(next);
    setMatchedProfileId(currentId);
    try { localStorage.setItem(IMPORT_PROFILES_KEY, JSON.stringify(next)); } catch { /* IndexedDB de movimientos sigue siendo independiente. */ }
  }

  function finishImport() {
    if (!canImport) return;
    const recognized = Boolean(matchedProfileId || knownPreset);
    rememberCurrentFormat();
    const entry: ImportHistoryItem = {
      id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      fileName,
      kind,
      imported: validRows.length + saleEnrichmentRows.length + expenseEnrichmentRows.length,
      duplicates: duplicateRows.length,
      invalid: invalidRows.length,
      importedAt: new Date().toISOString(),
      recognized,
    };
    const nextHistory = [entry, ...history].slice(0, 12);
    setHistory(nextHistory);
    try { localStorage.setItem(historyStorageKey(businessKey), JSON.stringify(nextHistory)); } catch { /* El historial es ayuda local, no bloquea la importación. */ }
    onImport(kind, importRows);
    if (sessionMode) {
      // Onboarding: una carga puede estar dividida en varios archivos (ej. ventas + gastos).
      // Volvemos al selector sin cerrar la sesión para que el usuario decida cuándo terminó.
      setFileName('');
      setSheets([]);
      setSheetIndex(0);
      setHeaderRow(0);
      setKnownPreset(null);
      setMatchedProfileId(null);
      setRecurringOverrides({});
      setRecurringOccurrenceOverrides({});
      setError('');
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const matchedProfile = profiles.find((profile) => profile.id === matchedProfileId) || null;
  const recognizedFormat = Boolean(matchedProfile || knownPreset);
  const canImport = importRows.length > 0 && mapping.date >= 0 && mapping.amount >= 0;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-sheet modal-sheet-wide import-modal-sheet">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow">CARGA MASIVA</div>
            <h2 className="mt-1 text-2xl font-black tracking-tight">Importar movimientos</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">{sessionMode ? 'Podés importar más de un archivo. Por ejemplo, primero ventas y después gastos; la carga termina recién cuando vos elegís terminar.' : 'Subí un CSV o Excel, indicá qué representa cada columna y revisá el resultado antes de tocar tus números.'}</p>
          </div>
          <button type="button" onClick={onClose} className="icon-button shrink-0"><X size={20} /></button>
        </div>

        <input ref={inputRef} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden" onChange={(event) => void handleFile(event.target.files?.[0] || null)} />

        {!sheet ? (
          <>
            <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="import-dropzone mt-7 w-full disabled:opacity-60">
              <span className="import-dropzone-icon"><FileSpreadsheet size={26} /></span>
              <strong>{busy ? 'Leyendo archivo…' : 'Elegir CSV o Excel'}</strong>
              <span>Los datos se procesan en este dispositivo antes de importarse.</span>
            </button>
            {history.length > 0 && (
              <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
                <div className="flex items-center gap-2"><Clock3 size={16} className="text-[var(--brand)]" /><strong className="text-sm">Importaciones recientes</strong></div>
                <div className="mt-3 divide-y divide-[var(--line)]">
                  {history.slice(0, 4).map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                      <div className="min-w-0"><strong className="block truncate text-[var(--ink)]">{item.fileName}</strong><span className="text-[var(--muted)]">{item.kind === 'sale' ? 'Ventas' : 'Gastos'} · {historyDate.format(new Date(item.importedAt))}</span></div>
                      <span className="shrink-0 font-extrabold text-[var(--brand)]">{item.imported} nuevas</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="import-file-card mt-7">
              <div className="min-w-0 flex-1">
                <span className="import-file-kicker">ARCHIVO</span>
                <strong className="block truncate">{fileName}</strong>
              </div>
              <button type="button" onClick={() => inputRef.current?.click()} className="small-button"><Upload size={15} /> Cambiar</button>
            </div>

            {knownPreset && (
              <div className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--brand-soft)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <span className="mt-0.5 text-[var(--brand)]"><Sparkles size={18} /></span>
                    <div><strong className="block text-sm text-[var(--ink)]">Detectamos un reporte de Fudo</strong><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Elegimos <strong>Ventas</strong>, <strong>Fecha → Fecha</strong>, <strong>Importe → Total</strong>, <strong>Canal → Origen</strong> y, cuando existe, también <strong>Hora</strong>. Podés reimportar ventas ya cargadas para enriquecerlas con canal u horario sin duplicarlas.</p></div>
                  </div>
                  <button type="button" onClick={() => setConfigExpanded((value) => !value)} className="small-button shrink-0">{configExpanded ? 'Ocultar' : 'Revisar'} <ChevronDown size={14} className={configExpanded ? 'rotate-180' : ''} /></button>
                </div>
              </div>
            )}

            {matchedProfile && (
              <div className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--brand-soft)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <span className="mt-0.5 text-[var(--brand)]"><Sparkles size={18} /></span>
                    <div><strong className="block text-sm text-[var(--ink)]">Lebu reconoció este formato</strong><p className="mt-1 text-xs leading-5 text-[var(--muted)]">Aplicamos la configuración que usaste la última vez con una estructura como esta.</p></div>
                  </div>
                  <button type="button" onClick={() => setConfigExpanded((value) => !value)} className="small-button shrink-0">{configExpanded ? 'Ocultar' : 'Revisar'} <ChevronDown size={14} className={configExpanded ? 'rotate-180' : ''} /></button>
                </div>
              </div>
            )}

            {sheets.length > 1 && (
              <label className="mt-5 block">
                <span className="field-label">Hoja</span>
                <select className="field-input" value={sheetIndex} onChange={(event) => { setKnownPreset(null); setSheetIndex(Number(event.target.value)); }}>
                  {sheets.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}
                </select>
              </label>
            )}

            {(configExpanded || !recognizedFormat) && <>
            <div className="mt-6 grid grid-cols-2 rounded-2xl bg-[var(--surface-soft)] p-1">
              <button type="button" onClick={() => { setKind('sale'); setMatchedProfileId(null); setKnownPreset(null); }} className={`segment-button flex items-center justify-center gap-2 ${kind === 'sale' ? 'segment-button-active' : ''}`}><ArrowUpRight size={16} /> Ventas</button>
              <button type="button" onClick={() => { setKind('expense'); setMatchedProfileId(null); setKnownPreset(null); }} className={`segment-button flex items-center justify-center gap-2 ${kind === 'expense' ? 'segment-button-active' : ''}`}><ArrowDownRight size={16} /> Gastos</button>
            </div>

            <div className="import-config-grid mt-6">
              <label>
                <span className="field-label">Fila de encabezados</span>
                <select className="field-input" value={headerRow} onChange={(event) => { setMatchedProfileId(null); setKnownPreset(null); setHeaderRow(Number(event.target.value)); }}>
                  {sheet.rows.slice(0, Math.min(sheet.rows.length, 10)).map((_, index) => <option key={index} value={index}>Fila {index + 1}</option>)}
                </select>
              </label>
            </div>

            <div className="mt-7">
              <div className="eyebrow">RELACIONAR COLUMNAS</div>
              <div className="import-mapping-grid mt-3">
                <ColumnSelect label="Fecha" required value={mapping.date} headers={headers} onChange={(value) => updateMapping('date', value)} />
                {kind === 'sale' && <ColumnSelect label="Hora" value={mapping.time} headers={headers} onChange={(value) => updateMapping('time', value)} hint="Opcional. También se detecta si la fecha ya trae hora. Sirve para analizar franjas horarias sin crear ventas nuevas." />}
                <ColumnSelect label="Importe" required value={mapping.amount} headers={headers} onChange={(value) => updateMapping('amount', value)} />
                {kind === 'sale' && <ColumnSelect label="Canal / origen" value={mapping.channel} headers={headers} onChange={(value) => updateMapping('channel', value)} hint="Ej. PedidosYa, mostrador, Rappi o venta directa. Si el archivo es de Fudo, Lebu usa la columna Origen." />}
                {kind === 'expense' && <ColumnSelect label="Categoría del archivo" value={mapping.category} headers={headers} onChange={(value) => updateMapping('category', value)} />}
                {kind === 'expense' && mapping.category < 0 && (
                  <label>
                    <span className="field-label">Categoría fija</span>
                    <select className="field-input" value={fallbackCategory} onChange={(event) => { setMatchedProfileId(null); setKnownPreset(null); setFallbackCategory(event.target.value); }}>
                      {[...new Set([...categories, 'Otros'])].map((category) => <option key={category}>{category}</option>)}
                    </select>
                  </label>
                )}
                {kind === 'expense' && <ColumnSelect label="Detalle / nota" value={mapping.note} headers={headers} onChange={(value) => updateMapping('note', value)} />}
                <ColumnSelect label="ID / referencia" value={mapping.reference} headers={headers} onChange={(value) => updateMapping('reference', value)} hint="Ayuda a reconocer filas repetidas entre exportaciones." />
              </div>
            </div>
            </>}

            {mapping.date < 0 || mapping.amount < 0 ? (
              <div className="import-warning mt-6"><AlertTriangle size={18} /><span>Elegí las columnas de <strong>Fecha</strong> e <strong>Importe</strong> para generar la vista previa.</span></div>
            ) : (
              <>
                <div className="import-summary mt-7">
                  <div><strong>{validRows.length}</strong><span>listas para importar</span></div>
                  {kind === 'sale' && <div><strong>{saleEnrichmentRows.length}</strong><span>actualizan canal/hora</span></div>}
                  {kind === 'expense' && <div><strong>{expenseEnrichmentRows.length}</strong><span>actualizan vínculo</span></div>}
                  <div><strong>{Math.max(duplicateRows.length - saleEnrichmentRows.length - expenseEnrichmentRows.length, 0)}</strong><span>ya cargadas</span></div>
                  <div><strong>{invalidRows.length}</strong><span>con error</span></div>
                </div>

                {kind === 'expense' && reconciledRows.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--brand-soft)] p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--brand)]" />
                      <div>
                        <strong className="block text-sm text-[var(--ink)]">{reconciledRows.length} gasto{reconciledRows.length === 1 ? '' : 's'} conciliado{reconciledRows.length === 1 ? '' : 's'} con recurrentes</strong>
                        <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Lebu los toma como pagos reales de esas ocurrencias. No se suman encima del gasto recurrente; solo ajustan la diferencia entre lo previsto y lo real.</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="eyebrow">VISTA PREVIA COMPLETA</div>
                    <p className="mt-1 text-xs text-[var(--muted)]">Podés buscar y recorrer todas las filas para revisar vínculos o actualizaciones.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input className="field-input min-w-[220px] py-2 text-xs" value={previewQuery} onChange={(event) => setPreviewQuery(event.target.value)} placeholder="Buscar fila, fecha, importe, nota…" aria-label="Buscar en la vista previa" />
                    <span className="soft-pill">{filteredPreviewRows.length} de {prepared.length}</span>
                  </div>
                </div>

                <div className="import-preview mt-3">
                  <table>
                    <thead><tr><th>Fila</th><th>Fecha</th>{kind === 'sale' && <th>Hora</th>}<th>{kind === 'sale' ? 'Venta' : 'Gasto'}</th>{kind === 'sale' && <th>Canal</th>}{kind === 'expense' && <th>Categoría</th>}{kind === 'expense' && recurringCosts.length > 0 && <th>Recurrente</th>}<th>Estado</th></tr></thead>
                    <tbody>
                      {previewRows.map((row) => (
                        <tr key={`${row.rowNumber}-${row.id}`}>
                          <td>{row.rowNumber}</td>
                          <td>{row.date || '—'}</td>
                          {kind === 'sale' && <td>{row.occurredAt ? row.occurredAt.slice(11, 16) : '—'}</td>}
                          <td>{row.amount > 0 ? money.format(row.amount) : '—'}</td>
                          {kind === 'sale' && <td>{row.channel || 'Directo'}</td>}
                          {kind === 'expense' && <td>{row.category || '—'}</td>}
                          {kind === 'expense' && recurringCosts.length > 0 && (
                            <td>
                              {row.error ? '—' : (() => {
                                const selectedRecurring = row.recurringCostId == null ? null : recurringCosts.find((item) => Number(item.id) === Number(row.recurringCostId)) || null;
                                const occurrenceDates = selectedRecurring
                                  ? Array.from(new Set([
                                      ...recurringOccurrenceCandidates(selectedRecurring, row.date),
                                      row.recurringOccurrenceDate || recurringOccurrenceDateForExpense(selectedRecurring, row.date),
                                    ].filter(Boolean))).sort()
                                  : [];
                                return (
                                  <div className="grid min-w-[170px] gap-1.5">
                                    <select
                                      className="field-input min-w-[150px] py-1.5 text-xs"
                                      value={row.recurringCostId == null ? '' : String(row.recurringCostId)}
                                      onChange={(event) => {
                                        const nextId = event.target.value ? Number(event.target.value) : null;
                                        setRecurringOverrides((current) => ({ ...current, [row.id]: nextId }));
                                        setRecurringOccurrenceOverrides((current) => {
                                          const next = { ...current };
                                          delete next[row.id];
                                          return next;
                                        });
                                      }}
                                      aria-label={`Vincular fila ${row.rowNumber} a gasto recurrente`}
                                    >
                                      <option value="">No vincular</option>
                                      {recurringCosts.map((item) => <option key={item.id} value={item.id}>{item.name || 'Gasto recurrente'}</option>)}
                                    </select>
                                    {selectedRecurring && row.recurringOccurrenceDate && (
                                      <select
                                        className="field-input min-w-[150px] py-1.5 text-[10px]"
                                        value={row.recurringOccurrenceDate}
                                        onChange={(event) => setRecurringOccurrenceOverrides((current) => ({ ...current, [row.id]: event.target.value }))}
                                        aria-label={`Elegir ocurrencia recurrente para fila ${row.rowNumber}`}
                                      >
                                        {occurrenceDates.map((date) => <option key={date} value={date}>{occurrenceOptionLabel(selectedRecurring, date)}</option>)}
                                      </select>
                                    )}
                                  </div>
                                );
                              })()}
                            </td>
                          )}
                          <td>{row.error ? <span className="import-status import-status-error">{row.error}</span> : row.duplicate && saleEnrichmentRows.some((candidate) => candidate.rowNumber === row.rowNumber && candidate.matchedExistingId === row.matchedExistingId) ? <span className="import-status import-status-ok"><Clock3 size={12} /> Actualiza hora</span> : row.duplicate && expenseEnrichmentRows.some((candidate) => candidate.rowNumber === row.rowNumber && candidate.matchedExistingId === row.matchedExistingId) ? <span className="import-status import-status-ok"><CheckCircle2 size={12} /> Actualiza vínculo</span> : row.duplicate ? <span className="import-status import-status-duplicate">Ya cargada</span> : row.recurringCostId != null ? <span className="import-status import-status-ok"><CheckCircle2 size={12} /> Concilia recurrente</span> : <span className="import-status import-status-ok"><CheckCircle2 size={12} /> Lista</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filteredPreviewRows.length > PREVIEW_PAGE_SIZE && (
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <button type="button" className="small-button" disabled={previewPage <= 0} onClick={() => setPreviewPage((page) => Math.max(0, page - 1))}>Anterior</button>
                    <span className="text-xs font-bold text-[var(--muted)]">Página {previewPage + 1} de {previewPageCount}</span>
                    <button type="button" className="small-button" disabled={previewPage + 1 >= previewPageCount} onClick={() => setPreviewPage((page) => Math.min(previewPageCount - 1, page + 1))}>Siguiente</button>
                  </div>
                )}

                {kind === 'expense' && recurringCosts.length > 0 && prepared.length > PREVIEW_PAGE_SIZE && <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Podés buscar cualquier gasto y asignarle manualmente un recurrente. Las coincidencias automáticas siguen siendo conservadoras: si Lebu duda, no vincula.</p>}
                {invalidRows.length > 0 && <p className="mt-3 text-xs leading-5 text-[var(--muted)]">Las filas con fecha o importe inválido no se importan. En gastos, importes negativos se interpretan como egresos y se guardan en positivo.</p>}
                {sheet.rows.length - headerRow - 1 > MAX_IMPORT_ROWS && <div className="import-warning mt-3"><AlertTriangle size={18} /><span>Este archivo supera {MAX_IMPORT_ROWS.toLocaleString('es-AR')} filas. Para mantener Lebu ágil, esta importación toma las primeras {MAX_IMPORT_ROWS.toLocaleString('es-AR')} filas de datos.</span></div>}
              </>
            )}
          </>
        )}

        {error && <div className="import-warning mt-5"><AlertTriangle size={18} /><span>{error}</span></div>}

        <div className="modal-footer-sticky mt-7 flex items-center justify-end gap-2 border-t border-[var(--line)] pt-5">
          <button type="button" onClick={onClose} className="secondary-button justify-center">{sessionMode ? 'Terminar carga' : 'Cancelar'}</button>
          {sheet && <button type="button" disabled={!canImport} onClick={finishImport} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-45"><Upload size={17} /> Importar {importRows.length || ''}</button>}
        </div>
      </div>
    </div>
  );
}

function ColumnSelect({ label, required = false, value, headers, onChange, hint }: { label: string; required?: boolean; value: number; headers: string[]; onChange: (value: string) => void; hint?: string }) {
  return (
    <label>
      <span className="field-label">{label}{required ? ' *' : ''}</span>
      <select className="field-input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value={-1}>{required ? 'Elegir columna…' : 'No usar'}</option>
        {headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header}</option>)}
      </select>
      {hint && <span className="mt-1 block text-[10px] leading-4 text-[var(--muted)]">{hint}</span>}
    </label>
  );
}
