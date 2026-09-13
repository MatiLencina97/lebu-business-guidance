export type CloudState = Record<string, any>;

export type CloudTombstones = {
  sales: string[];
  expenses: string[];
  recurringCosts: string[];
  dayExceptions: string[];
  dailySnapshots: string[];
};

export type KeyedDelta = {
  upserts: any[];
  deleted: any[];
};

export const emptyTombstones = (): CloudTombstones => ({
  sales: [],
  expenses: [],
  recurringCosts: [],
  dayExceptions: [],
  dailySnapshots: [],
});

export function saleKey(item: any) { return String(item?.id ?? ''); }
export function expenseKey(item: any) { return String(item?.id ?? ''); }
export function recurringKey(item: any) { return String(item?.id ?? ''); }
export function exceptionKey(item: any) { return String(item?.date ?? ''); }
export function snapshotKey(item: any) { return `${item?.date ?? ''}|${item?.periodStart ?? ''}|${item?.periodEnd ?? ''}`; }
export function cashAdjustmentKey(item: any) { return String(item?.id ?? ''); }

export function normalizedState(value: CloudState) {
  const state = value && typeof value === 'object' ? value : {};
  return {
    schemaVersion: 16,
    profitTarget: state.profitTarget ?? '',
    periodType: state.periodType ?? 'monthly',
    periodStartDay: Number.isFinite(Number(state.periodStartDay)) ? Math.min(Math.max(Number(state.periodStartDay), 1), 31) : 1,
    historicalSummary: state.historicalSummary && typeof state.historicalSummary === 'object' ? {
      startDate: String(state.historicalSummary.startDate || ''),
      endDate: String(state.historicalSummary.endDate || ''),
      salesTotal: String(state.historicalSummary.salesTotal || '0'),
      expensesTotal: String(state.historicalSummary.expensesTotal || '0'),
      // JSONB: no requiere migración. En datos viejos inferimos cobertura por total > 0.
      salesCovered: typeof state.historicalSummary.salesCovered === 'boolean'
        ? state.historicalSummary.salesCovered
        : Number(String(state.historicalSummary.salesTotal || '0').replace(/[^0-9.-]/g, '')) > 0,
      expensesCovered: typeof state.historicalSummary.expensesCovered === 'boolean'
        ? state.historicalSummary.expensesCovered
        : Number(String(state.historicalSummary.expensesTotal || '0').replace(/[^0-9.-]/g, '')) > 0,
      expensesIncludeRecurring: state.historicalSummary.expensesIncludeRecurring !== false,
      coveredRecurringCostIds: Array.isArray(state.historicalSummary.coveredRecurringCostIds)
        ? state.historicalSummary.coveredRecurringCostIds.filter((id: unknown) => Number.isFinite(Number(id))).map(Number)
        : undefined,
      capturedAt: String(state.historicalSummary.capturedAt || ''),
    } : null,
    openWeekdays: Array.isArray(state.openWeekdays) ? [...state.openWeekdays].map(Number) : [],
    dayExceptions: Array.isArray(state.dayExceptions) ? [...state.dayExceptions] : [],
    recurringCosts: Array.isArray(state.recurringCosts) ? [...state.recurringCosts] : [],
    sales: Array.isArray(state.sales) ? [...state.sales] : [],
    expenses: Array.isArray(state.expenses) ? [...state.expenses] : [],
    dailySnapshots: Array.isArray(state.dailySnapshots) ? [...state.dailySnapshots].slice(-370) : [],
    categories: Array.isArray(state.categories) ? [...state.categories].map(String) : [],
    soundsEnabled: typeof state.soundsEnabled === 'boolean' ? state.soundsEnabled : true,
    smartDistributionEnabled: typeof state.smartDistributionEnabled === 'boolean' ? state.smartDistributionEnabled : true,
    availableCash: state.availableCash == null ? '' : String(state.availableCash),
    cashUpdatedAt: typeof state.cashUpdatedAt === 'string' ? state.cashUpdatedAt : '',
    cashAdjustments: Array.isArray(state.cashAdjustments)
      ? state.cashAdjustments.filter((item: any) => item && Number.isFinite(Number(item.id)) && typeof item.adjustedAt === 'string').slice(-100)
      : [],
  };
}

export function stableState(value: CloudState) {
  const state = normalizedState(value);
  return JSON.stringify({
    ...state,
    openWeekdays: [...state.openWeekdays].sort((a, b) => a - b),
    dayExceptions: [...state.dayExceptions].sort((a, b) => String(a?.date ?? '').localeCompare(String(b?.date ?? ''))),
    recurringCosts: [...state.recurringCosts].sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''))),
    sales: [...state.sales].sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''))),
    expenses: [...state.expenses].sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? ''))),
    dailySnapshots: [...state.dailySnapshots].sort((a, b) => snapshotKey(a).localeCompare(snapshotKey(b))),
    cashAdjustments: [...state.cashAdjustments].sort((a, b) => cashAdjustmentKey(a).localeCompare(cashAdjustmentKey(b))),
    categories: [...state.categories].sort((a, b) => a.localeCompare(b)),
  });
}

export function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}


function mergeConcurrentValue(base: unknown, local: unknown, remote: unknown) {
  const localChanged = !sameValue(local, base);
  const remoteChanged = !sameValue(remote, base);
  if (!localChanged) return remote;
  if (!remoteChanged) return local;
  if (sameValue(local, remote)) return local;
  // Si ambos dispositivos cambiaron el mismo campo desde la misma base,
  // Cloud gana por seguridad: una copia local vieja nunca debe pisar datos remotos nuevos.
  return remote;
}

function mergeConcurrentByKey(
  baseItems: any[] = [],
  localItems: any[] = [],
  remoteItems: any[] = [],
  key: (item: any) => string,
) {
  const base = new Map<string, any>();
  const local = new Map<string, any>();
  const remote = new Map<string, any>();
  for (const item of baseItems || []) { const k = key(item); if (k) base.set(k, item); }
  for (const item of localItems || []) { const k = key(item); if (k) local.set(k, item); }
  for (const item of remoteItems || []) { const k = key(item); if (k) remote.set(k, item); }

  const keys = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
  const result: any[] = [];

  for (const k of keys) {
    const bHas = base.has(k);
    const lHas = local.has(k);
    const rHas = remote.has(k);
    const b = base.get(k);
    const l = local.get(k);
    const r = remote.get(k);

    if (!bHas) {
      if (lHas && !rHas) result.push(l);          // alta local
      else if (!lHas && rHas) result.push(r);     // alta remota
      else if (lHas && rHas) result.push(sameValue(l, r) ? l : r); // conflicto: Cloud
      continue;
    }

    const localChanged = lHas ? !sameValue(l, b) : true;   // false => borrado local
    const remoteChanged = rHas ? !sameValue(r, b) : true;  // false => borrado remoto

    if (!localChanged) {
      if (rHas) result.push(r); // incluye edición remota; si se borró, queda borrado
      continue;
    }
    if (!remoteChanged) {
      if (lHas) result.push(l); // edición/alta local; si se borró, queda borrado
      continue;
    }

    // Ambos tocaron la misma entidad. Si coinciden, perfecto; si no, remoto gana.
    if (lHas && rHas && sameValue(l, r)) result.push(l);
    else if (rHas) result.push(r);
  }

  return result;
}

// Merge de tres vías: base = última versión que este dispositivo confirmó,
// local = estado actual del dispositivo, remote = estado actual de Cloud.
// Conserva cambios independientes de ambos lados y evita que un cliente desactualizado
// borre o reemplace cambios remotos que nunca llegó a ver.
export function mergeConcurrentCloudStates(baseInput: CloudState, localInput: CloudState, remoteInput: CloudState): CloudState {
  const base = normalizedState(baseInput);
  const local = normalizedState(localInput);
  const remote = normalizedState(remoteInput);

  return {
    schemaVersion: 16,
    profitTarget: mergeConcurrentValue(base.profitTarget, local.profitTarget, remote.profitTarget),
    periodType: mergeConcurrentValue(base.periodType, local.periodType, remote.periodType),
    periodStartDay: mergeConcurrentValue(base.periodStartDay, local.periodStartDay, remote.periodStartDay),
    historicalSummary: mergeConcurrentValue(base.historicalSummary, local.historicalSummary, remote.historicalSummary),
    openWeekdays: mergeConcurrentValue(base.openWeekdays, local.openWeekdays, remote.openWeekdays),
    dayExceptions: mergeConcurrentByKey(base.dayExceptions, local.dayExceptions, remote.dayExceptions, exceptionKey),
    recurringCosts: mergeConcurrentByKey(base.recurringCosts, local.recurringCosts, remote.recurringCosts, recurringKey),
    sales: mergeConcurrentByKey(base.sales, local.sales, remote.sales, saleKey),
    expenses: mergeConcurrentByKey(base.expenses, local.expenses, remote.expenses, expenseKey),
    dailySnapshots: mergeConcurrentByKey(base.dailySnapshots, local.dailySnapshots, remote.dailySnapshots, snapshotKey)
      .sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')))
      .slice(-370),
    categories: mergeConcurrentValue(base.categories, local.categories, remote.categories),
    soundsEnabled: mergeConcurrentValue(base.soundsEnabled, local.soundsEnabled, remote.soundsEnabled),
    smartDistributionEnabled: mergeConcurrentValue(base.smartDistributionEnabled, local.smartDistributionEnabled, remote.smartDistributionEnabled),
    availableCash: mergeConcurrentValue(base.availableCash, local.availableCash, remote.availableCash),
    cashUpdatedAt: mergeConcurrentValue(base.cashUpdatedAt, local.cashUpdatedAt, remote.cashUpdatedAt),
    cashAdjustments: mergeConcurrentByKey(base.cashAdjustments, local.cashAdjustments, remote.cashAdjustments, cashAdjustmentKey)
      .sort((a, b) => String(a?.adjustedAt || '').localeCompare(String(b?.adjustedAt || '')))
      .slice(-100),
  } as CloudState;
}

export function hasMeaningfulData(state: CloudState) {
  const target = Number(String(state?.profitTarget || '').replace(/[^0-9]/g, '')) || 0;
  return target > 0
    || Boolean(state?.historicalSummary)
    || Boolean(state?.cashUpdatedAt)
    || (Array.isArray(state?.cashAdjustments) && state.cashAdjustments.length > 0)
    || (Array.isArray(state?.sales) && state.sales.length > 0)
    || (Array.isArray(state?.expenses) && state.expenses.length > 0)
    || (Array.isArray(state?.recurringCosts) && state.recurringCosts.length > 0)
    || (Array.isArray(state?.dayExceptions) && state.dayExceptions.length > 0);
}

function mergeInitialByKey(
  remote: any[] = [],
  local: any[] = [],
  key: (item: any) => string,
  tombstones: string[] = [],
) {
  const deleted = new Set(tombstones);
  const map = new Map<string, any>();
  for (const item of remote || []) {
    const itemKey = key(item);
    if (itemKey && !deleted.has(itemKey)) map.set(itemKey, item);
  }
  for (const item of local || []) {
    const itemKey = key(item);
    if (itemKey && !deleted.has(itemKey)) map.set(itemKey, item);
  }
  return [...map.values()];
}

// Se usa únicamente cuando un dispositivo todavía no tiene una base común Cloud v2.
// Los tombstones remotos impiden que una copia local vieja resucite registros borrados.
export function mergeInitialCloudStates(local: CloudState, remote: CloudState, tombstones: CloudTombstones): CloudState {
  const preferLocalSettings = hasMeaningfulData(local);
  const categories = [...new Set([
    ...(Array.isArray(remote.categories) ? remote.categories : []),
    ...(Array.isArray(local.categories) ? local.categories : []),
  ])];
  return {
    schemaVersion: 16,
    profitTarget: preferLocalSettings ? local.profitTarget : remote.profitTarget,
    periodType: preferLocalSettings ? local.periodType : remote.periodType,
    periodStartDay: preferLocalSettings ? local.periodStartDay : remote.periodStartDay,
    historicalSummary: preferLocalSettings ? local.historicalSummary : remote.historicalSummary,
    openWeekdays: preferLocalSettings ? local.openWeekdays : remote.openWeekdays,
    dayExceptions: mergeInitialByKey(remote.dayExceptions, local.dayExceptions, exceptionKey, tombstones.dayExceptions),
    recurringCosts: mergeInitialByKey(remote.recurringCosts, local.recurringCosts, recurringKey, tombstones.recurringCosts),
    sales: mergeInitialByKey(remote.sales, local.sales, saleKey, tombstones.sales),
    expenses: mergeInitialByKey(remote.expenses, local.expenses, expenseKey, tombstones.expenses),
    dailySnapshots: mergeInitialByKey(remote.dailySnapshots, local.dailySnapshots, snapshotKey, tombstones.dailySnapshots)
      .sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')))
      .slice(-370),
    categories,
    soundsEnabled: typeof local.soundsEnabled === 'boolean' ? local.soundsEnabled : remote.soundsEnabled,
    smartDistributionEnabled: typeof local.smartDistributionEnabled === 'boolean'
      ? local.smartDistributionEnabled
      : typeof remote.smartDistributionEnabled === 'boolean'
        ? remote.smartDistributionEnabled
        : true,
    availableCash: preferLocalSettings ? local.availableCash : remote.availableCash,
    cashUpdatedAt: preferLocalSettings ? local.cashUpdatedAt : remote.cashUpdatedAt,
    cashAdjustments: mergeInitialByKey(remote.cashAdjustments, local.cashAdjustments, cashAdjustmentKey)
      .sort((a, b) => String(a?.adjustedAt || '').localeCompare(String(b?.adjustedAt || '')))
      .slice(-100),
  };
}

export function buildKeyedDelta(
  baseItems: any[] | undefined,
  localItems: any[] | undefined,
  key: (item: any) => string,
): KeyedDelta {
  const base = new Map<string, any>();
  const local = new Map<string, any>();
  for (const item of baseItems || []) {
    const itemKey = key(item);
    if (itemKey) base.set(itemKey, item);
  }
  for (const item of localItems || []) {
    const itemKey = key(item);
    if (itemKey) local.set(itemKey, item);
  }

  const upserts: any[] = [];
  const deleted: any[] = [];

  for (const [itemKey, localValue] of local.entries()) {
    const baseValue = base.get(itemKey);
    if (!base.has(itemKey) || !sameValue(localValue, baseValue)) upserts.push(localValue);
  }
  for (const [itemKey, baseValue] of base.entries()) {
    if (!local.has(itemKey)) deleted.push(baseValue);
  }

  return { upserts, deleted };
}

export function withBusinessSettings(targetInput: CloudState, settingsInput: CloudState): CloudState {
  const target = normalizedState(targetInput);
  const settings = normalizedState(settingsInput);
  return {
    ...target,
    // business_settings es configuración compartida del comercio, no preferencia del dispositivo.
    // Cuando Cloud resolvió una versión más nueva, la aplicamos como bloque antes de continuar
    // con movimientos para que objetivo/período/días abiertos nunca queden desfasados.
    profitTarget: settings.profitTarget,
    periodType: settings.periodType,
    periodStartDay: settings.periodStartDay,
    historicalSummary: settings.historicalSummary,
    openWeekdays: settings.openWeekdays,
    categories: settings.categories,
    soundsEnabled: settings.soundsEnabled,
    smartDistributionEnabled: settings.smartDistributionEnabled,
    availableCash: settings.availableCash,
    cashUpdatedAt: settings.cashUpdatedAt,
    cashAdjustments: settings.cashAdjustments,
  };
}

export function settingsChanged(base: CloudState, local: CloudState) {
  const a = normalizedState(base);
  const b = normalizedState(local);
  return !sameValue(
    {
      profitTarget: a.profitTarget,
      periodType: a.periodType,
      periodStartDay: a.periodStartDay,
      historicalSummary: a.historicalSummary,
      openWeekdays: a.openWeekdays,
      categories: a.categories,
      soundsEnabled: a.soundsEnabled,
      smartDistributionEnabled: a.smartDistributionEnabled,
      availableCash: a.availableCash,
      cashUpdatedAt: a.cashUpdatedAt,
      cashAdjustments: a.cashAdjustments,
    },
    {
      profitTarget: b.profitTarget,
      periodType: b.periodType,
      periodStartDay: b.periodStartDay,
      historicalSummary: b.historicalSummary,
      openWeekdays: b.openWeekdays,
      categories: b.categories,
      soundsEnabled: b.soundsEnabled,
      smartDistributionEnabled: b.smartDistributionEnabled,
      availableCash: b.availableCash,
      cashUpdatedAt: b.cashUpdatedAt,
      cashAdjustments: b.cashAdjustments,
    },
  );
}
