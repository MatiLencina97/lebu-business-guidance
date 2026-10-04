import { supabaseRest } from './push-server';
import { resolveRecurringConfig, type RecurringHistoryEntry } from './recurring-history';
import { reconcileRecurringExpenses, type RecurringReconciliationSchedule } from './recurring-reconciliation';

type PeriodType = 'weekly' | 'biweekly' | 'monthly';
type DayException = { date: string; open: boolean };
type Sale = { date: string; amount: number };
type Expense = { date: string; amount: number; category?: string; note?: string; recurringCostId?: number; recurringOccurrenceDate?: string };
type RecurringCost = { id: number; name?: string; amount: number; frequency: PeriodType; amountApproximate?: boolean; paymentSchedule?: RecurringReconciliationSchedule | null; configHistory?: RecurringHistoryEntry[] };

type HistoricalSummary = {
  startDate: string;
  endDate: string;
  salesTotal: string;
  expensesTotal: string;
  salesCovered?: boolean;
  expensesCovered?: boolean;
  expensesIncludeRecurring: boolean;
  coveredRecurringCostIds?: number[];
  capturedAt?: string;
};

function numberValue(value: unknown) {
  const parsed = Number(String(value ?? 0).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateParts(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function isoDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateFromISO(value: string) {
  const { year, month, day } = dateParts(value);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function toISO(date: Date) {
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addDays(value: string, days: number) {
  const date = dateFromISO(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toISO(date);
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}

function localDateISO(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '0';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function currentPeriod(todayISO: string, type: PeriodType, monthlyStartDay = 1) {
  const today = dateFromISO(todayISO);
  if (type === 'weekly') {
    const mondayOffset = (today.getUTCDay() + 6) % 7;
    const start = addDays(todayISO, -mondayOffset);
    return { start, end: addDays(start, 6) };
  }

  if (type === 'biweekly') {
    const { year, month, day } = dateParts(todayISO);
    const firstHalf = day <= 15;
    return {
      start: isoDate(year, month, firstHalf ? 1 : 16),
      end: isoDate(year, month, firstHalf ? 15 : daysInMonth(year, month)),
    };
  }

  const requestedDay = Math.min(Math.max(Math.round(monthlyStartDay || 1), 1), 31);
  const { year, month, day } = dateParts(todayISO);
  const candidateDay = Math.min(requestedDay, daysInMonth(year, month));
  const candidate = isoDate(year, month, candidateDay);
  let start: string;
  if (day >= candidateDay) {
    start = candidate;
  } else {
    const previous = new Date(Date.UTC(year, month - 2, 1, 12));
    const py = previous.getUTCFullYear();
    const pm = previous.getUTCMonth() + 1;
    start = isoDate(py, pm, Math.min(requestedDay, daysInMonth(py, pm)));
  }
  const startParts = dateParts(start);
  const nextMonth = new Date(Date.UTC(startParts.year, startParts.month, 1, 12));
  const ny = nextMonth.getUTCFullYear();
  const nm = nextMonth.getUTCMonth() + 1;
  const nextStart = isoDate(ny, nm, Math.min(requestedDay, daysInMonth(ny, nm)));
  return { start, end: addDays(nextStart, -1) };
}

function isDateOpen(dateISO: string, openWeekdays: number[], exceptions: DayException[]) {
  const exception = exceptions.find((item) => item.date === dateISO);
  if (exception) return exception.open;
  return openWeekdays.includes(dateFromISO(dateISO).getUTCDay());
}

function listOpenDates(startISO: string, endISO: string, openWeekdays: number[], exceptions: DayException[]) {
  const dates: string[] = [];
  for (let date = startISO; date <= endISO; date = addDays(date, 1)) {
    if (isDateOpen(date, openWeekdays, exceptions)) dates.push(date);
  }
  return dates;
}

function countCalendarDays(startISO: string, endISO: string) {
  let count = 0;
  for (let date = startISO; date <= endISO; date = addDays(date, 1)) count += 1;
  return count;
}

function recurringDailyRate(item: RecurringCost, dateISO: string, planType?: PeriodType, planStartISO?: string, planEndISO?: string) {
  const config = resolveRecurringConfig(item, dateISO);
  const amount = numberValue(config.amount);
  if (!amount) return 0;
  if (config.frequency === 'monthly' && planType === 'monthly' && planStartISO && planEndISO) {
    return amount / Math.max(countCalendarDays(planStartISO, planEndISO), 1);
  }
  if (config.frequency === 'weekly') return amount / 7;
  const { year, month, day } = dateParts(dateISO);
  if (config.frequency === 'biweekly') {
    const halfDays = day <= 15 ? 15 : daysInMonth(year, month) - 15;
    return amount / halfDays;
  }
  return amount / daysInMonth(year, month);
}

function prorateRecurringCost(item: RecurringCost, startISO: string, endISO: string, planType: PeriodType, planStartISO: string, planEndISO: string) {
  if (endISO < startISO) return 0;
  let total = 0;
  for (let date = startISO; date <= endISO; date = addDays(date, 1)) total += recurringDailyRate(item, date, planType, planStartISO, planEndISO);
  return total;
}

function coversSales(summary: HistoricalSummary | null) {
  return Boolean(summary && (typeof summary.salesCovered === 'boolean' ? summary.salesCovered : numberValue(summary.salesTotal) > 0));
}

function coversExpenses(summary: HistoricalSummary | null) {
  return Boolean(summary && (typeof summary.expensesCovered === 'boolean' ? summary.expensesCovered : numberValue(summary.expensesTotal) > 0));
}

function coveredRecurringIds(summary: HistoricalSummary | null, recurring: RecurringCost[]) {
  if (!summary || !coversExpenses(summary) || !summary.expensesIncludeRecurring) return [] as number[];
  if (Array.isArray(summary.coveredRecurringCostIds)) {
    return summary.coveredRecurringCostIds.filter((id) => Number.isFinite(Number(id))).map(Number);
  }
  return recurring.map((item) => item.id);
}

function recurringCoveredAmount(item: RecurringCost, summary: HistoricalSummary | null, period: { start: string; end: string }, planType: PeriodType) {
  if (!summary || !coversExpenses(summary) || !summary.expensesIncludeRecurring) return 0;
  const fullPeriodAmount = prorateRecurringCost(item, period.start, period.end, planType, period.start, period.end);
  if (fullPeriodAmount <= 0) return 0;
  if (resolveRecurringConfig(item, summary.endDate).frequency === planType) return fullPeriodAmount;
  const coveredStart = summary.startDate > period.start ? summary.startDate : period.start;
  const coveredEnd = summary.endDate < period.end ? summary.endDate : period.end;
  if (coveredEnd < coveredStart) return 0;
  return Math.min(Math.max(prorateRecurringCost(item, coveredStart, coveredEnd, planType, period.start, period.end), 0), fullPeriodAmount);
}

function smartModel(sales: Sale[], openWeekdays: number[], todayISO: string) {
  const cutoff = addDays(todayISO, -84);
  const totalsByDate = new Map<string, number>();
  for (const sale of sales) {
    if (!sale.date || sale.date >= todayISO || sale.date < cutoff) continue;
    const weekday = dateFromISO(sale.date).getUTCDay();
    if (!openWeekdays.includes(weekday) || sale.amount <= 0) continue;
    totalsByDate.set(sale.date, (totalsByDate.get(sale.date) || 0) + sale.amount);
  }
  const valuesByWeekday = new Map<number, { date: string; amount: number }[]>();
  for (const [date, amount] of totalsByDate) {
    const weekday = dateFromISO(date).getUTCDay();
    const list = valuesByWeekday.get(weekday) || [];
    list.push({ date, amount });
    valuesByWeekday.set(weekday, list);
  }
  const rawStats = openWeekdays.map((weekday) => {
    const recent = (valuesByWeekday.get(weekday) || []).sort((a, b) => a.date.localeCompare(b.date)).slice(-8);
    const average = recent.length ? recent.reduce((sum, item) => sum + item.amount, 0) / recent.length : 0;
    return { weekday, samples: recent.length, average };
  });
  const observed = rawStats.filter((item) => item.samples > 0).map((item) => item.average);
  const baseAverage = observed.length ? observed.reduce((sum, value) => sum + value, 0) / observed.length : 0;
  const stats = rawStats.map((item) => {
    if (!baseAverage || !item.average) return { ...item, weight: 1 };
    const rawWeight = Math.min(Math.max(item.average / baseAverage, 0.6), 1.6);
    const confidence = Math.min(item.samples / 4, 1);
    return { ...item, weight: 1 + (rawWeight - 1) * confidence };
  });
  const totalSamples = totalsByDate.size;
  const coveredWeekdays = stats.filter((item) => item.samples >= 2).length;
  const requiredCoverage = Math.min(openWeekdays.length, Math.max(1, Math.ceil(openWeekdays.length * 0.7)));
  const minimumSamples = Math.max(8, Math.min(14, openWeekdays.length * 2));
  const ready = openWeekdays.length > 0 && totalSamples >= minimumSamples && coveredWeekdays >= requiredCoverage;
  const weightByWeekday = Object.fromEntries(stats.map((item) => [item.weekday, item.weight])) as Record<number, number>;
  return { ready, weightByWeekday };
}

function weightedTargets(dates: string[], total: number, model: { ready: boolean; weightByWeekday: Record<number, number> }, enabled: boolean) {
  if (!dates.length || total <= 0) return {} as Record<string, number>;
  const useSmart = enabled && model.ready;
  const weights = dates.map((date) => useSmart ? (model.weightByWeekday[dateFromISO(date).getUTCDay()] || 1) : 1);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || dates.length;
  return Object.fromEntries(dates.map((date, index) => [date, total * weights[index] / totalWeight])) as Record<string, number>;
}

async function jsonRows(path: string) {
  const response = await supabaseRest(path);
  if (!response.ok) throw new Error(`No se pudo refrescar el estado canónico de notificaciones (${response.status}).`);
  const value = await response.json();
  return Array.isArray(value) ? value : [];
}

function normalizedHistoricalSummary(value: unknown): HistoricalSummary | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const startDate = String(source.startDate || '');
  const endDate = String(source.endDate || '');
  if (!startDate || !endDate) return null;
  return {
    startDate,
    endDate,
    salesTotal: String(source.salesTotal || '0'),
    expensesTotal: String(source.expensesTotal || '0'),
    salesCovered: typeof source.salesCovered === 'boolean' ? source.salesCovered : undefined,
    expensesCovered: typeof source.expensesCovered === 'boolean' ? source.expensesCovered : undefined,
    expensesIncludeRecurring: source.expensesIncludeRecurring !== false,
    coveredRecurringCostIds: Array.isArray(source.coveredRecurringCostIds)
      ? source.coveredRecurringCostIds.filter((item) => Number.isFinite(Number(item))).map(Number)
      : undefined,
    capturedAt: typeof source.capturedAt === 'string' ? source.capturedAt : undefined,
  };
}

export async function buildCanonicalNotificationSnapshot(businessId: string, timezone: string) {
  const today = localDateISO(timezone || 'America/Argentina/Buenos_Aires');
  const settingsRows = await jsonRows(`business_settings?business_id=eq.${encodeURIComponent(businessId)}&select=profit_target,target_mode,period_type,period_start_day,historical_summary,open_weekdays,smart_distribution_enabled&limit=1`);
  const settings = settingsRows[0];
  if (!settings) throw new Error('El comercio no tiene configuración sincronizada.');

  const periodType: PeriodType = settings.period_type === 'weekly' || settings.period_type === 'biweekly' ? settings.period_type : 'monthly';
  const period = currentPeriod(today, periodType, Number(settings.period_start_day || 1));
  const openWeekdays = Array.isArray(settings.open_weekdays) ? settings.open_weekdays.map(Number) : [];
  const historicalSummary = normalizedHistoricalSummary(settings.historical_summary);
  const historyCutoff = addDays(today, -84);

  const [saleRows, expenseRows, recurringRows, exceptionRows] = await Promise.all([
    jsonRows(`business_sales?business_id=eq.${encodeURIComponent(businessId)}&deleted_at=is.null&sale_date=gte.${historyCutoff}&select=sale_date,amount`),
    jsonRows(`business_expenses?business_id=eq.${encodeURIComponent(businessId)}&deleted_at=is.null&expense_date=gte.${period.start}&expense_date=lte.${period.end}&select=expense_date,amount,category,note,recurring_cost_id,recurring_occurrence_date`),
    jsonRows(`business_recurring_costs?business_id=eq.${encodeURIComponent(businessId)}&deleted_at=is.null&select=id,name,amount,frequency,amount_is_estimate,payment_schedule,config_history`),
    jsonRows(`business_day_exceptions?business_id=eq.${encodeURIComponent(businessId)}&deleted_at=is.null&exception_date=gte.${period.start}&exception_date=lte.${period.end}&select=exception_date,is_open`),
  ]);

  const sales: Sale[] = saleRows.map((row: any) => ({ date: String(row.sale_date), amount: numberValue(row.amount) }));
  const expenses: Expense[] = expenseRows.map((row: any) => ({ date: String(row.expense_date), amount: numberValue(row.amount), category: row.category || undefined, note: row.note || undefined, recurringCostId: row.recurring_cost_id == null ? undefined : Number(row.recurring_cost_id), recurringOccurrenceDate: row.recurring_occurrence_date || undefined }));
  const recurring: RecurringCost[] = recurringRows.map((row: any) => ({
    id: Number(row.id),
    name: String(row.name || 'Gasto recurrente'),
    amount: numberValue(row.amount),
    frequency: row.frequency === 'weekly' || row.frequency === 'biweekly' ? row.frequency : 'monthly',
    amountApproximate: Boolean(row.amount_is_estimate),
    paymentSchedule: row.payment_schedule && typeof row.payment_schedule === 'object' ? row.payment_schedule : null,
    configHistory: Array.isArray(row.config_history) ? row.config_history : [],
  }));
  const dayExceptions: DayException[] = exceptionRows.map((row: any) => ({ date: String(row.exception_date), open: Boolean(row.is_open) }));

  const summaryActive = Boolean(
    historicalSummary
      && historicalSummary.startDate >= period.start
      && historicalSummary.endDate <= period.end
      && historicalSummary.startDate <= historicalSummary.endDate,
  );
  const summaryCoversSales = summaryActive && coversSales(historicalSummary);
  const summaryCoversExpenses = summaryActive && coversExpenses(historicalSummary);
  const dateCoveredBySummary = (date: string, kind: 'sale' | 'expense') => Boolean(
    historicalSummary
      && summaryActive
      && (kind === 'sale' ? summaryCoversSales : summaryCoversExpenses)
      && date >= historicalSummary.startDate
      && date <= historicalSummary.endDate,
  );

  const periodSales = sales.filter((sale) => sale.date >= period.start && sale.date <= period.end && !dateCoveredBySummary(sale.date, 'sale'));
  const periodExpenses = expenses.filter((expense) => expense.date >= period.start && expense.date <= period.end && !dateCoveredBySummary(expense.date, 'expense'));
  const historicalSales = summaryCoversSales && historicalSummary ? numberValue(historicalSummary.salesTotal) : 0;
  const historicalExpenses = summaryCoversExpenses && historicalSummary ? numberValue(historicalSummary.expensesTotal) : 0;
  const soldSoFar = historicalSales + periodSales.reduce((sum, sale) => sum + sale.amount, 0);

  const coveredIds = new Set(summaryCoversExpenses ? coveredRecurringIds(historicalSummary, recurring) : []);
  const recurringConfiguredTotal = recurring.reduce((sum, item) => sum + prorateRecurringCost(item, period.start, period.end, periodType, period.start, period.end), 0);
  const recurringCoveredTotal = recurring.reduce((sum, item) => {
    if (!coveredIds.has(item.id)) return sum;
    return sum + recurringCoveredAmount(item, historicalSummary, period, periodType);
  }, 0);
  const recurringTotal = Math.max(recurringConfiguredTotal - recurringCoveredTotal, 0);
  const recurringReconciliation = reconcileRecurringExpenses(periodExpenses, recurring);
  const detailedExpensesTotal = recurringReconciliation.unlinked.reduce((sum, item) => sum + numberValue(item.amount), 0);
  // 1.22.3: un pago parcial conciliado no achica la obligación recurrente. El delta
  // contiene solo excesos reales sobre el importe previsto.
  const variableSpent = historicalExpenses + detailedExpensesTotal + recurringReconciliation.delta;
  const totalExpenses = recurringTotal + variableSpent;
  const targetMode = settings.target_mode === 'break_even' ? 'break_even' : 'profit';
  const target = targetMode === 'break_even' ? 0 : numberValue(settings.profit_target);
  const hasTarget = targetMode === 'break_even' || target > 0;
  const currentProfit = soldSoFar - totalExpenses;
  const missingProfit = Math.max(target - currentProfit, 0);
  // Un gasto real/importado no es automáticamente un costo variable. Sin clasificación
  // explícita, el cálculo canónico de notificaciones no inventa una tasa sobre ventas futuras.
  const variableRate = 0;
  const contributionMargin = 1;
  const additionalSalesNeeded = missingProfit / contributionMargin;

  const analysisSales = summaryCoversSales && historicalSummary
    ? sales.filter((sale) => sale.date < historicalSummary.startDate || sale.date > historicalSummary.endDate)
    : sales;
  const model = smartModel(analysisSales, openWeekdays, today);
  const smartActive = settings.smart_distribution_enabled !== false && model.ready;
  const remainingOpenDates = listOpenDates(period.start, period.end, openWeekdays, dayExceptions).filter((date) => date >= today);
  const smartTargetsByDate = weightedTargets(remainingOpenDates, additionalSalesNeeded, model, smartActive);
  const dailyNeeded = remainingOpenDates[0] ? Number(smartTargetsByDate[remainingOpenDates[0]] || 0) : 0;

  const salesByDate = periodSales.reduce<Record<string, number>>((acc, sale) => {
    acc[sale.date] = (acc[sale.date] || 0) + sale.amount;
    return acc;
  }, {});
  const todaySales = Number(salesByDate[today] || 0);
  const soldBeforeToday = Math.max(soldSoFar - todaySales, 0);
  const profitBeforeToday = soldBeforeToday - totalExpenses;
  const missingProfitBeforeToday = Math.max(target - profitBeforeToday, 0);
  // Misma regla para la referencia diaria enviada por push: sin clasificación explícita,
  // los gastos históricos no se extrapolan como porcentaje de las ventas futuras.
  const marginBeforeToday = 1;
  const additionalBeforeToday = missingProfitBeforeToday / marginBeforeToday;
  const referenceModel = smartModel(analysisSales.filter((sale) => sale.date < today), openWeekdays, today);
  const referenceSmartActive = settings.smart_distribution_enabled !== false && referenceModel.ready;
  const reconstructedTargets = weightedTargets(remainingOpenDates, additionalBeforeToday, referenceModel, referenceSmartActive);
  const todayIsOpen = isDateOpen(today, openWeekdays, dayExceptions);
  const referenceDailyTarget = hasTarget && todayIsOpen && remainingOpenDates[0] === today
    ? Number(reconstructedTargets[today] || dailyNeeded || 0)
    : 0;

  return {
    schemaVersion: 5,
    source: 'cloud-canonical-v1',
    generatedAt: new Date().toISOString(),
    businessId,
    today,
    hasTarget,
    targetMode,
    goalReached: hasTarget && currentProfit >= target,
    additionalSalesNeeded,
    dailyNeeded,
    referenceDailyTarget,
    remainingOpenDays: remainingOpenDates.length,
    currentProfit,
    soldSoFar,
    variableSpent,
    totalExpenses,
    target,
    periodStart: period.start,
    periodEnd: period.end,
    periodType,
    openWeekdays,
    dayExceptions,
    salesByDate,
    smartDistributionActive: smartActive,
    smartWeightByWeekday: model.weightByWeekday,
    smartTargetsByDate,
  };
}
