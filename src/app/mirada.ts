import { resolveRecurringConfig, type RecurringHistoryEntry } from '../lib/recurring-history';
import { reconcileRecurringExpenses, type RecurringReconciliationSchedule } from '../lib/recurring-reconciliation';
import { buildCommercialOpportunityAnalysis, type CommercialOpportunityAnalysis, type CommercialSale } from './commercial-opportunities';
import { buildFinancialDiagnosis, type FinancialDiagnosis } from './financial-diagnosis';
import type { CashGuidance } from './cashflow';

export type MiradaPeriodType = 'weekly' | 'biweekly' | 'monthly';
export type MiradaAnalysisWindowKind = 'auto' | 'week' | 'fortnight' | 'month';
export type ResolvedMiradaAnalysisWindowKind = Exclude<MiradaAnalysisWindowKind, 'auto'>;
export type MiradaTone = 'positive' | 'attention' | 'neutral';

export type MiradaSale = CommercialSale;
export type MiradaExpense = { date: string; amount: string; category?: string; note?: string; recurringCostId?: number; recurringOccurrenceDate?: string };
export type MiradaRecurringCost = {
  id: number;
  name?: string;
  amount: string;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  paymentSchedule?: RecurringReconciliationSchedule | null;
  configHistory?: RecurringHistoryEntry[];
};
export type MiradaHistoricalSummary = {
  startDate: string;
  endDate: string;
  salesTotal: string;
  expensesTotal: string;
  salesCovered?: boolean;
  expensesCovered?: boolean;
  expensesIncludeRecurring: boolean;
  coveredRecurringCostIds?: number[];
};
export type MiradaDayException = { date: string; open: boolean };

export type MiradaRange = { start: string; end: string };

export type ComparisonMetric = {
  key: 'sales' | 'expenses' | 'profit' | 'rhythm';
  label: string;
  current: number;
  previous: number;
  delta: number;
  deltaPct: number | null;
  comparable: boolean;
};

export type PeriodComparison = {
  requestedWindow: MiradaAnalysisWindowKind;
  windowKind: ResolvedMiradaAnalysisWindowKind;
  windowLabel: string;
  autoReason: string | null;
  current: MiradaRange;
  previous: MiradaRange;
  currentComparable: MiradaRange;
  previousComparable: MiradaRange;
  isPartial: boolean;
  currentOpenDays: number;
  previousOpenDays: number;
  sales: ComparisonMetric;
  expenses: ComparisonMetric;
  profit: ComparisonMetric;
  rhythm: ComparisonMetric;
  available: boolean;
  unavailableReason: string | null;
};

export type PacePoint = {
  date: string;
  actualCumulative: number;
  expectedCumulative: number;
};

export type PaceAnalysis = {
  points: PacePoint[];
  paceDelta: number;
  pacePct: number;
  expectedToDate: number;
  actualToDate: number;
  available: boolean;
  hasAggregateGap: boolean;
  aggregateRange: MiradaRange | null;
};

export type PatternWeekday = {
  weekday: number;
  label: string;
  samples: number;
  average: number;
  relativePct: number;
};

export type TemporalPatternBucket = {
  bucket: number;
  label: string;
  samples: number;
  averagePerObservedDay: number;
};

export type TemporalPattern = {
  available: boolean;
  kind: 'weekOfMonth' | 'fortnight';
  strongest: TemporalPatternBucket | null;
  quietest: TemporalPatternBucket | null;
  differencePct: number;
  confidence: 'learning' | 'early' | 'medium' | 'high';
  sampleMonths: number;
  learningMessage: string;
};

export type PatternAnalysis = {
  available: boolean;
  stats: PatternWeekday[];
  strongest: PatternWeekday | null;
  quietest: PatternWeekday | null;
  strongestVsAveragePct: number;
  learningMessage: string;
  weeks: TemporalPattern;
  fortnights: TemporalPattern;
};

export type MiradaObservation = {
  title: string;
  body: string;
  tone: MiradaTone;
};

export type AdjustmentSuggestion = {
  title: string;
  body: string;
  tone: MiradaTone;
  action: 'simulator' | 'strategy' | 'movements' | null;
  actionLabel: string | null;
};

export type MiradaAnalysis = {
  comparison: PeriodComparison;
  pace: PaceAnalysis;
  patterns: PatternAnalysis;
  primary: MiradaObservation;
  adjustment: AdjustmentSuggestion;
  commercial: CommercialOpportunityAnalysis;
  financial: FinancialDiagnosis;
};

type BuildMiradaInput = {
  periodType: MiradaPeriodType;
  analysisWindow?: MiradaAnalysisWindowKind;
  periodStartDay: number;
  currentPeriod: MiradaRange;
  today: string;
  hasTarget: boolean;
  goalReached: boolean;
  soldSoFar: number;
  salesNeededForGoal: number;
  sales: MiradaSale[];
  expenses: MiradaExpense[];
  recurringCosts: MiradaRecurringCost[];
  historicalSummary: MiradaHistoricalSummary | null;
  openWeekdays: number[];
  dayExceptions: MiradaDayException[];
  smartActive: boolean;
  weightByWeekday: Record<number, number>;
  expectedSalesByToday: number;
  economicExpenses: number;
  economicResult: number;
  recurringExpected: number;
  cashGuidance: CashGuidance;
};

function parseMoney(value: string) {
  const cleaned = String(value || '').replace(/[^0-9]/g, '');
  return cleaned ? Number(cleaned) : 0;
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

function daysInMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function calendarDays(startISO: string, endISO: string) {
  if (endISO < startISO) return 0;
  let count = 0;
  for (let date = fromISO(startISO); date <= fromISO(endISO); date = addDays(date, 1)) count += 1;
  return count;
}

function clampMonthlyStart(year: number, month: number, requestedDay: number) {
  const safeDay = Math.min(Math.max(Math.round(requestedDay || 1), 1), 31);
  const monthStart = new Date(year, month, 1);
  return new Date(year, month, Math.min(safeDay, daysInMonth(monthStart)));
}

export function getPreviousPeriod(type: MiradaPeriodType, current: MiradaRange, monthlyStartDay = 1): MiradaRange {
  const currentStart = fromISO(current.start);

  if (type === 'weekly') {
    const start = addDays(currentStart, -7);
    return { start: toISO(start), end: toISO(addDays(start, 6)) };
  }

  if (type === 'biweekly') {
    if (currentStart.getDate() === 16) {
      const start = new Date(currentStart.getFullYear(), currentStart.getMonth(), 1);
      return { start: toISO(start), end: toISO(new Date(currentStart.getFullYear(), currentStart.getMonth(), 15)) };
    }
    const previousMonth = new Date(currentStart.getFullYear(), currentStart.getMonth() - 1, 1);
    const start = new Date(previousMonth.getFullYear(), previousMonth.getMonth(), 16);
    const end = new Date(previousMonth.getFullYear(), previousMonth.getMonth(), daysInMonth(previousMonth));
    return { start: toISO(start), end: toISO(end) };
  }

  const previousStart = clampMonthlyStart(currentStart.getFullYear(), currentStart.getMonth() - 1, monthlyStartDay);
  return { start: toISO(previousStart), end: toISO(addDays(currentStart, -1)) };
}

export function getComparableRanges(
  type: MiradaPeriodType,
  current: MiradaRange,
  today: string,
  monthlyStartDay = 1,
) {
  const previous = getPreviousPeriod(type, current, monthlyStartDay);
  const lastClosedDay = today > current.start ? toISO(addDays(fromISO(today), -1)) : today;
  const currentEndCandidate = lastClosedDay < current.end ? lastClosedDay : current.end;
  const currentEnd = currentEndCandidate < current.start ? current.start : currentEndCandidate;
  const offsetDays = Math.max(calendarDays(current.start, currentEnd) - 1, 0);
  const previousCandidateEnd = toISO(addDays(fromISO(previous.start), offsetDays));
  const previousEnd = previousCandidateEnd < previous.end ? previousCandidateEnd : previous.end;
  return {
    current,
    previous,
    currentComparable: { start: current.start, end: currentEnd },
    previousComparable: { start: previous.start, end: previousEnd },
    isPartial: currentEnd < current.end,
  };
}

function rangesOverlap(a: MiradaRange, b: MiradaRange) {
  return a.start <= b.end && a.end >= b.start;
}

function summaryCovers(summary: MiradaHistoricalSummary | null, kind: 'sale' | 'expense') {
  if (!summary) return false;
  if (kind === 'sale') {
    return typeof summary.salesCovered === 'boolean' ? summary.salesCovered : parseMoney(summary.salesTotal) > 0;
  }
  return typeof summary.expensesCovered === 'boolean' ? summary.expensesCovered : parseMoney(summary.expensesTotal) > 0;
}

function summaryRelation(summary: MiradaHistoricalSummary | null, range: MiradaRange, kind: 'sale' | 'expense') {
  if (!summary || !summaryCovers(summary, kind)) return 'none' as const;
  const summaryRange = { start: summary.startDate, end: summary.endDate };
  if (!rangesOverlap(summaryRange, range)) return 'none' as const;
  if (summary.startDate >= range.start && summary.endDate <= range.end) return 'full' as const;
  return 'partial' as const;
}

function dateInsideSummary(date: string, summary: MiradaHistoricalSummary | null, kind: 'sale' | 'expense') {
  return Boolean(summary && summaryCovers(summary, kind) && date >= summary.startDate && date <= summary.endDate);
}

function recurringDailyRate(item: MiradaRecurringCost, date: Date, planType?: MiradaPeriodType, fullPlan?: MiradaRange) {
  const dateISO = toISO(date);
  const config = resolveRecurringConfig(item, dateISO);
  const amount = parseMoney(String(config.amount));
  if (!amount) return 0;
  if (config.frequency === 'monthly' && planType === 'monthly' && fullPlan) {
    return amount / Math.max(calendarDays(fullPlan.start, fullPlan.end), 1);
  }
  if (config.frequency === 'weekly') return amount / 7;
  if (config.frequency === 'biweekly') {
    const halfDays = date.getDate() <= 15 ? 15 : daysInMonth(date) - 15;
    return amount / Math.max(halfDays, 1);
  }
  return amount / daysInMonth(date);
}

function prorateRecurringCost(
  item: MiradaRecurringCost,
  range: MiradaRange,
  planType: MiradaPeriodType,
  fullPlan: MiradaRange,
) {
  if (range.end < range.start) return 0;
  let total = 0;
  for (let date = fromISO(range.start); date <= fromISO(range.end); date = addDays(date, 1)) {
    total += recurringDailyRate(item, date, planType, fullPlan);
  }
  return total;
}

function recurringCoveredAmountForSummary(
  item: MiradaRecurringCost,
  summary: MiradaHistoricalSummary,
  range: MiradaRange,
  fullPlan: MiradaRange,
  planType: MiradaPeriodType,
) {
  const amountInRange = prorateRecurringCost(item, range, planType, fullPlan);
  if (amountInRange <= 0) return 0;

  // Una frecuencia igual al período representa una sola ocurrencia atribuida a ese plan. Si ya
  // estaba incluida en el acumulado, no la distribuimos nuevamente después de la fecha de corte.
  if (resolveRecurringConfig(item, summary.endDate).frequency === planType) return amountInRange;

  const coveredStart = summary.startDate > range.start ? summary.startDate : range.start;
  const coveredEnd = summary.endDate < range.end ? summary.endDate : range.end;
  if (coveredEnd < coveredStart) return 0;
  return Math.min(
    prorateRecurringCost(item, { start: coveredStart, end: coveredEnd }, planType, fullPlan),
    amountInRange,
  );
}

function sumSalesRange(sales: MiradaSale[], range: MiradaRange, summary: MiradaHistoricalSummary | null) {
  const relation = summaryRelation(summary, range, 'sale');
  if (relation === 'partial') return { available: false, value: 0 };
  const detailed = sales
    .filter((sale) => sale.date >= range.start && sale.date <= range.end && !dateInsideSummary(sale.date, summary, 'sale'))
    .reduce((sum, sale) => sum + parseMoney(sale.amount), 0);
  const aggregate = relation === 'full' && summary ? parseMoney(summary.salesTotal) : 0;
  return { available: true, value: detailed + aggregate };
}

function sumExpensesRange(
  expenses: MiradaExpense[],
  recurringCosts: MiradaRecurringCost[],
  range: MiradaRange,
  fullPlan: MiradaRange,
  planType: MiradaPeriodType,
  summary: MiradaHistoricalSummary | null,
) {
  const relation = summaryRelation(summary, range, 'expense');
  if (relation === 'partial') return { available: false, value: 0 };

  const detailedExpenses = expenses
    .filter((expense) => expense.date >= range.start && expense.date <= range.end && !dateInsideSummary(expense.date, summary, 'expense'));
  const reconciliation = reconcileRecurringExpenses(detailedExpenses, recurringCosts);
  // Los pagos parciales no reducen el costo previsto del recurrente; delta solo contiene
  // excesos reales por encima de la previsión.
  const detailed = reconciliation.unlinked.reduce((sum, expense) => sum + parseMoney(String(expense.amount)), 0) + reconciliation.delta;

  let recurring = recurringCosts.reduce(
    (sum, item) => sum + prorateRecurringCost(item, range, planType, fullPlan),
    0,
  );

  let aggregate = 0;
  if (relation === 'full' && summary) {
    aggregate = parseMoney(summary.expensesTotal);
    if (summary.expensesIncludeRecurring) {
      const coveredIds = new Set(
        Array.isArray(summary.coveredRecurringCostIds)
          ? summary.coveredRecurringCostIds.map(Number)
          : recurringCosts.map((item) => item.id),
      );
      // No duplicamos la porción que ya vive dentro del acumulado. Si dentro del plan hay
      // repeticiones posteriores a endDate (semanales/quincenales dentro de un mes), esas
      // repeticiones futuras permanecen en el cálculo.
      const recurringAlreadyCovered = recurringCosts
        .filter((item) => coveredIds.has(item.id))
        .reduce((sum, item) => sum + recurringCoveredAmountForSummary(item, summary, range, fullPlan, planType), 0);
      recurring = Math.max(recurring - recurringAlreadyCovered, 0);
    }
  }

  return { available: true, value: detailed + aggregate + recurring };
}

function metric(key: ComparisonMetric['key'], label: string, current: number, previous: number, comparable: boolean): ComparisonMetric {
  const delta = current - previous;
  const deltaPct = comparable && previous !== 0 ? delta / Math.abs(previous) : null;
  return { key, label, current, previous, delta, deltaPct, comparable };
}

function mondayStart(date: Date) {
  const offset = (date.getDay() + 6) % 7;
  return addDays(date, -offset);
}

function analysisRange(kind: ResolvedMiradaAnalysisWindowKind, today: string): MiradaRange {
  const date = fromISO(today);
  if (kind === 'week') {
    const start = mondayStart(date);
    return { start: toISO(start), end: toISO(addDays(start, 6)) };
  }
  if (kind === 'fortnight') {
    const year = date.getFullYear();
    const month = date.getMonth();
    if (date.getDate() <= 15) {
      return { start: toISO(new Date(year, month, 1)), end: toISO(new Date(year, month, 15)) };
    }
    return { start: toISO(new Date(year, month, 16)), end: toISO(new Date(year, month, daysInMonth(date))) };
  }
  return {
    start: toISO(new Date(date.getFullYear(), date.getMonth(), 1)),
    end: toISO(new Date(date.getFullYear(), date.getMonth(), daysInMonth(date))),
  };
}

function previousAnalysisRange(kind: ResolvedMiradaAnalysisWindowKind, current: MiradaRange): MiradaRange {
  const start = fromISO(current.start);
  if (kind === 'week') {
    const previousStart = addDays(start, -7);
    return { start: toISO(previousStart), end: toISO(addDays(previousStart, 6)) };
  }
  if (kind === 'fortnight') {
    if (start.getDate() === 16) {
      return { start: toISO(new Date(start.getFullYear(), start.getMonth(), 1)), end: toISO(new Date(start.getFullYear(), start.getMonth(), 15)) };
    }
    const previousMonth = new Date(start.getFullYear(), start.getMonth() - 1, 1);
    return {
      start: toISO(new Date(previousMonth.getFullYear(), previousMonth.getMonth(), 16)),
      end: toISO(new Date(previousMonth.getFullYear(), previousMonth.getMonth(), daysInMonth(previousMonth))),
    };
  }
  const previousMonth = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  return {
    start: toISO(previousMonth),
    end: toISO(new Date(previousMonth.getFullYear(), previousMonth.getMonth(), daysInMonth(previousMonth))),
  };
}

function analysisComparableRanges(kind: ResolvedMiradaAnalysisWindowKind, today: string) {
  const current = analysisRange(kind, today);
  const previous = previousAnalysisRange(kind, current);
  const yesterday = toISO(addDays(fromISO(today), -1));
  const hasClosedCurrentDays = yesterday >= current.start;
  const currentEnd = hasClosedCurrentDays
    ? (yesterday < current.end ? yesterday : current.end)
    : current.start;
  const offsetDays = hasClosedCurrentDays ? Math.max(calendarDays(current.start, currentEnd) - 1, 0) : 0;
  const previousCandidateEnd = toISO(addDays(fromISO(previous.start), offsetDays));
  const previousEnd = previousCandidateEnd < previous.end ? previousCandidateEnd : previous.end;
  return {
    current,
    previous,
    currentComparable: { start: current.start, end: currentEnd },
    previousComparable: { start: previous.start, end: previousEnd },
    isPartial: currentEnd < current.end,
    hasClosedCurrentDays,
  };
}

function analysisPlanType(kind: ResolvedMiradaAnalysisWindowKind): MiradaPeriodType {
  return kind === 'week' ? 'weekly' : kind === 'fortnight' ? 'biweekly' : 'monthly';
}

function analysisWindowLabel(kind: ResolvedMiradaAnalysisWindowKind) {
  if (kind === 'week') return 'Semana';
  if (kind === 'fortnight') return 'Quincena';
  return 'Mes';
}

function buildComparisonForWindow(input: BuildMiradaInput, kind: ResolvedMiradaAnalysisWindowKind): PeriodComparison {
  const ranges = analysisComparableRanges(kind, input.today);
  const planType = analysisPlanType(kind);
  const currentSales = sumSalesRange(input.sales, ranges.currentComparable, input.historicalSummary);
  const previousSales = sumSalesRange(input.sales, ranges.previousComparable, input.historicalSummary);
  const currentExpenses = sumExpensesRange(
    input.expenses,
    input.recurringCosts,
    ranges.currentComparable,
    ranges.current,
    planType,
    input.historicalSummary,
  );
  const previousExpenses = sumExpensesRange(
    input.expenses,
    input.recurringCosts,
    ranges.previousComparable,
    ranges.previous,
    planType,
    input.historicalSummary,
  );

  const observedInRange = (range: MiradaRange, kindToCheck: 'sale' | 'expense') => {
    const detailed = kindToCheck === 'sale'
      ? input.sales.some((sale) => sale.date >= range.start && sale.date <= range.end && !dateInsideSummary(sale.date, input.historicalSummary, 'sale'))
      : input.expenses.some((expense) => expense.date >= range.start && expense.date <= range.end && !dateInsideSummary(expense.date, input.historicalSummary, 'expense'));
    const aggregate = summaryRelation(input.historicalSummary, range, kindToCheck) === 'full';
    return detailed || aggregate;
  };

  const currentSalesObserved = observedInRange(ranges.currentComparable, 'sale');
  const previousSalesObserved = observedInRange(ranges.previousComparable, 'sale');
  const currentExpenseObserved = observedInRange(ranges.currentComparable, 'expense') || input.recurringCosts.length > 0;
  const previousExpenseObserved = observedInRange(ranges.previousComparable, 'expense') || input.recurringCosts.length > 0;

  const currentOpenDays = ranges.hasClosedCurrentDays
    ? listOpenDates(ranges.currentComparable, input.openWeekdays, input.dayExceptions).length
    : 0;
  const previousOpenDays = ranges.hasClosedCurrentDays
    ? listOpenDates(ranges.previousComparable, input.openWeekdays, input.dayExceptions).length
    : 0;

  const salesComparable = ranges.hasClosedCurrentDays
    && currentSales.available
    && previousSales.available
    && currentSalesObserved
    && previousSalesObserved;
  const expensesComparable = ranges.hasClosedCurrentDays
    && currentExpenses.available
    && previousExpenses.available
    && currentExpenseObserved
    && previousExpenseObserved;
  const profitComparable = salesComparable && expensesComparable;
  const rhythmComparable = salesComparable && currentOpenDays > 0 && previousOpenDays > 0;
  const currentProfit = currentSales.value - currentExpenses.value;
  const previousProfit = previousSales.value - previousExpenses.value;
  const currentRhythm = currentOpenDays > 0 ? currentSales.value / currentOpenDays : 0;
  const previousRhythm = previousOpenDays > 0 ? previousSales.value / previousOpenDays : 0;

  const aggregateBlocksSales = !currentSales.available || !previousSales.available;
  const aggregateBlocksExpenses = !currentExpenses.available || !previousExpenses.available;
  const available = salesComparable || expensesComparable;
  let unavailableReason: string | null = null;
  if (!ranges.hasClosedCurrentDays) {
    unavailableReason = `La ${analysisWindowLabel(kind).toLowerCase()} recién empieza. Lebu va a comparar cuando haya al menos un día cerrado.`;
  } else if (!available && (aggregateBlocksSales || aggregateBlocksExpenses)) {
    unavailableReason = 'El acumulado inicial cruza esta ventana. Lebu no va a repartir un total por días para inventar una comparación.';
  } else if (!available) {
    unavailableReason = 'Todavía no tengo movimientos suficientes en ambos tramos para hacer una comparación justa.';
  }

  return {
    requestedWindow: input.analysisWindow || 'auto',
    windowKind: kind,
    windowLabel: analysisWindowLabel(kind),
    autoReason: null,
    current: ranges.current,
    previous: ranges.previous,
    currentComparable: ranges.currentComparable,
    previousComparable: ranges.previousComparable,
    isPartial: ranges.isPartial,
    currentOpenDays,
    previousOpenDays,
    sales: metric('sales', 'Ventas', currentSales.value, previousSales.value, salesComparable),
    expenses: metric('expenses', 'Gastos', currentExpenses.value, previousExpenses.value, expensesComparable),
    profit: metric('profit', 'Resultado', currentProfit, previousProfit, profitComparable),
    rhythm: metric('rhythm', 'Ventas / día abierto', currentRhythm, previousRhythm, rhythmComparable),
    available,
    unavailableReason,
  };
}

function autoComparison(input: BuildMiradaInput): PeriodComparison {
  const candidates = (['week', 'fortnight', 'month'] as ResolvedMiradaAnalysisWindowKind[])
    .map((kind) => buildComparisonForWindow({ ...input, analysisWindow: 'auto' }, kind));

  const enoughRecentEvidence = candidates.find((candidate) =>
    candidate.sales.comparable
    && candidate.currentOpenDays >= (candidate.windowKind === 'week' ? 2 : candidate.windowKind === 'fortnight' ? 3 : 4)
    && candidate.previousOpenDays >= (candidate.windowKind === 'week' ? 2 : candidate.windowKind === 'fortnight' ? 3 : 4));
  const fallback = enoughRecentEvidence
    || candidates.find((candidate) => candidate.sales.comparable)
    || candidates.find((candidate) => candidate.available)
    || candidates[0];
  const reason = fallback.sales.comparable
    ? `Elegí ${fallback.windowLabel.toLowerCase()} porque es la ventana más reciente con evidencia comparable suficiente.`
    : `Estoy usando ${fallback.windowLabel.toLowerCase()} mientras junto más historial comparable.`;
  return { ...fallback, requestedWindow: 'auto', autoReason: reason };
}

export function buildPeriodComparison(input: BuildMiradaInput): PeriodComparison {
  const requested = input.analysisWindow || 'auto';
  if (requested === 'auto') return autoComparison(input);
  return buildComparisonForWindow(input, requested);
}

function isOpenDate(dateISO: string, openWeekdays: number[], exceptions: MiradaDayException[]) {
  const exception = exceptions.find((item) => item.date === dateISO);
  if (exception) return exception.open;
  return openWeekdays.includes(fromISO(dateISO).getDay());
}

function listOpenDates(range: MiradaRange, openWeekdays: number[], exceptions: MiradaDayException[]) {
  const dates: string[] = [];
  for (let date = fromISO(range.start); date <= fromISO(range.end); date = addDays(date, 1)) {
    const iso = toISO(date);
    if (isOpenDate(iso, openWeekdays, exceptions)) dates.push(iso);
  }
  return dates;
}

function weightedTargets(
  dates: string[],
  total: number,
  smartActive: boolean,
  weightByWeekday: Record<number, number>,
) {
  if (!dates.length || total <= 0) return {} as Record<string, number>;
  const weights = dates.map((date) => smartActive ? (weightByWeekday[fromISO(date).getDay()] || 1) : 1);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || dates.length;
  return Object.fromEntries(dates.map((date, index) => [date, total * weights[index] / totalWeight])) as Record<string, number>;
}

export function buildCumulativePaceSeries(input: BuildMiradaInput): PaceAnalysis {
  const openDates = listOpenDates(input.currentPeriod, input.openWeekdays, input.dayExceptions);
  const completedOpenDates = openDates.filter((date) => date < input.today);
  const expectedTargets = weightedTargets(openDates, input.salesNeededForGoal, input.smartActive, input.weightByWeekday);
  const expectedToDate = completedOpenDates.reduce((sum, date) => sum + Number(expectedTargets[date] || 0), 0);

  const detailedSales = input.sales
    .filter((sale) => sale.date >= input.currentPeriod.start && sale.date < input.today && !dateInsideSummary(sale.date, input.historicalSummary, 'sale'))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const activeAggregate = Boolean(
    input.historicalSummary
      && summaryCovers(input.historicalSummary, 'sale')
      && input.historicalSummary.startDate >= input.currentPeriod.start
      && input.historicalSummary.endDate <= input.currentPeriod.end,
  );
  const aggregateRange = activeAggregate && input.historicalSummary
    ? { start: input.historicalSummary.startDate, end: input.historicalSummary.endDate }
    : null;
  const aggregateSales = activeAggregate && input.historicalSummary ? parseMoney(input.historicalSummary.salesTotal) : 0;

  let expected = 0;
  let aggregateApplied = false;
  let saleIndex = 0;
  let actual = 0;
  const points: PacePoint[] = [];

  for (const date of completedOpenDates) {
    expected += Number(expectedTargets[date] || 0);
    const covered = Boolean(aggregateRange && date >= aggregateRange.start && date <= aggregateRange.end);
    if (covered) continue;

    if (aggregateRange && !aggregateApplied && date > aggregateRange.end) {
      actual += aggregateSales;
      aggregateApplied = true;
    }
    while (saleIndex < detailedSales.length && detailedSales[saleIndex].date <= date) {
      actual += parseMoney(detailedSales[saleIndex].amount);
      saleIndex += 1;
    }
    points.push({ date, actualCumulative: actual, expectedCumulative: expected });
  }

  const aggregateCountsAsCompleted = Boolean(aggregateRange && aggregateRange.end < input.today);
  if (aggregateCountsAsCompleted && !aggregateApplied) actual += aggregateSales;
  while (saleIndex < detailedSales.length) {
    actual += parseMoney(detailedSales[saleIndex].amount);
    saleIndex += 1;
  }
  const actualToDate = actual;
  const paceDelta = actualToDate - expectedToDate;
  const pacePct = expectedToDate > 0 ? (paceDelta / expectedToDate) * 100 : 0;

  return {
    points,
    paceDelta,
    pacePct,
    expectedToDate,
    actualToDate,
    available: input.hasTarget && input.salesNeededForGoal > 0 && completedOpenDates.length > 0 && expectedToDate > 0,
    hasAggregateGap: Boolean(aggregateRange),
    aggregateRange,
  };
}

const weekdayLabels: Record<number, string> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
};

function confidenceForSamples(samples: number): TemporalPattern['confidence'] {
  if (samples < 3) return 'learning';
  if (samples < 5) return 'early';
  if (samples < 8) return 'medium';
  return 'high';
}

function buildTemporalPattern(
  input: BuildMiradaInput,
  totalsByDate: Map<string, number>,
  kind: 'weekOfMonth' | 'fortnight',
): TemporalPattern {
  const bucketRows = new Map<string, { bucket: number; total: number; observedDays: Set<string>; end: string; monthKey: string }>();
  const monthSet = new Set<string>();

  for (const [date, amount] of totalsByDate) {
    const parsed = fromISO(date);
    const monthKey = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
    const bucket = kind === 'weekOfMonth'
      ? Math.min(Math.floor((parsed.getDate() - 1) / 7) + 1, 5)
      : parsed.getDate() <= 15 ? 1 : 2;
    const key = `${monthKey}:${bucket}`;
    const bucketEndDay = kind === 'weekOfMonth'
      ? Math.min(bucket * 7, daysInMonth(parsed))
      : bucket === 1 ? 15 : daysInMonth(parsed);
    const bucketEnd = toISO(new Date(parsed.getFullYear(), parsed.getMonth(), bucketEndDay));
    const row = bucketRows.get(key) || { bucket, total: 0, observedDays: new Set<string>(), end: bucketEnd, monthKey };
    row.total += amount;
    row.observedDays.add(date);
    bucketRows.set(key, row);
  }

  const valuesByBucket = new Map<number, number[]>();
  for (const row of bucketRows.values()) {
    // No usamos un tramo todavía abierto: comparar una quincena o semana incompleta contra
    // tramos cerrados produciría un patrón engañoso.
    if (row.end >= input.today) continue;
    // Un único movimiento aislado no alcanza para describir cómo rindió un tramo.
    if (row.observedDays.size < 2) continue;
    monthSet.add(row.monthKey);
    const list = valuesByBucket.get(row.bucket) || [];
    list.push(row.total / row.observedDays.size);
    valuesByBucket.set(row.bucket, list);
  }

  const bucketNumbers = kind === 'weekOfMonth' ? [1, 2, 3, 4, 5] : [1, 2];
  const labelFor = (bucket: number) => kind === 'weekOfMonth'
    ? `${bucket}.ª semana`
    : bucket === 1 ? 'Primera quincena' : 'Segunda quincena';
  const stats: TemporalPatternBucket[] = bucketNumbers.map((bucket) => {
    const values = valuesByBucket.get(bucket) || [];
    return {
      bucket,
      label: labelFor(bucket),
      samples: values.length,
      averagePerObservedDay: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    };
  });
  const eligible = stats.filter((item) => item.samples >= 3 && item.averagePerObservedDay > 0);
  const sampleMonths = monthSet.size;

  if (eligible.length < 2 || sampleMonths < 3) {
    const needed = Math.max(3 - sampleMonths, 0);
    return {
      available: false,
      kind,
      strongest: null,
      quietest: null,
      differencePct: 0,
      confidence: 'learning',
      sampleMonths,
      learningMessage: needed > 0
        ? `Necesito aproximadamente ${needed} ${needed === 1 ? 'mes más' : 'meses más'} con ventas fechadas para comparar ${kind === 'weekOfMonth' ? 'semanas del mes' : 'quincenas'} sin adivinar.`
        : `Ya tengo varios meses, pero todavía faltan tramos con suficiente detalle para comparar ${kind === 'weekOfMonth' ? 'semanas' : 'quincenas'} de forma justa.`,
    };
  }

  const sorted = eligible.slice().sort((a, b) => b.averagePerObservedDay - a.averagePerObservedDay);
  const strongest = sorted[0];
  const quietest = sorted[sorted.length - 1];
  const differencePct = quietest.averagePerObservedDay > 0
    ? (strongest.averagePerObservedDay - quietest.averagePerObservedDay) / quietest.averagePerObservedDay
    : 0;
  const minSamples = Math.min(strongest.samples, quietest.samples);
  return {
    available: true,
    kind,
    strongest,
    quietest,
    differencePct,
    confidence: confidenceForSamples(minSamples),
    sampleMonths,
    learningMessage: '',
  };
}

export function buildPatterns(input: BuildMiradaInput): PatternAnalysis {
  const cutoff = toISO(addDays(fromISO(input.today), -240));
  const totalsByDate = new Map<string, number>();
  for (const sale of input.sales) {
    if (!sale.date || sale.date >= input.today || sale.date < cutoff) continue;
    if (dateInsideSummary(sale.date, input.historicalSummary, 'sale')) continue;
    const weekday = fromISO(sale.date).getDay();
    if (!input.openWeekdays.includes(weekday)) continue;
    const amount = parseMoney(sale.amount);
    if (amount <= 0) continue;
    totalsByDate.set(sale.date, (totalsByDate.get(sale.date) || 0) + amount);
  }

  const valuesByWeekday = new Map<number, number[]>();
  for (const [date, amount] of totalsByDate) {
    const weekday = fromISO(date).getDay();
    const list = valuesByWeekday.get(weekday) || [];
    list.push(amount);
    valuesByWeekday.set(weekday, list);
  }

  const raw = input.openWeekdays.map((weekday) => {
    const values = (valuesByWeekday.get(weekday) || []).slice(-12);
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    return { weekday, label: weekdayLabels[weekday] || 'Día', samples: values.length, average };
  });
  const observed = raw.filter((item) => item.samples >= 3 && item.average > 0);
  const overallAverage = observed.length
    ? observed.reduce((sum, item) => sum + item.average, 0) / observed.length
    : 0;
  const stats = raw.map((item) => ({
    ...item,
    relativePct: overallAverage > 0 ? (item.average - overallAverage) / overallAverage : 0,
  }));
  const weeks = buildTemporalPattern(input, totalsByDate, 'weekOfMonth');
  const fortnights = buildTemporalPattern(input, totalsByDate, 'fortnight');

  if (observed.length < 2) {
    const closest = raw.slice().sort((a, b) => b.samples - a.samples)[0];
    const learningMessage = closest && closest.samples > 0
      ? `Todavía estoy juntando más ${closest.label.toLowerCase()} y otros días comparables para detectar un patrón confiable.`
      : 'Todavía necesito más días con movimientos fechados para detectar patrones confiables.';
    return { available: false, stats, strongest: null, quietest: null, strongestVsAveragePct: 0, learningMessage, weeks, fortnights };
  }

  const sorted = observed.slice().sort((a, b) => b.average - a.average);
  const strongestRaw = sorted[0];
  const quietestRaw = sorted[sorted.length - 1];
  const strongest = stats.find((item) => item.weekday === strongestRaw.weekday) || null;
  const quietest = stats.find((item) => item.weekday === quietestRaw.weekday) || null;
  const strongestVsAveragePct = overallAverage > 0 ? (strongestRaw.average - overallAverage) / overallAverage : 0;
  return {
    available: true,
    stats,
    strongest,
    quietest,
    strongestVsAveragePct,
    learningMessage: '',
    weeks,
    fortnights,
  };
}

export function buildPrimaryObservation(input: BuildMiradaInput, comparison: PeriodComparison, pace: PaceAnalysis, patterns: PatternAnalysis): MiradaObservation {
  if (!input.hasTarget) {
    return {
      title: 'Primero necesito conocer tu objetivo',
      body: 'Configurá cuánto querés ganar y Lebu empieza a mirar el ritmo de tu negocio.',
      tone: 'neutral',
    };
  }

  const hasDetailedMovements = input.sales.some((sale) => sale.date >= input.currentPeriod.start && sale.date <= input.today && !dateInsideSummary(sale.date, input.historicalSummary, 'sale'))
    || input.expenses.some((expense) => expense.date >= input.currentPeriod.start && expense.date <= input.today && !dateInsideSummary(expense.date, input.historicalSummary, 'expense'));

  if (input.goalReached) {
    return {
      title: 'Llegaste a tu objetivo',
      body: 'El objetivo de ganancia ya está adentro. Ahora podés seguir observando el margen o probar una meta nueva sin tocar tus datos reales.',
      tone: 'positive',
    };
  }

  const analysisLabel = comparison.windowLabel.toLowerCase();
  const salesPct = comparison.sales.deltaPct;
  const rhythmPct = comparison.rhythm.deltaPct;
  if (comparison.sales.comparable && salesPct !== null && Math.abs(salesPct) >= 0.1) {
    const improving = comparison.sales.delta > 0;
    const rhythmExplainsIt = comparison.rhythm.comparable && rhythmPct !== null;
    if (!improving && rhythmExplainsIt && rhythmPct >= -0.03 && comparison.currentOpenDays < comparison.previousOpenDays) {
      return {
        title: `La ${analysisLabel} vendió menos, pero el ritmo se sostuvo`,
        body: `El total quedó abajo principalmente porque hubo menos días abiertos comparables. Por día abierto, el ritmo está prácticamente al nivel del tramo anterior.`,
        tone: 'neutral',
      };
    }
    return {
      title: improving ? `Esta ${analysisLabel} viene más fuerte` : `Esta ${analysisLabel} viene más floja`,
      body: rhythmExplainsIt
        ? `Las ventas están ${Math.round(Math.abs(salesPct) * 100)}% ${improving ? 'arriba' : 'abajo'} y el ritmo por día abierto está ${Math.round(Math.abs(rhythmPct) * 100)}% ${rhythmPct >= 0 ? 'arriba' : 'abajo'} frente al tramo anterior.`
        : `Las ventas están ${Math.round(Math.abs(salesPct) * 100)}% ${improving ? 'arriba' : 'abajo'} frente al tramo anterior comparable.`,
      tone: improving ? 'positive' : 'attention',
    };
  }

  if (pace.available && Math.abs(pace.pacePct) >= 8) {
    const ahead = pace.paceDelta >= 0;
    return {
      title: ahead ? 'Venís por delante del ritmo' : 'Este período viene más exigente',
      body: ahead
        ? `A esta altura llevás más ventas de las que necesitabas para sostener el camino al objetivo.`
        : 'Estás por debajo del ritmo esperado, pero Lebu todavía puede redistribuir lo que falta entre los días que quedan.',
      tone: ahead ? 'positive' : 'attention',
    };
  }

  if (comparison.profit.comparable && comparison.profit.deltaPct !== null && Math.abs(comparison.profit.deltaPct) >= 0.1) {
    const improving = comparison.profit.delta > 0;
    return {
      title: improving ? 'Tu resultado viene mejorando' : 'El resultado viene un poco más ajustado',
      body: improving
        ? 'En el mismo tramo del período anterior, la ganancia estimada era menor que ahora.'
        : 'En el mismo tramo anterior, la ganancia estimada era mayor. Mirar ventas y gastos por separado ayuda a entender qué cambió.',
      tone: improving ? 'positive' : 'attention',
    };
  }

  const expensesPct = comparison.expenses.deltaPct;
  if (salesPct !== null && expensesPct !== null && Math.abs(salesPct - expensesPct) >= 0.1) {
    const healthy = salesPct > expensesPct;
    return {
      title: healthy ? 'Las ventas están creciendo más que los gastos' : 'Los gastos están creciendo más rápido',
      body: healthy
        ? 'Eso ayuda a que el crecimiento se transforme en un mejor resultado, no solo en más movimiento.'
        : 'Hay algo para revisar: el aumento de gastos está comiendo una parte mayor del crecimiento de ventas.',
      tone: healthy ? 'positive' : 'attention',
    };
  }

  if (patterns.weeks.available && patterns.weeks.strongest && patterns.weeks.differencePct >= 0.15) {
    return {
      title: `${patterns.weeks.strongest.label} suele ser un tramo fuerte`,
      body: `Ya aparece un patrón repetido en ${patterns.weeks.sampleMonths} meses observados. Lebu va a seguir validándolo antes de convertirlo en una recomendación más fuerte.`,
      tone: 'positive',
    };
  }

  if (patterns.available && patterns.strongest && patterns.strongestVsAveragePct >= 0.15) {
    return {
      title: `${patterns.strongest.label} viene siendo un día fuerte`,
      body: 'Lebu ya ve una diferencia repetida respecto del promedio de tus otros días observados.',
      tone: 'positive',
    };
  }

  if (input.historicalSummary && !hasDetailedMovements) {
    return {
      title: 'Ya conozco tu progreso; ahora estoy aprendiendo tus días',
      body: 'Puedo calcular cuánto llevás y cuánto falta. Para detectar patrones necesito movimientos con fecha real.',
      tone: 'neutral',
    };
  }

  const hasAnyData = input.soldSoFar > 0 || input.expenses.length > 0 || Boolean(input.historicalSummary);
  if (!hasAnyData) {
    return {
      title: 'Ya sé hacia dónde querés ir',
      body: 'Cuando registres las primeras ventas y gastos voy a empezar a comparar lo que pasa con el ritmo que necesitás.',
      tone: 'neutral',
    };
  }

  return {
    title: 'Sin cambios grandes que necesiten tu atención',
    body: 'Por ahora el negocio no muestra un desvío fuerte. Lebu sigue mirando el ritmo y acumulando historial.',
    tone: 'neutral',
  };
}

export function buildAdjustmentSuggestion(input: BuildMiradaInput, comparison: PeriodComparison, pace: PaceAnalysis, patterns: PatternAnalysis): AdjustmentSuggestion {
  if (!input.hasTarget) {
    return {
      title: 'Definí una meta para empezar',
      body: 'Con un objetivo concreto, Lebu puede convertir tus movimientos en una referencia diaria y empezar a explicarte el ritmo.',
      tone: 'neutral',
      action: 'strategy',
      actionLabel: 'Definir mi estrategia',
    };
  }

  if (input.goalReached) {
    return {
      title: 'Ganaste margen para decidir',
      body: 'Podés mantener este objetivo y seguir acumulando ganancia, o probar una meta más ambiciosa sin modificar tu estrategia real.',
      tone: 'positive',
      action: 'simulator',
      actionLabel: 'Probar una meta nueva',
    };
  }

  const salesPct = comparison.sales.deltaPct;
  const expensesPct = comparison.expenses.deltaPct;
  if (salesPct !== null && expensesPct !== null && expensesPct - salesPct >= 0.1) {
    return {
      title: 'Hay margen para revisar los gastos',
      body: 'Los gastos están creciendo más rápido que las ventas. Mirar qué movimientos explican esa diferencia puede ayudarte a recuperar margen.',
      tone: 'attention',
      action: 'movements',
      actionLabel: 'Ver movimientos',
    };
  }

  if (pace.available && pace.pacePct <= -10) {
    return {
      title: 'Podés redistribuir el esfuerzo',
      body: 'El período viene más exigente. Revisar tu estrategia o apoyarte en los días que históricamente rinden mejor puede hacer el objetivo más manejable.',
      tone: 'attention',
      action: 'strategy',
      actionLabel: 'Revisar estrategia',
    };
  }

  if (pace.available && pace.pacePct >= 10) {
    return {
      title: 'Tenés un poco de aire',
      body: 'Venís por delante del ritmo. Podés sostener el plan o usar el simulador para ver qué pasaría con una meta un poco más ambiciosa.',
      tone: 'positive',
      action: 'simulator',
      actionLabel: 'Simular un ajuste',
    };
  }

  if (patterns.available && patterns.strongest) {
    return {
      title: `Seguí mirando ${patterns.strongest.label.toLowerCase()}`,
      body: 'Ese día viene rindiendo por encima del promedio. Todavía no hace falta cambiar nada: puede servirte como referencia para entender dónde se concentra tu mejor ritmo.',
      tone: 'neutral',
      action: null,
      actionLabel: null,
    };
  }

  return {
    title: 'Seguí cargando normalmente',
    body: 'No necesitás configurar nada más. Lebu va a ir afinando estas recomendaciones a medida que conozca más días reales de tu negocio.',
    tone: 'neutral',
    action: null,
    actionLabel: null,
  };
}

export function buildMiradaAnalysis(input: BuildMiradaInput): MiradaAnalysis {
  const comparison = buildPeriodComparison(input);
  const pace = buildCumulativePaceSeries(input);
  const patterns = buildPatterns(input);
  const primary = buildPrimaryObservation(input, comparison, pace, patterns);
  const adjustment = buildAdjustmentSuggestion(input, comparison, pace, patterns);
  const commercial = buildCommercialOpportunityAnalysis({
    today: input.today,
    period: input.currentPeriod,
    currentComparable: comparison.currentComparable,
    previousComparable: comparison.previousComparable,
    hasTarget: input.hasTarget,
    goalReached: input.goalReached,
    soldSoFar: input.soldSoFar,
    salesNeededForGoal: input.salesNeededForGoal,
    sales: input.sales,
    openWeekdays: input.openWeekdays,
    dayExceptions: input.dayExceptions,
    historicalSummary: input.historicalSummary,
  });
  const financial = buildFinancialDiagnosis({
    today: input.today,
    period: input.currentPeriod,
    salesToDate: input.soldSoFar,
    expectedSalesByToday: input.expectedSalesByToday,
    economicExpenses: input.economicExpenses,
    economicResult: input.economicResult,
    recurringExpected: input.recurringExpected,
    expenses: input.expenses,
    recurringCosts: input.recurringCosts,
    historicalSummary: input.historicalSummary,
    cashGuidance: input.cashGuidance,
  });
  return { comparison, pace, patterns, primary, adjustment, commercial, financial };
}
