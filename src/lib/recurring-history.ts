export type VersionedRecurringFrequency = 'weekly' | 'biweekly' | 'monthly';

export type RecurringHistoryEntry = {
  effectiveFrom: string | null;
  amount: string | number;
  frequency: VersionedRecurringFrequency;
  paymentSchedule?: Record<string, unknown> | null;
};

export type VersionedRecurringCost = {
  amount: string | number;
  frequency: VersionedRecurringFrequency;
  paymentSchedule?: Record<string, unknown> | null;
  configHistory?: RecurringHistoryEntry[];
};

function validISODate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function cleanEntry(value: unknown): RecurringHistoryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  const frequency = entry.frequency;
  if (frequency !== 'weekly' && frequency !== 'biweekly' && frequency !== 'monthly') return null;
  const effectiveFrom = entry.effectiveFrom == null ? null : validISODate(entry.effectiveFrom) ? entry.effectiveFrom : null;
  return {
    effectiveFrom,
    amount: typeof entry.amount === 'number' || typeof entry.amount === 'string' ? entry.amount : '0',
    frequency,
    paymentSchedule: entry.paymentSchedule && typeof entry.paymentSchedule === 'object'
      ? entry.paymentSchedule as Record<string, unknown>
      : null,
  };
}

export function normalizeRecurringHistory(value: unknown): RecurringHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries = value.map(cleanEntry).filter((entry): entry is RecurringHistoryEntry => Boolean(entry));
  entries.sort((a, b) => {
    if (a.effectiveFrom == null && b.effectiveFrom == null) return 0;
    if (a.effectiveFrom == null) return -1;
    if (b.effectiveFrom == null) return 1;
    return a.effectiveFrom.localeCompare(b.effectiveFrom);
  });

  // Una sola configuración por fecha efectiva. La última cargada gana.
  const deduped = new Map<string, RecurringHistoryEntry>();
  for (const entry of entries) deduped.set(entry.effectiveFrom ?? '__baseline__', entry);
  return [...deduped.values()].sort((a, b) => {
    if (a.effectiveFrom == null && b.effectiveFrom == null) return 0;
    if (a.effectiveFrom == null) return -1;
    if (b.effectiveFrom == null) return 1;
    return a.effectiveFrom.localeCompare(b.effectiveFrom);
  });
}

function snapshot(item: VersionedRecurringCost, effectiveFrom: string | null): RecurringHistoryEntry {
  return {
    effectiveFrom,
    amount: item.amount,
    frequency: item.frequency,
    paymentSchedule: item.paymentSchedule && typeof item.paymentSchedule === 'object'
      ? item.paymentSchedule as Record<string, unknown>
      : null,
  };
}

export function resolveRecurringConfig<T extends VersionedRecurringCost>(item: T, dateISO: string): RecurringHistoryEntry {
  const history = normalizeRecurringHistory(item.configHistory);
  if (!history.length) return snapshot(item, null);

  let resolved = history.find((entry) => entry.effectiveFrom == null) || history[0];
  for (const entry of history) {
    if (entry.effectiveFrom == null || entry.effectiveFrom <= dateISO) resolved = entry;
    else break;
  }
  return resolved;
}

export function applyRecurringConfigChange<T extends VersionedRecurringCost>(
  current: T,
  next: T,
  effectiveFrom: string | null,
): T {
  // "Corregir todo el historial": el valor nuevo pasa a ser la verdad histórica completa.
  if (effectiveFrom == null) return { ...next, configHistory: [] };

  const existing = normalizeRecurringHistory(current.configHistory);
  const base = existing.length ? existing : [snapshot(current, null)];
  const kept = base.filter((entry) => entry.effectiveFrom == null || entry.effectiveFrom < effectiveFrom);
  kept.push(snapshot(next, effectiveFrom));

  return { ...next, configHistory: normalizeRecurringHistory(kept) };
}

export function recurringEconomicConfigChanged(a: VersionedRecurringCost, b: VersionedRecurringCost) {
  const scheduleA = JSON.stringify(a.paymentSchedule || null);
  const scheduleB = JSON.stringify(b.paymentSchedule || null);
  return String(a.amount) !== String(b.amount)
    || a.frequency !== b.frequency
    || scheduleA !== scheduleB;
}
