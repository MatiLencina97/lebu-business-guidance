'use client';

import { createClient, type AuthChangeEvent, type Session, type User } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildKeyedDelta,
  emptyTombstones,
  exceptionKey,
  expenseKey,
  hasMeaningfulData,
  mergeInitialCloudStates,
  mergeConcurrentCloudStates,
  normalizedState,
  recurringKey,
  saleKey,
  settingsChanged,
  snapshotKey,
  withBusinessSettings,
  stableState,
  type CloudState,
  type CloudTombstones,
} from './cloud-sync-core';

export type { CloudState } from './cloud-sync-core';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_example';
const PRODUCTION_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const configuredAppUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
const AUTH_REDIRECT_URL = configuredAppUrl && !/^(https?:\/\/)?(localhost|127\.0\.0\.1)(:|\/|$)/i.test(configuredAppUrl)
  ? configuredAppUrl.replace(/\/$/, '')
  : PRODUCTION_APP_URL;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export type CloudSyncStatus = 'signed-out' | 'connecting' | 'synced' | 'pending' | 'offline' | 'error';
export type TeamRole = 'owner' | 'admin' | 'operator' | 'viewer';
export type CloudBusinessOption = { businessId: string; name: string; role: TeamRole; memberEmail: string };

type SyncMeta = {
  businessId: string;
  syncedState: string;
  syncedAt: string;
};

type RemoteDataset = {
  state: CloudState;
  tombstones: CloudTombstones;
};

type SettingsRow = {
  business_id: string;
  profit_target: number | string;
  period_type: string;
  period_start_day?: number | string | null;
  historical_summary?: Record<string, unknown> | null;
  open_weekdays: number[];
  categories: string[];
  sounds_enabled: boolean;
  smart_distribution_enabled: boolean;
  available_cash?: number | string | null;
  cash_updated_at?: string | null;
  cash_adjustments?: unknown;
  updated_by_client?: string | null;
};

type SaleRow = { id: number | string; sale_date: string; amount: number | string; cash_effect_amount?: number | string | null; cash_effect_at?: string | null; source?: string | null; external_id?: string | null; source_updated_at?: string | null; source_metadata?: Record<string, unknown> | null; payment_breakdown?: unknown; deleted_at?: string | null; updated_by_client?: string | null; created_by?: string | null; created_by_email?: string | null; created_at?: string | null; updated_by?: string | null; updated_by_email?: string | null };
type ExpenseRow = { id: number | string; expense_date: string; amount: number | string; category: string; note: string; cash_effect_amount?: number | string | null; cash_effect_at?: string | null; recurring_cost_id?: number | string | null; recurring_occurrence_date?: string | null; reconciliation_source?: string | null; deleted_at?: string | null; updated_by_client?: string | null; created_by?: string | null; created_by_email?: string | null; created_at?: string | null; updated_by?: string | null; updated_by_email?: string | null };
type RecurringRow = { id: number | string; name: string; amount: number | string; frequency: string; amount_is_estimate?: boolean | null; payment_schedule?: Record<string, unknown> | null; config_history?: unknown; deleted_at?: string | null; updated_by_client?: string | null };
type ExceptionRow = { exception_date: string; is_open: boolean; deleted_at?: string | null; updated_by_client?: string | null };
type SnapshotRow = {
  snapshot_date: string;
  period_start: string;
  period_end: string;
  daily_needed: number | string;
  current_profit: number | string;
  sold_so_far: number | string;
  total_expenses: number | string;
  projected_profit: number | string;
  target: number | string;
  reference_daily_target?: number | string | null;
  deleted_at?: string | null;
  updated_by_client?: string | null;
};

const META_KEY = 'lebu-cloud-sync-meta-v2';
const LEGACY_META_KEY = 'lebu-cloud-sync-meta-v1';
const CLIENT_KEY = 'lebu-cloud-client-id-v1';
const BUSINESS_CACHE_PREFIX = 'lebu-business-memberships-v1:';

function readBusinessCache(userId: string): CloudBusinessOption[] {
  try {
    const raw = localStorage.getItem(`${BUSINESS_CACHE_PREFIX}${userId}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeBusinessCache(userId: string, list: CloudBusinessOption[]) {
  try { localStorage.setItem(`${BUSINESS_CACHE_PREFIX}${userId}`, JSON.stringify(list)); } catch { /* IndexedDB/state sigue disponible. */ }
}

function getClientId() {
  try {
    const existing = localStorage.getItem(CLIENT_KEY);
    if (existing) return existing;
    const created = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `lebu-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(CLIENT_KEY, created);
    return created;
  } catch {
    return `lebu-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function readMeta(): SyncMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.businessId || typeof parsed.syncedState !== 'string') return null;
    return parsed as SyncMeta;
  } catch {
    return null;
  }
}

function parseSyncedState(meta: SyncMeta | null): CloudState | null {
  if (!meta) return null;
  try {
    const parsed = JSON.parse(meta.syncedState);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeMeta(businessId: string, state: CloudState) {
  localStorage.setItem(META_KEY, JSON.stringify({
    businessId,
    syncedState: stableState(state),
    syncedAt: new Date().toISOString(),
  } satisfies SyncMeta));
  localStorage.removeItem(LEGACY_META_KEY);
}

function clearMeta() {
  localStorage.removeItem(META_KEY);
  localStorage.removeItem(LEGACY_META_KEY);
}

function numberText(value: unknown) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric === 0) return numeric === 0 ? '0' : '';
  return String(Number.isInteger(numeric) ? numeric : Math.round(numeric * 100) / 100);
}

function asNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function ensureBusiness() {
  const { data, error } = await supabase.rpc('get_or_create_my_business');
  if (error) throw error;
  if (!data) throw new Error('No se pudo preparar tu comercio en la nube.');
  return String(data);
}

function throwIfError(error: { message?: string } | null) {
  if (error) throw new Error(error.message || 'No se pudo sincronizar Lebu.');
}

async function fetchAllMovementRows<T>(table: 'business_sales' | 'business_expenses', businessId: string, orderColumn: 'id'): Promise<T[]> {
  // PostgREST puede limitar la cantidad máxima de filas por respuesta. Un negocio con historial
  // y tombstones puede superar ese límite aunque el período actual tenga pocas ventas. Si leemos
  // una sola página, Cloud v2 termina reemplazando el estado local por un dataset incompleto.
  const pageSize = 500;
  const result: T[] = [];
  for (let from = 0, page = 0; page < 200; page += 1, from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('business_id', businessId)
      .order(orderColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    throwIfError(error);
    const batch = (data || []) as T[];
    result.push(...batch);
    if (batch.length < pageSize) return result;
  }
  throw new Error('El historial de movimientos es demasiado grande para sincronizarlo de forma segura.');
}

async function fetchRemoteDataset(businessId: string): Promise<RemoteDataset> {
  const [settingsResult, sales, expenses, recurringResult, exceptionsResult, snapshotsResult] = await Promise.all([
    supabase.from('business_settings').select('*').eq('business_id', businessId).maybeSingle(),
    fetchAllMovementRows<SaleRow>('business_sales', businessId, 'id'),
    fetchAllMovementRows<ExpenseRow>('business_expenses', businessId, 'id'),
    supabase.from('business_recurring_costs').select('*').eq('business_id', businessId),
    supabase.from('business_day_exceptions').select('*').eq('business_id', businessId),
    supabase.from('business_daily_snapshots').select('*').eq('business_id', businessId),
  ]);

  throwIfError(settingsResult.error);
  throwIfError(recurringResult.error);
  throwIfError(exceptionsResult.error);
  throwIfError(snapshotsResult.error);

  const settings = settingsResult.data as SettingsRow | null;
  const recurring = (recurringResult.data || []) as RecurringRow[];
  const exceptions = (exceptionsResult.data || []) as ExceptionRow[];
  const snapshots = (snapshotsResult.data || []) as SnapshotRow[];

  const tombstones = emptyTombstones();
  tombstones.sales = sales.filter((row) => row.deleted_at).map((row) => String(row.id));
  tombstones.expenses = expenses.filter((row) => row.deleted_at).map((row) => String(row.id));
  tombstones.recurringCosts = recurring.filter((row) => row.deleted_at).map((row) => String(row.id));
  tombstones.dayExceptions = exceptions.filter((row) => row.deleted_at).map((row) => row.exception_date);
  tombstones.dailySnapshots = snapshots.filter((row) => row.deleted_at).map((row) => `${row.snapshot_date}|${row.period_start}|${row.period_end}`);

  return {
    tombstones,
    state: normalizedState({
      schemaVersion: 16,
      profitTarget: settings ? numberText(settings.profit_target) : '',
      periodType: settings?.period_type || 'monthly',
      periodStartDay: settings?.period_start_day == null ? 1 : Number(settings.period_start_day),
      historicalSummary: settings?.historical_summary && typeof settings.historical_summary === 'object' ? settings.historical_summary : null,
      openWeekdays: Array.isArray(settings?.open_weekdays) ? settings!.open_weekdays.map(Number) : [0, 1, 2, 3, 4, 5, 6],
      categories: Array.isArray(settings?.categories) ? settings!.categories.map(String) : [],
      soundsEnabled: settings?.sounds_enabled ?? true,
      smartDistributionEnabled: settings?.smart_distribution_enabled ?? true,
      availableCash: settings?.available_cash == null ? '' : numberText(settings.available_cash),
      cashUpdatedAt: settings?.cash_updated_at || '',
      cashAdjustments: Array.isArray(settings?.cash_adjustments) ? settings!.cash_adjustments : [],
      sales: sales.filter((row) => !row.deleted_at).map((row) => ({
        id: Number(row.id), date: row.sale_date, amount: numberText(row.amount),
        cashEffectAmount: row.cash_effect_amount == null ? undefined : numberText(row.cash_effect_amount),
        cashEffectAt: row.cash_effect_at || undefined,
        source: row.source || 'manual', externalId: row.external_id || undefined, sourceUpdatedAt: row.source_updated_at || undefined,
        sourceMetadata: row.source_metadata && typeof row.source_metadata === 'object' ? row.source_metadata : undefined,
        paymentBreakdown: Array.isArray(row.payment_breakdown) ? row.payment_breakdown : undefined,
        occurredAt: typeof row.source_metadata?.occurredAt === 'string' ? row.source_metadata.occurredAt : undefined,
        ticketId: row.source === 'fudo' && row.external_id ? String(row.external_id) : undefined,
        items: Array.isArray(row.source_metadata?.items) ? row.source_metadata.items : undefined,
        createdBy: row.created_by || undefined, createdByEmail: row.created_by_email || undefined, createdAt: row.created_at || undefined,
        updatedBy: row.updated_by || undefined, updatedByEmail: row.updated_by_email || undefined,
      })),
      expenses: expenses.filter((row) => !row.deleted_at).map((row) => ({
        id: Number(row.id), date: row.expense_date, amount: numberText(row.amount), category: row.category || 'Otros', note: row.note || '',
        cashEffectAmount: row.cash_effect_amount == null ? undefined : numberText(row.cash_effect_amount),
        cashEffectAt: row.cash_effect_at || undefined,
        recurringCostId: row.recurring_cost_id == null ? undefined : Number(row.recurring_cost_id),
        recurringOccurrenceDate: row.recurring_occurrence_date || undefined,
        reconciliationSource: row.reconciliation_source || undefined,
        createdBy: row.created_by || undefined, createdByEmail: row.created_by_email || undefined, createdAt: row.created_at || undefined,
        updatedBy: row.updated_by || undefined, updatedByEmail: row.updated_by_email || undefined,
      })),
      recurringCosts: recurring.filter((row) => !row.deleted_at).map((row) => ({
        id: Number(row.id), name: row.name || 'Gasto recurrente', amount: numberText(row.amount), frequency: row.frequency || 'monthly', amountApproximate: Boolean(row.amount_is_estimate), paymentSchedule: row.payment_schedule && typeof row.payment_schedule === 'object' ? row.payment_schedule : null, configHistory: Array.isArray(row.config_history) ? row.config_history : [],
      })),
      dayExceptions: exceptions.filter((row) => !row.deleted_at).map((row) => ({ date: row.exception_date, open: Boolean(row.is_open) })),
      dailySnapshots: snapshots.filter((row) => !row.deleted_at).map((row) => ({
        date: row.snapshot_date,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        dailyNeeded: asNumber(row.daily_needed),
        currentProfit: asNumber(row.current_profit),
        soldSoFar: asNumber(row.sold_so_far),
        totalExpenses: asNumber(row.total_expenses),
        projectedProfit: asNumber(row.projected_profit),
        target: asNumber(row.target),
        referenceDailyTarget: row.reference_daily_target == null ? undefined : asNumber(row.reference_daily_target),
      })),
    }),
  };
}

async function upsertRows(table: string, rows: Record<string, unknown>[], onConflict: string) {
  if (!rows.length) return;
  // Las importaciones pueden agregar cientos o miles de movimientos de una vez.
  // Enviamos lotes moderados para no depender de un payload HTTP gigante.
  const batchSize = 250;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    throwIfError(error);
  }
}

async function pushLocalChanges({
  businessId,
  userId,
  clientId,
  base,
  local,
}: {
  businessId: string;
  userId: string;
  clientId: string;
  base: CloudState;
  local: CloudState;
}) {
  const now = new Date().toISOString();
  const common = { business_id: businessId, updated_by: userId, updated_by_client: clientId };
  const movementAudit = (item: any) => ({
    created_by: item?.createdBy || undefined,
    created_by_email: item?.createdByEmail || undefined,
    created_at: item?.createdAt || undefined,
  });
  const operations: Promise<void>[] = [];

  if (settingsChanged(base, local)) {
    const state = normalizedState(local);
    // 1.21.5: la configuración crítica del negocio se escribe primero y por separado.
    // Si más tarde falla un movimiento/snapshot, objetivo, período y días abiertos ya quedaron
    // persistidos en Cloud y el resto de los dispositivos puede converger a esa configuración.
    await upsertRows('business_settings', [{
      ...common,
      profit_target: Number(String(state.profitTarget || '').replace(/[^0-9.-]/g, '')) || 0,
      period_type: state.periodType,
      period_start_day: state.periodStartDay,
      historical_summary: state.historicalSummary,
      open_weekdays: state.openWeekdays,
      categories: Array.isArray(local.categories) ? local.categories.map(String) : [],
      sounds_enabled: state.soundsEnabled,
      smart_distribution_enabled: state.smartDistributionEnabled,
      available_cash: Number(String(state.availableCash || '').replace(/[^0-9.-]/g, '')) || 0,
      cash_updated_at: state.cashUpdatedAt || null,
      cash_adjustments: state.cashAdjustments,
      schema_version: 16,
    }], 'business_id');
  }

  const salesDelta = buildKeyedDelta(base.sales, local.sales, saleKey);
  operations.push(upsertRows('business_sales', [
    ...salesDelta.upserts.map((item) => ({ ...common, ...movementAudit(item), id: Number(item.id), sale_date: item.date, amount: Number(String(item.amount).replace(/[^0-9.-]/g, '')) || 0, cash_effect_amount: item.cashEffectAmount == null ? null : Number(String(item.cashEffectAmount).replace(/[^0-9.-]/g, '')) || 0, cash_effect_at: item.cashEffectAt || null, source: item.source || 'manual', external_id: item.externalId || null, source_updated_at: item.sourceUpdatedAt || null, source_metadata: (item.sourceMetadata || item.occurredAt || item.items) ? { ...(item.sourceMetadata || {}), ...(item.occurredAt ? { occurredAt: item.occurredAt } : {}), ...(Array.isArray(item.items) ? { items: item.items } : {}) } : null, payment_breakdown: item.paymentBreakdown || null, deleted_at: null })),
    ...salesDelta.deleted.map((item) => ({ ...common, ...movementAudit(item), id: Number(item.id), sale_date: item.date, amount: Number(String(item.amount).replace(/[^0-9.-]/g, '')) || 0, cash_effect_amount: item.cashEffectAmount == null ? null : Number(String(item.cashEffectAmount).replace(/[^0-9.-]/g, '')) || 0, cash_effect_at: item.cashEffectAt || null, source: item.source || 'manual', external_id: item.externalId || null, source_updated_at: item.sourceUpdatedAt || null, source_metadata: (item.sourceMetadata || item.occurredAt || item.items) ? { ...(item.sourceMetadata || {}), ...(item.occurredAt ? { occurredAt: item.occurredAt } : {}), ...(Array.isArray(item.items) ? { items: item.items } : {}) } : null, payment_breakdown: item.paymentBreakdown || null, deleted_at: now })),
  ], 'business_id,id'));

  const expensesDelta = buildKeyedDelta(base.expenses, local.expenses, expenseKey);
  operations.push(upsertRows('business_expenses', [
    ...expensesDelta.upserts.map((item) => ({ ...common, ...movementAudit(item), id: Number(item.id), expense_date: item.date, amount: Number(String(item.amount).replace(/[^0-9.-]/g, '')) || 0, category: item.category || 'Otros', note: item.note || '', cash_effect_amount: item.cashEffectAmount == null ? null : Number(String(item.cashEffectAmount).replace(/[^0-9.-]/g, '')) || 0, cash_effect_at: item.cashEffectAt || null, recurring_cost_id: item.recurringCostId == null ? null : Number(item.recurringCostId), recurring_occurrence_date: item.recurringOccurrenceDate || null, reconciliation_source: item.reconciliationSource || null, deleted_at: null })),
    ...expensesDelta.deleted.map((item) => ({ ...common, ...movementAudit(item), id: Number(item.id), expense_date: item.date, amount: Number(String(item.amount).replace(/[^0-9.-]/g, '')) || 0, category: item.category || 'Otros', note: item.note || '', cash_effect_amount: item.cashEffectAmount == null ? null : Number(String(item.cashEffectAmount).replace(/[^0-9.-]/g, '')) || 0, cash_effect_at: item.cashEffectAt || null, recurring_cost_id: item.recurringCostId == null ? null : Number(item.recurringCostId), recurring_occurrence_date: item.recurringOccurrenceDate || null, reconciliation_source: item.reconciliationSource || null, deleted_at: now })),
  ], 'business_id,id'));

  const recurringDelta = buildKeyedDelta(base.recurringCosts, local.recurringCosts, recurringKey);
  operations.push(upsertRows('business_recurring_costs', [
    ...recurringDelta.upserts.map((item) => ({ ...common, id: Number(item.id), name: item.name || 'Gasto recurrente', amount: Number(String(item.amount).replace(/[^0-9.-]/g, '')) || 0, frequency: item.frequency || 'monthly', amount_is_estimate: Boolean(item.amountApproximate), payment_schedule: item.paymentSchedule || null, config_history: Array.isArray(item.configHistory) ? item.configHistory : [], deleted_at: null })),
    ...recurringDelta.deleted.map((item) => ({ ...common, id: Number(item.id), name: item.name || 'Gasto recurrente', amount: Number(String(item.amount).replace(/[^0-9.-]/g, '')) || 0, frequency: item.frequency || 'monthly', amount_is_estimate: Boolean(item.amountApproximate), payment_schedule: item.paymentSchedule || null, config_history: Array.isArray(item.configHistory) ? item.configHistory : [], deleted_at: now })),
  ], 'business_id,id'));

  const exceptionsDelta = buildKeyedDelta(base.dayExceptions, local.dayExceptions, exceptionKey);
  operations.push(upsertRows('business_day_exceptions', [
    ...exceptionsDelta.upserts.map((item) => ({ ...common, exception_date: item.date, is_open: Boolean(item.open), deleted_at: null })),
    ...exceptionsDelta.deleted.map((item) => ({ ...common, exception_date: item.date, is_open: Boolean(item.open), deleted_at: now })),
  ], 'business_id,exception_date'));

  const snapshotsDelta = buildKeyedDelta(base.dailySnapshots, local.dailySnapshots, snapshotKey);
  const snapshotRow = (item: any, deletedAt: string | null) => ({
    ...common,
    snapshot_date: item.date,
    period_start: item.periodStart,
    period_end: item.periodEnd,
    daily_needed: asNumber(item.dailyNeeded),
    current_profit: asNumber(item.currentProfit),
    sold_so_far: asNumber(item.soldSoFar),
    total_expenses: asNumber(item.totalExpenses),
    projected_profit: asNumber(item.projectedProfit),
    target: asNumber(item.target),
    reference_daily_target: item.referenceDailyTarget == null ? null : asNumber(item.referenceDailyTarget),
    deleted_at: deletedAt,
  });
  operations.push(upsertRows('business_daily_snapshots', [
    ...snapshotsDelta.upserts.map((item) => snapshotRow(item, null)),
    ...snapshotsDelta.deleted.map((item) => snapshotRow(item, now)),
  ], 'business_id,snapshot_date,period_start,period_end'));

  await Promise.all(operations);
}

export function useLebuCloudSync({
  hydrated,
  online,
  state,
  applyState,
}: {
  hydrated: boolean;
  online: boolean;
  state: CloudState;
  applyState: (state: CloudState) => void;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<CloudBusinessOption[]>([]);
  const [role, setRole] = useState<TeamRole | null>(null);
  const [status, setStatus] = useState<CloudSyncStatus>('signed-out');
  const [message, setMessage] = useState('');
  const stateRef = useRef(state);
  const userRef = useRef<User | null>(null);
  const businessRef = useRef<string | null>(null);
  const businessesRef = useRef<CloudBusinessOption[]>([]);
  const syncLockRef = useRef(false);
  const debounceRef = useRef<number | null>(null);
  const realtimeDebounceRef = useRef<number | null>(null);
  const initializedUserRef = useRef<string | null>(null);
  const expectedRemoteStateRef = useRef<string | null>(null);
  const queuedSyncRef = useRef(false);
  const synchronizeRef = useRef<(() => Promise<boolean>) | null>(null);
  const clientIdRef = useRef<string>('');

  const activeBusinessKey = (uid: string) => `lebu-active-business-v1:${uid}`;

  useEffect(() => {
    if (!clientIdRef.current) clientIdRef.current = getClientId();
  }, []);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { businessRef.current = businessId; }, [businessId]);
  useEffect(() => { businessesRef.current = businesses; }, [businesses]);

  const clearDebounce = useCallback(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const markSynced = useCallback((bid: string, syncedState: CloudState) => {
    writeMeta(bid, syncedState);
    setStatus('synced');
    setMessage('');
  }, []);

  const applyRemoteState = useCallback((bid: string, remoteState: CloudState) => {
    clearDebounce();
    const serialized = stableState(remoteState);
    expectedRemoteStateRef.current = serialized;
    stateRef.current = remoteState;
    markSynced(bid, remoteState);
    applyState(remoteState);
  }, [applyState, clearDebounce, markSynced]);

  const fetchBusinesses = useCallback(async (): Promise<CloudBusinessOption[]> => {
    const { data, error } = await supabase.rpc('get_my_businesses');
    throwIfError(error);
    return (data || []).map((row: any) => ({
      businessId: String(row.business_id),
      name: String(row.business_name || 'Mi negocio'),
      role: row.role as TeamRole,
      memberEmail: String(row.member_email || ''),
    }));
  }, []);

  const refreshBusinesses = useCallback(async () => {
    const list = await fetchBusinesses();
    setBusinesses(list);
    businessesRef.current = list;
    if (userRef.current) writeBusinessCache(userRef.current.id, list);
    const current = list.find((item) => item.businessId === businessRef.current);
    setRole(current?.role || null);
    return list;
  }, [fetchBusinesses]);

  const synchronize = useCallback(async (): Promise<boolean> => {
    const currentUser = userRef.current;
    const bid = businessRef.current;
    if (!currentUser || !bid) return false;
    if (!navigator.onLine) { setStatus('offline'); return false; }
    if (syncLockRef.current) {
      queuedSyncRef.current = true;
      return false;
    }

    syncLockRef.current = true;
    setStatus('connecting');
    try {
      const localAtStart = normalizedState(stateRef.current);
      const localAtStartSerialized = stableState(localAtStart);
      let remote = await fetchRemoteDataset(bid);
      const meta = readMeta();
      const matchingMeta = meta?.businessId === bid ? meta : null;

      if (!matchingMeta) {
        const currentMembership = businessesRef.current.find((item) => item.businessId === bid);
        const remoteHasHistory = hasMeaningfulData(remote.state)
          || Object.values(remote.tombstones).some((items) => Array.isArray(items) && items.length > 0);
        // Un dispositivo sin metadata sólo puede sembrar Cloud cuando el negocio está realmente vacío.
        // Si Cloud ya tiene datos/historial, remoto gana. Esto evita resucitar copias locales viejas.
        const canSeedCloud = currentMembership?.role === 'owner'
          && hasMeaningfulData(localAtStart)
          && !remoteHasHistory;
        const merged = canSeedCloud
          ? mergeInitialCloudStates(localAtStart, remote.state, remote.tombstones)
          : remote.state;

        if (stableState(merged) !== stableState(remote.state)) {
          await pushLocalChanges({ businessId: bid, userId: currentUser.id, clientId: clientIdRef.current || getClientId(), base: remote.state, local: merged });
          remote = await fetchRemoteDataset(bid);
        }

        if (stableState(stateRef.current) !== localAtStartSerialized) {
          setStatus('pending');
          queuedSyncRef.current = true;
          return false;
        }

        if (stableState(remote.state) !== localAtStartSerialized) {
          applyRemoteState(bid, remote.state);
          // La UI todavía tiene el render anterior. Esperamos el próximo render antes de
          // construir cualquier snapshot/notificación con esos datos nuevos.
          return false;
        }
        markSynced(bid, remote.state);
        return true;
      }

      const base = parseSyncedState(matchingMeta) || remote.state;
      // Merge de tres vías antes de escribir: preserva cambios remotos que este dispositivo
      // todavía no vio y aplica únicamente los cambios locales que no entran en conflicto.
      const merged = mergeConcurrentCloudStates(base, localAtStart, remote.state);

      // 1.21.5: business_settings es una sola configuración compartida por comercio.
      // Si la resolución de tres vías indica que este dispositivo tiene objetivo/período/etc.
      // desactualizados, aplicamos esa configuración antes de intentar sincronizar registros.
      // Esto evita que un error en ventas/gastos/snapshots deje, por ejemplo, $500.000 en PC
      // mientras Cloud y el celular ya trabajan con $1.000.000.
      if (settingsChanged(localAtStart, merged)) {
        const reconciledSettingsState = withBusinessSettings(localAtStart, merged);
        stateRef.current = reconciledSettingsState;
        setStatus('pending');
        applyState(reconciledSettingsState);
        queuedSyncRef.current = true;
        return false;
      }

      if (stableState(merged) !== stableState(remote.state)) {
        await pushLocalChanges({
          businessId: bid,
          userId: currentUser.id,
          clientId: clientIdRef.current || getClientId(),
          base: remote.state,
          local: merged,
        });
      }

      remote = await fetchRemoteDataset(bid);
      if (stableState(stateRef.current) !== localAtStartSerialized) {
        setStatus('pending');
        queuedSyncRef.current = true;
        return false;
      }

      if (stableState(remote.state) !== localAtStartSerialized) {
        applyRemoteState(bid, remote.state);
        return false;
      }
      markSynced(bid, remote.state);
      return true;
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'No se pudo sincronizar Lebu.');
      return false;
    } finally {
      syncLockRef.current = false;
      if (queuedSyncRef.current) {
        queuedSyncRef.current = false;
        window.setTimeout(() => void synchronizeRef.current?.(), 100);
      }
    }
  }, [applyRemoteState, markSynced]);

  synchronizeRef.current = synchronize;

  const loadBusinessFromCloud = useCallback(async (bid: string) => {
    if (!navigator.onLine) throw new Error('Necesitás conexión para cambiar de comercio.');
    setStatus('connecting');
    clearDebounce();
    const remote = await fetchRemoteDataset(bid);
    businessRef.current = bid;
    setBusinessId(bid);
    const membership = businessesRef.current.find((item) => item.businessId === bid);
    setRole(membership?.role || null);
    const currentUser = userRef.current;
    if (currentUser) localStorage.setItem(activeBusinessKey(currentUser.id), bid);
    applyRemoteState(bid, remote.state);
  }, [applyRemoteState, clearDebounce]);

  const prepareUserBusiness = useCallback(async (currentUser: User) => {
    const { data: claimed, error: claimError } = await supabase.rpc('claim_my_team_invitations');
    throwIfError(claimError);
    let list = await fetchBusinesses();
    if (!list.length) {
      await ensureBusiness();
      list = await fetchBusinesses();
    }
    setBusinesses(list);
    businessesRef.current = list;
    writeBusinessCache(currentUser.id, list);

    const claimedRows = (claimed || []) as Array<{ business_id?: string }>;
    const claimedBusinessId = claimedRows.length ? String(claimedRows[claimedRows.length - 1].business_id || '') : '';
    const meta = readMeta();
    const stored = localStorage.getItem(activeBusinessKey(currentUser.id));
    const selected = list.find((item) => item.businessId === claimedBusinessId)
      || list.find((item) => item.businessId === stored)
      || list.find((item) => item.businessId === meta?.businessId)
      || list[0];
    if (!selected) throw new Error('No se pudo elegir un comercio para la cuenta.');

    businessRef.current = selected.businessId;
    setBusinessId(selected.businessId);
    setRole(selected.role);
    localStorage.setItem(activeBusinessKey(currentUser.id), selected.businessId);
    initializedUserRef.current = currentUser.id;

    const mustLoadRemote = Boolean(claimedBusinessId)
      || Boolean(meta && meta.businessId !== selected.businessId)
      || (!meta && (list.length > 1 || selected.role !== 'owner'));

    if (mustLoadRemote) {
      const remote = await fetchRemoteDataset(selected.businessId);
      applyRemoteState(selected.businessId, remote.state);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await synchronizeRef.current?.();
    }
  }, [applyRemoteState, fetchBusinesses]);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (mounted) setUser(data.session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setUser(session?.user ?? null);
      if (!session) {
        setBusinessId(null);
        setBusinesses([]);
        setRole(null);
        setStatus('signed-out');
        initializedUserRef.current = null;
        expectedRemoteStateRef.current = null;
      }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!hydrated || !user) return;
    if (!online) {
      if (!businessId) {
        const cached = readBusinessCache(user.id);
        const stored = localStorage.getItem(activeBusinessKey(user.id));
        const selected = cached.find((item) => item.businessId === stored) || cached[0];
        if (selected) {
          setBusinesses(cached); businessesRef.current = cached;
          setBusinessId(selected.businessId); businessRef.current = selected.businessId;
          setRole(selected.role); initializedUserRef.current = user.id;
        }
      }
      setStatus('offline');
      return;
    }
    if (initializedUserRef.current === user.id && businessId) return;
    let cancelled = false;
    setStatus('connecting');
    void prepareUserBusiness(user).catch((error) => {
      if (!cancelled) {
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'No se pudo conectar la cuenta.');
      }
    });
    return () => { cancelled = true; };
  }, [hydrated, user, online, businessId, prepareUserBusiness]);

  useEffect(() => {
    if (!hydrated || !user || !businessId) return;
    if (!online) { setStatus('offline'); return; }

    const currentSerialized = stableState(state);
    if (expectedRemoteStateRef.current) {
      if (expectedRemoteStateRef.current === currentSerialized) expectedRemoteStateRef.current = null;
      return;
    }

    const meta = readMeta();
    if (meta && meta.businessId === businessId && meta.syncedState === currentSerialized) return;
    setStatus('pending');
    clearDebounce();
    debounceRef.current = window.setTimeout(() => void synchronizeRef.current?.(), 700);
    return clearDebounce;
  }, [hydrated, user, businessId, online, state, clearDebounce]);

  useEffect(() => {
    if (!user || !businessId || !online) return;

    const onRemoteChange = (payload: any) => {
      const row = (payload.new || payload.old || {}) as { updated_by_client?: string | null };
      if (row.updated_by_client && row.updated_by_client === clientIdRef.current) return;
      if (realtimeDebounceRef.current) window.clearTimeout(realtimeDebounceRef.current);
      realtimeDebounceRef.current = window.setTimeout(() => void synchronizeRef.current?.(), 180);
    };

    const filter = `business_id=eq.${businessId}`;
    const channel = supabase
      .channel(`lebu-business-v2-${businessId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_settings', filter }, onRemoteChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_sales', filter }, onRemoteChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_expenses', filter }, onRemoteChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_recurring_costs', filter }, onRemoteChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_day_exceptions', filter }, onRemoteChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_daily_snapshots', filter }, onRemoteChange)
      .subscribe();

    return () => {
      if (realtimeDebounceRef.current) window.clearTimeout(realtimeDebounceRef.current);
      void supabase.removeChannel(channel);
    };
  }, [user, businessId, online]);

  useEffect(() => {
    if (!user || !online) return;
    const membershipChannel = supabase
      .channel(`lebu-membership-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'business_members', filter: `user_id=eq.${user.id}` }, async () => {
        try {
          const list = await refreshBusinesses();
          const current = list.find((item) => item.businessId === businessRef.current);
          if (!current) {
            initializedUserRef.current = null;
            businessRef.current = null;
            setBusinessId(null);
          }
        } catch {
          // El próximo focus vuelve a consultar membresías.
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(membershipChannel); };
  }, [user, online, refreshBusinesses]);

  useEffect(() => {
    if (!user || !businessId) return;
    const onFocus = async () => {
      if (!navigator.onLine) return;
      try {
        const { data: claimed } = await supabase.rpc('claim_my_team_invitations');
        const list = await refreshBusinesses();
        const accepted = ((claimed || []) as Array<{ business_id?: string }>).at(-1)?.business_id;
        if (accepted && list.some((item) => item.businessId === String(accepted))) {
          await loadBusinessFromCloud(String(accepted));
          return;
        }
        const current = list.find((item) => item.businessId === businessRef.current);
        if (!current) {
          initializedUserRef.current = null;
          businessRef.current = null;
          setBusinessId(null);
          return;
        }
      } catch {
        // La sincronización normal mostrará un error si el problema persiste.
      }
      void synchronizeRef.current?.();
    };
    const onOnline = () => void onFocus();
    const onVisibilityChange = () => {
      // En una PWA móvil volver del fondo no siempre dispara `focus`. Reconciliamos al quedar
      // visible para que un dispositivo suspendido no siga mostrando una meta calculada con
      // datos viejos aunque la sesión y el negocio sean los mismos.
      if (document.visibilityState === 'visible') void onFocus();
    };
    const onPageShow = () => void onFocus();

    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Realtime sigue siendo la vía principal. Este pulso es sólo una red de seguridad para
    // navegadores móviles que suspenden el WebSocket mientras la PWA queda en background.
    const reconciliationTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void synchronizeRef.current?.();
    }, 60_000);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(reconciliationTimer);
    };
  }, [user, businessId, refreshBusinesses, loadBusinessFromCloud]);

  async function switchBusiness(nextBusinessId: string) {
    if (!userRef.current || nextBusinessId === businessRef.current) return;
    if (!navigator.onLine) throw new Error('Necesitás conexión para cambiar de comercio.');
    await synchronizeRef.current?.();
    const currentBid = businessRef.current;
    const currentMeta = readMeta();
    if (currentBid && (!currentMeta || currentMeta.businessId !== currentBid || currentMeta.syncedState !== stableState(stateRef.current))) {
      throw new Error('Todavía hay cambios pendientes en este comercio. Sincronizalos antes de cambiar.');
    }
    await loadBusinessFromCloud(nextBusinessId);
  }

  async function signIn(email: string, password: string) {
    setStatus('connecting'); setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setStatus('error');
      setMessage(error.message === 'Invalid login credentials' ? 'Mail o contraseña incorrectos.' : error.message);
      throw error;
    }
  }

  async function signUp(email: string, password: string) {
    setStatus('connecting'); setMessage('');
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${AUTH_REDIRECT_URL}/?auth_confirmed=1` } });
    if (error) { setStatus('error'); setMessage(error.message); throw error; }
    if (!data.session) {
      setStatus('signed-out');
      setMessage('Cuenta creada. Revisá tu mail para confirmar y después ingresá desde Lebu.');
    }
    return Boolean(data.session);
  }

  async function signOut() {
    await supabase.auth.signOut();
    clearMeta();
    setBusinessId(null);
    setBusinesses([]);
    setRole(null);
    setStatus('signed-out');
    setMessage('La nube quedó desconectada. Tus datos locales siguen en este dispositivo.');
  }

  const activeBusiness = businesses.find((item) => item.businessId === businessId) || null;

  return {
    user,
    businessId,
    businesses,
    activeBusiness,
    role,
    status: !online && user ? 'offline' as CloudSyncStatus : status,
    message,
    engine: 'records-v2' as const,
    signIn,
    signUp,
    signOut,
    switchBusiness,
    refreshBusinesses,
    syncNow: async () => Boolean(await synchronizeRef.current?.()),
  };
}
