import { resolveRecurringConfig, type RecurringHistoryEntry } from '../lib/recurring-history';
import { reconcileRecurringExpenses } from '../lib/recurring-reconciliation';

export type CashPaymentSchedule =
  | { type: 'weekday'; weekday: number }
  | { type: 'month_days'; days: number[] };

export type CashRecurringCost = {
  id: number;
  name: string;
  amount: string | number;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  paymentSchedule?: CashPaymentSchedule | null;
  configHistory?: RecurringHistoryEntry[];
};

export type CashHistoricalSummary = {
  startDate: string;
  endDate: string;
  expensesCovered?: boolean;
  expensesIncludeRecurring?: boolean;
  coveredRecurringCostIds?: number[];
} | null;

export type CashDayException = { date: string; open: boolean };

export type CashSale = {
  date: string;
  amount: string | number;
  createdAt?: string;
  cashEffectAmount?: string | number | null;
  cashEffectAt?: string | null;
};

export type CashExpense = {
  date: string;
  amount: string | number;
  createdAt?: string;
  cashEffectAmount?: string | number | null;
  cashEffectAt?: string | null;
  recurringCostId?: number | null;
  recurringOccurrenceDate?: string | null;
};

export type CashCommitmentGroup = {
  date: string;
  total: number;
  items: Array<{ id: number; name: string; amount: number; expected: number; paid: number; status: 'pending' | 'partial' | 'over' }>;
  daysAway: number;
  openDaysUntil: number;
  projectedCashBefore: number | null;
  projectedCashAfter: number | null;
  gap: number | null;
  extraCashPerOpenDay: number | null;
  status: 'covered' | 'gap' | 'unknown';
};

export type CashConfidence = 'high' | 'medium' | 'low';

export type CashGuidance = {
  hasCashSnapshot: boolean;
  cashUpdatedToday: boolean;
  confirmedCash: number;
  estimatedCash: number;
  knownCashDelta: number;
  knownInflows: number;
  knownOutflows: number;
  knownEffectCount: number;
  untrackedSalesCount: number;
  untrackedSalesGross: number;
  untrackedExpenseCount: number;
  untrackedExpenseGross: number;
  daysSinceConfirmation: number | null;
  confidence: CashConfidence;
  groups: CashCommitmentGroup[];
  next: CashCommitmentGroup | null;
};

function parseAmount(value: string | number | undefined | null) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || '').replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fromISO(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toISO(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function diffDays(startISO: string, endISO: string) {
  const start = fromISO(startISO);
  const end = fromISO(endISO);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function normalizeCashPaymentSchedule(value: unknown, frequency: CashRecurringCost['frequency']): CashPaymentSchedule | null {
  if (!value || typeof value !== 'object') return null;
  const schedule = value as Record<string, unknown>;
  if (frequency === 'weekly' && schedule.type === 'weekday') {
    const weekday = Number(schedule.weekday);
    if (Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) return { type: 'weekday', weekday };
    return null;
  }
  if ((frequency === 'monthly' || frequency === 'biweekly') && schedule.type === 'month_days') {
    const rawDays = Array.isArray(schedule.days) ? schedule.days : [];
    const maxItems = frequency === 'monthly' ? 1 : 2;
    const days = [...new Set(rawDays.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 31))]
      .sort((a, b) => a - b)
      .slice(0, maxItems);
    return days.length ? { type: 'month_days', days } : null;
  }
  return null;
}

export function scheduledDatesForRecurring(item: CashRecurringCost, startISO: string, endISO: string) {
  if (endISO < startISO) return [] as string[];
  const dates: string[] = [];
  for (let date = fromISO(startISO); toISO(date) <= endISO; date = addDays(date, 1)) {
    const iso = toISO(date);
    const config = resolveRecurringConfig(item, iso);
    const schedule = normalizeCashPaymentSchedule(config.paymentSchedule, config.frequency);
    if (!schedule) continue;
    if (schedule.type === 'weekday') {
      if (date.getDay() === schedule.weekday) dates.push(iso);
      continue;
    }
    const monthLength = daysInMonth(date.getFullYear(), date.getMonth());
    const day = date.getDate();
    if (schedule.days.some((configuredDay) => Math.min(configuredDay, monthLength) === day)) dates.push(iso);
  }
  return dates;
}

function isOpenDate(dateISO: string, openWeekdays: number[], exceptions: CashDayException[]) {
  const exception = exceptions.find((item) => item.date === dateISO);
  if (exception) return exception.open;
  return openWeekdays.includes(fromISO(dateISO).getDay());
}

function countOpenDays(startISO: string, endISO: string, openWeekdays: number[], exceptions: CashDayException[]) {
  if (endISO < startISO) return 0;
  let count = 0;
  for (let date = fromISO(startISO); toISO(date) <= endISO; date = addDays(date, 1)) {
    if (isOpenDate(toISO(date), openWeekdays, exceptions)) count += 1;
  }
  return count;
}

function timestampToLocalISO(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return toISO(date);
}

function occurrenceCoveredBySummary({
  item,
  date,
  summary,
  coveredIds,
  currentPeriod,
  periodType,
}: {
  item: CashRecurringCost;
  date: string;
  summary: CashHistoricalSummary;
  coveredIds: Set<number>;
  currentPeriod: { start: string; end: string };
  periodType: CashRecurringCost['frequency'];
}) {
  if (!summary || !summary.expensesIncludeRecurring || !coveredIds.has(item.id)) return false;
  if (date < currentPeriod.start || date > currentPeriod.end) return false;
  if (summary.startDate < currentPeriod.start || summary.endDate > currentPeriod.end) return false;
  if (resolveRecurringConfig(item, date).frequency === periodType) return true;
  return date <= summary.endDate;
}

function happenedAfterSnapshot(
  item: { date: string; createdAt?: string; cashEffectAt?: string | null },
  snapshotAt: string,
) {
  const snapshot = new Date(snapshotAt);
  if (Number.isNaN(snapshot.getTime())) return false;
  const snapshotDate = timestampToLocalISO(snapshotAt);

  if (item.cashEffectAt) {
    const effectAt = new Date(item.cashEffectAt);
    if (!Number.isNaN(effectAt.getTime())) return effectAt.getTime() > snapshot.getTime();
  }

  if (item.date > snapshotDate) return true;
  if (item.date < snapshotDate) return false;

  if (item.createdAt) {
    const createdAt = new Date(item.createdAt);
    if (!Number.isNaN(createdAt.getTime())) return createdAt.getTime() > snapshot.getTime();
  }

  // En datos locales viejos puede faltar timestamp. Si coincide el día, lo tratamos como
  // incierto para no afirmar una precisión que Lebu no tiene.
  return true;
}

function effectIsAlreadyKnown(
  item: { cashEffectAmount?: string | number | null; cashEffectAt?: string | null },
  snapshotAt: string,
  now: Date,
) {
  const amount = parseAmount(item.cashEffectAmount);
  if (!amount || !item.cashEffectAt) return false;
  const effectAt = new Date(item.cashEffectAt);
  const snapshot = new Date(snapshotAt);
  if (Number.isNaN(effectAt.getTime()) || Number.isNaN(snapshot.getTime())) return false;
  return effectAt.getTime() > snapshot.getTime() && effectAt.getTime() <= now.getTime();
}

export function buildCashGuidance({
  today,
  availableCash,
  cashUpdatedAt,
  recurringCosts,
  historicalSummary,
  currentPeriod,
  periodType,
  openWeekdays,
  dayExceptions,
  sales,
  expenses,
  horizonDays = 45,
}: {
  today: string;
  availableCash: string | number;
  cashUpdatedAt: string;
  recurringCosts: CashRecurringCost[];
  historicalSummary: CashHistoricalSummary;
  currentPeriod: { start: string; end: string };
  periodType: CashRecurringCost['frequency'];
  openWeekdays: number[];
  dayExceptions: CashDayException[];
  sales: CashSale[];
  expenses: CashExpense[];
  horizonDays?: number;
}): CashGuidance {
  const confirmedCash = Math.max(parseAmount(availableCash), 0);
  const hasCashSnapshot = Boolean(cashUpdatedAt) && Number.isFinite(new Date(cashUpdatedAt).getTime());
  const snapshotDate = hasCashSnapshot ? timestampToLocalISO(cashUpdatedAt) : '';
  const cashUpdatedToday = hasCashSnapshot && snapshotDate === today;
  const daysSinceConfirmation = hasCashSnapshot ? Math.max(diffDays(snapshotDate, today), 0) : null;
  const now = new Date();

  let knownCashDelta = 0;
  let knownInflows = 0;
  let knownOutflows = 0;
  let knownEffectCount = 0;

  const allCashMovements = [...sales, ...expenses];
  if (hasCashSnapshot) {
    for (const item of allCashMovements) {
      if (!effectIsAlreadyKnown(item, cashUpdatedAt, now)) continue;
      const effect = parseAmount(item.cashEffectAmount);
      knownCashDelta += effect;
      knownEffectCount += 1;
      if (effect > 0) knownInflows += effect;
      if (effect < 0) knownOutflows += Math.abs(effect);
    }
  }

  const estimatedCash = hasCashSnapshot ? confirmedCash + knownCashDelta : 0;

  let untrackedSalesCount = 0;
  let untrackedSalesGross = 0;
  let untrackedExpenseCount = 0;
  let untrackedExpenseGross = 0;
  if (hasCashSnapshot) {
    for (const sale of sales) {
      if (!happenedAfterSnapshot(sale, cashUpdatedAt)) continue;
      if (effectIsAlreadyKnown(sale, cashUpdatedAt, now)) continue;
      untrackedSalesCount += 1;
      untrackedSalesGross += Math.max(parseAmount(sale.amount), 0);
    }
    for (const expense of expenses) {
      if (!happenedAfterSnapshot(expense, cashUpdatedAt)) continue;
      if (effectIsAlreadyKnown(expense, cashUpdatedAt, now)) continue;
      untrackedExpenseCount += 1;
      untrackedExpenseGross += Math.max(parseAmount(expense.amount), 0);
    }
  }

  const unknownMovementCount = untrackedSalesCount + untrackedExpenseCount;
  const confidence: CashConfidence = !hasCashSnapshot
    ? 'low'
    : daysSinceConfirmation === 0 && unknownMovementCount === 0
      ? 'high'
      : (daysSinceConfirmation ?? 99) <= 2 && unknownMovementCount <= 4
        ? 'medium'
        : 'low';

  const horizonEnd = toISO(addDays(fromISO(today), horizonDays));
  const coveredIds = new Set(
    historicalSummary?.expensesIncludeRecurring
      ? (Array.isArray(historicalSummary.coveredRecurringCostIds)
          ? historicalSummary.coveredRecurringCostIds.map(Number)
          : recurringCosts.map((item) => item.id))
      : [],
  );

  // La conciliación también contempla coincidencias inequívocas entre gastos ya cargados
  // y recurrentes configurados después. Así Caja no vuelve a reservar un compromiso que
  // ya aparece como gasto real aunque el vínculo todavía no se haya persistido.
  const recurringReconciliation = reconcileRecurringExpenses(expenses, recurringCosts);
  const reconciliationByOccurrence = new Map(
    recurringReconciliation.groups.map((group) => [`${group.recurringCostId}|${group.occurrenceDate}`, group]),
  );

  const rawOccurrences: Array<{ date: string; id: number; name: string; amount: number; expected: number; paid: number; status: 'pending' | 'partial' | 'over' }> = [];
  for (const item of recurringCosts) {
    for (const date of scheduledDatesForRecurring(item, today, horizonEnd)) {
      const config = resolveRecurringConfig(item, date);
      const amount = Math.max(parseAmount(config.amount), 0);
      if (amount <= 0) continue;
      if (occurrenceCoveredBySummary({ item, date, summary: historicalSummary, coveredIds, currentPeriod, periodType })) continue;

      // Si hubo pagos parciales vinculados, Caja reserva solamente el saldo que falta.
      // Ej.: sueldo 700k, ya pagados 50k => compromiso pendiente 650k.
      const reconciliation = reconciliationByOccurrence.get(`${Number(item.id)}|${date}`);
      const outstanding = reconciliation ? Math.max(reconciliation.outstanding, 0) : amount;
      if (outstanding <= 0) continue;
      const paid = reconciliation ? Math.max(reconciliation.actual, 0) : 0;
      rawOccurrences.push({
        date,
        id: item.id,
        name: item.name || 'Gasto recurrente',
        amount: outstanding,
        expected: amount,
        paid,
        status: paid > amount ? 'over' : paid > 0 ? 'partial' : 'pending',
      });
    }
  }

  const grouped = new Map<string, Array<{ id: number; name: string; amount: number; expected: number; paid: number; status: 'pending' | 'partial' | 'over' }>>();
  for (const occurrence of rawOccurrences) {
    const current = grouped.get(occurrence.date) || [];
    current.push({ id: occurrence.id, name: occurrence.name, amount: occurrence.amount, expected: occurrence.expected, paid: occurrence.paid, status: occurrence.status });
    grouped.set(occurrence.date, current);
  }

  const tomorrow = toISO(addDays(fromISO(today), 1));
  let priorCommitments = 0;
  const groups: CashCommitmentGroup[] = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => {
      const total = items.reduce((sum, item) => sum + item.amount, 0);
      const openDaysUntil = countOpenDays(tomorrow, date, openWeekdays, dayExceptions);
      const projectedCashBefore = hasCashSnapshot ? estimatedCash - priorCommitments : null;
      const gap = projectedCashBefore == null ? null : Math.max(total - projectedCashBefore, 0);
      const projectedCashAfter = projectedCashBefore == null ? null : projectedCashBefore - total;
      const extraCashPerOpenDay = gap != null && gap > 0
        ? openDaysUntil > 0 ? gap / openDaysUntil : gap
        : gap === 0 ? 0 : null;
      const status: CashCommitmentGroup['status'] = projectedCashBefore == null
        ? 'unknown'
        : gap && gap > 0 ? 'gap' : 'covered';
      priorCommitments += total;
      return {
        date,
        total,
        items,
        daysAway: Math.max(diffDays(today, date), 0),
        openDaysUntil,
        projectedCashBefore,
        projectedCashAfter,
        gap,
        extraCashPerOpenDay,
        status,
      };
    });

  return {
    hasCashSnapshot,
    cashUpdatedToday,
    confirmedCash,
    estimatedCash,
    knownCashDelta,
    knownInflows,
    knownOutflows,
    knownEffectCount,
    untrackedSalesCount,
    untrackedSalesGross,
    untrackedExpenseCount,
    untrackedExpenseGross,
    daysSinceConfirmation,
    confidence,
    groups,
    next: groups[0] || null,
  };
}
