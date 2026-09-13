import { resolveRecurringConfig, type RecurringHistoryEntry } from './recurring-history';

export type RecurringReconciliationSchedule =
  | { type: 'weekday'; weekday: number }
  | { type: 'month_days'; days: number[] };

export type ReconciliationRecurringCost = {
  id: number;
  name?: string;
  amount: string | number;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  paymentSchedule?: RecurringReconciliationSchedule | null;
  amountApproximate?: boolean;
  configHistory?: RecurringHistoryEntry[];
};

export type ReconciliationExpense = {
  date: string;
  amount: string | number;
  category?: string;
  note?: string;
  recurringCostId?: number | null;
  recurringOccurrenceDate?: string | null;
};

export type ReconciliationGroup = {
  recurringCostId: number;
  occurrenceDate: string;
  recurringName: string;
  expected: number;
  actual: number;
  /** Ajuste económico sobre lo previsto. Nunca es negativo por un pago parcial. */
  delta: number;
  /** Importe económico que Lebu considera para la ocurrencia. */
  effective: number;
  /** Parte de la obligación prevista que todavía no fue pagada/conciliada. */
  outstanding: number;
  status: 'partial' | 'covered';
  expenseCount: number;
};

function parseAmount(value: string | number | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateFromISO(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function toISO(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number) {
  const date = dateFromISO(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toISO(date);
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0, 12)).getUTCDate();
}

function clampMonthDay(year: number, monthIndex: number, day: number) {
  return Math.min(Math.max(Math.round(day || 1), 1), daysInMonth(year, monthIndex));
}

function normalizeSchedule(value: unknown, frequency: ReconciliationRecurringCost['frequency']): RecurringReconciliationSchedule | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (frequency === 'weekly' && source.type === 'weekday') {
    const weekday = Number(source.weekday);
    return Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? { type: 'weekday', weekday } : null;
  }
  if ((frequency === 'biweekly' || frequency === 'monthly') && source.type === 'month_days') {
    const limit = frequency === 'monthly' ? 1 : 2;
    const days = [...new Set((Array.isArray(source.days) ? source.days : [])
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31))]
      .sort((a, b) => a - b)
      .slice(0, limit);
    return days.length ? { type: 'month_days', days } : null;
  }
  return null;
}

function nearestDate(candidates: string[], target: string) {
  if (!candidates.length) return target;
  const targetTime = dateFromISO(target).getTime();
  return [...candidates].sort((a, b) => {
    const da = Math.abs(dateFromISO(a).getTime() - targetTime);
    const db = Math.abs(dateFromISO(b).getTime() - targetTime);
    return da - db || a.localeCompare(b);
  })[0];
}

/**
 * Devuelve una fecha canónica que identifica la ocurrencia recurrente a la que
 * corresponde un gasto real. No representa necesariamente la fecha en que se pagó:
 * sirve como clave estable para conciliar varios pagos contra una sola obligación.
 */
export function recurringOccurrenceDateForExpense(item: ReconciliationRecurringCost, expenseDate: string) {
  if (!expenseDate) return '';
  const config = resolveRecurringConfig(item, expenseDate);
  const frequency = config.frequency as ReconciliationRecurringCost['frequency'];
  const schedule = normalizeSchedule(config.paymentSchedule, frequency);
  const date = dateFromISO(expenseDate);

  if (frequency === 'weekly') {
    const weekday = date.getUTCDay();
    if (schedule?.type === 'weekday') {
      const delta = schedule.weekday - weekday;
      // Elegimos el vencimiento de la misma semana calendario (domingo-sábado).
      return addDays(expenseDate, delta);
    }
    // Sin día configurado usamos el lunes como clave estable de la semana.
    const mondayOffset = (weekday + 6) % 7;
    return addDays(expenseDate, -mondayOffset);
  }

  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  const day = date.getUTCDate();

  if (frequency === 'biweekly') {
    if (schedule?.type === 'month_days' && schedule.days.length) {
      const sortedDays = [...schedule.days].sort((a, b) => a - b);
      const configuredDay = day <= 15 ? sortedDays[0] : (sortedDays[1] ?? sortedDays[0]);
      const actualDay = clampMonthDay(year, monthIndex, configuredDay);
      return toISO(new Date(Date.UTC(year, monthIndex, actualDay, 12)));
    }
    return toISO(new Date(Date.UTC(year, monthIndex, day <= 15 ? 1 : 16, 12)));
  }

  if (schedule?.type === 'month_days' && schedule.days.length) {
    const actualDay = clampMonthDay(year, monthIndex, schedule.days[0]);
    return toISO(new Date(Date.UTC(year, monthIndex, actualDay, 12)));
  }
  return toISO(new Date(Date.UTC(year, monthIndex, 1, 12)));
}

export function expectedRecurringAmount(item: ReconciliationRecurringCost, occurrenceDate: string) {
  const config = resolveRecurringConfig(item, occurrenceDate);
  return Math.max(parseAmount(config.amount), 0);
}

function shiftMonths(value: string, months: number) {
  const date = dateFromISO(value);
  const day = date.getUTCDate();
  const shifted = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 12));
  shifted.setUTCDate(Math.min(day, daysInMonth(shifted.getUTCFullYear(), shifted.getUTCMonth())));
  return toISO(shifted);
}

/**
 * Opciones cercanas de ocurrencia para pagos tardíos/anticipados.
 * Ej.: un pago hecho el 7/9 puede corresponder al sueldo de agosto, septiembre u octubre.
 * La fecha elegida se guarda explícitamente para que varios pagos parciales se acumulen
 * contra la obligación correcta y no contra el mes/semana del día en que se pagó.
 */
export function recurringOccurrenceCandidates(item: ReconciliationRecurringCost, expenseDate: string) {
  if (!expenseDate) return [] as string[];
  const frequency = resolveRecurringConfig(item, expenseDate).frequency as ReconciliationRecurringCost['frequency'];
  let anchorDates: string[] = [];
  if (frequency === 'weekly') {
    anchorDates = [-14, -7, 0, 7, 14].map((offset) => addDays(expenseDate, offset));
  } else if (frequency === 'biweekly') {
    anchorDates = [-32, -16, 0, 16, 32].map((offset) => addDays(expenseDate, offset));
  } else {
    anchorDates = [-2, -1, 0, 1, 2].map((offset) => shiftMonths(expenseDate, offset));
  }
  return [...new Set(anchorDates.map((date) => recurringOccurrenceDateForExpense(item, date)).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

type AutomaticAssignment = {
  expenseIndex: number;
  recurringCostId: number;
  occurrenceDate: string;
};

function recurringDateTolerance(item: ReconciliationRecurringCost) {
  return item.frequency === 'weekly' ? 2 : item.frequency === 'biweekly' ? 4 : 3;
}

/**
 * Conciliación derivada para el caso común de onboarding:
 * el usuario importa gastos reales y recién después configura los recurrentes.
 *
 * Solo inferimos vínculos cuando la señal es fuerte. Primero usamos nombre/nota/categoría;
 * después permitimos importe casi exacto + fecha cercana únicamente si la combinación es
 * inequívoca dentro del conjunto completo. Si hay dudas, el gasto queda sin vincular.
 */
function deriveAutomaticAssignments(
  expenses: ReconciliationExpense[],
  recurringCosts: ReconciliationRecurringCost[],
  occupiedGroups: Set<string>,
) {
  const assignments = new Map<number, AutomaticAssignment>();

  // Fase 1: señal semántica fuerte. No aceptamos aquí coincidencias basadas solo en importe+fecha;
  // esas necesitan contexto global para evitar vincular dos gastos de $50k al mismo contador.
  expenses.forEach((expense, expenseIndex) => {
    const suggestion = suggestRecurringMatch(expense, recurringCosts);
    if (!suggestion || suggestion.reason === 'amount+date') return;
    assignments.set(expenseIndex, {
      expenseIndex,
      recurringCostId: suggestion.recurringCostId,
      occurrenceDate: suggestion.occurrenceDate,
    });
    occupiedGroups.add(`${suggestion.recurringCostId}|${suggestion.occurrenceDate}`);
  });

  // Fase 2: sin texto útil, aceptamos solo importe prácticamente exacto + fecha muy cercana,
  // y solo cuando hay una única fila candidata para esa ocurrencia y esa fila no compite con
  // otro recurrente. Esto permite reconocer, por ejemplo, un alquiler sin descripción pero
  // evita asumir que cualquier transferencia de $50k es el contador.
  const groupCandidates = new Map<string, Array<{ expenseIndex: number; recurringCostId: number; occurrenceDate: string }>>();
  const expenseCandidateGroups = new Map<number, Set<string>>();

  expenses.forEach((expense, expenseIndex) => {
    if (assignments.has(expenseIndex)) return;
    const actual = Math.max(parseAmount(expense.amount), 0);
    if (!expense.date || actual <= 0) return;

    for (const item of recurringCosts) {
      const occurrenceDate = recurringOccurrenceDateForExpense(item, expense.date);
      if (!occurrenceDate) continue;
      const key = `${Number(item.id)}|${occurrenceDate}`;
      if (occupiedGroups.has(key)) continue;
      const expected = expectedRecurringAmount(item, occurrenceDate);
      if (expected <= 0 || item.amountApproximate) continue;
      const relativeDiff = Math.abs(actual - expected) / expected;
      if (relativeDiff > 0.01) continue;
      if (dayDistance(expense.date, occurrenceDate) > recurringDateTolerance(item)) continue;

      const candidate = { expenseIndex, recurringCostId: Number(item.id), occurrenceDate };
      const list = groupCandidates.get(key) || [];
      list.push(candidate);
      groupCandidates.set(key, list);
      const groups = expenseCandidateGroups.get(expenseIndex) || new Set<string>();
      groups.add(key);
      expenseCandidateGroups.set(expenseIndex, groups);
    }
  });

  for (const [key, candidates] of groupCandidates) {
    if (candidates.length !== 1 || occupiedGroups.has(key)) continue;
    const candidate = candidates[0];
    if ((expenseCandidateGroups.get(candidate.expenseIndex)?.size || 0) !== 1) continue;
    assignments.set(candidate.expenseIndex, candidate);
    occupiedGroups.add(key);
  }

  return assignments;
}

export function reconcileRecurringExpenses(
  expenses: ReconciliationExpense[],
  recurringCosts: ReconciliationRecurringCost[],
) {
  const recurringById = new Map(recurringCosts.map((item) => [Number(item.id), item]));
  const unlinked: ReconciliationExpense[] = [];
  const grouped = new Map<string, ReconciliationGroup>();
  const pending: ReconciliationExpense[] = [];

  const addToGroup = (expense: ReconciliationExpense, recurringId: number, occurrenceDate: string) => {
    const item = recurringById.get(recurringId);
    if (!item || !occurrenceDate) return false;
    const key = `${recurringId}|${occurrenceDate}`;
    const current = grouped.get(key) || {
      recurringCostId: recurringId,
      occurrenceDate,
      recurringName: item.name || 'Gasto recurrente',
      expected: expectedRecurringAmount(item, occurrenceDate),
      actual: 0,
      delta: 0,
      effective: expectedRecurringAmount(item, occurrenceDate),
      outstanding: expectedRecurringAmount(item, occurrenceDate),
      status: 'partial',
      expenseCount: 0,
    };
    current.actual += Math.max(parseAmount(expense.amount), 0);
    current.expenseCount += 1;

    // 1.22.3 — pagos parciales:
    // vincular un pago de 50k a un sueldo exacto de 700k NO significa que el sueldo
    // haya pasado a costar 50k. La obligación económica sigue siendo 700k y, para Caja,
    // quedan 650k pendientes. Solo aplicamos un desvío positivo cuando lo realmente pagado
    // supera lo previsto. Esto también permite acumular varios pagos en la misma ocurrencia.
    current.delta = Math.max(current.actual - current.expected, 0);
    current.effective = Math.max(current.expected, current.actual);
    current.outstanding = Math.max(current.expected - current.actual, 0);
    current.status = current.outstanding > 0 ? 'partial' : 'covered';
    grouped.set(key, current);
    return true;
  };

  // Primero respetamos todos los vínculos explícitos que ya guardó el usuario/importador.
  for (const expense of expenses) {
    const recurringId = Number(expense.recurringCostId);
    const item = Number.isFinite(recurringId) ? recurringById.get(recurringId) : undefined;
    if (!item) {
      pending.push(expense);
      continue;
    }

    const occurrenceDate = String(expense.recurringOccurrenceDate || recurringOccurrenceDateForExpense(item, expense.date));
    if (!addToGroup(expense, recurringId, occurrenceDate)) pending.push(expense);
  }

  // Después inferimos únicamente coincidencias inequívocas entre gastos ya cargados y
  // recurrentes configurados más tarde. Es una conciliación derivada: no reescribe el dato
  // original ni inventa un gasto; solo evita contar dos veces la misma obligación.
  const occupiedGroups = new Set(grouped.keys());
  const assignments = deriveAutomaticAssignments(pending, recurringCosts, occupiedGroups);
  pending.forEach((expense, index) => {
    const assignment = assignments.get(index);
    if (!assignment || !addToGroup(expense, assignment.recurringCostId, assignment.occurrenceDate)) {
      unlinked.push(expense);
    }
  });

  const groups = [...grouped.values()].sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate) || a.recurringName.localeCompare(b.recurringName));
  const expectedLinkedTotal = groups.reduce((sum, group) => sum + group.expected, 0);
  const actualLinkedTotal = groups.reduce((sum, group) => sum + group.actual, 0);
  const delta = groups.reduce((sum, group) => sum + group.delta, 0);
  const outstandingLinkedTotal = groups.reduce((sum, group) => sum + group.outstanding, 0);

  return {
    unlinked,
    groups,
    expectedLinkedTotal,
    actualLinkedTotal,
    outstandingLinkedTotal,
    delta,
    automaticMatchCount: assignments.size,
  };
}

function normalizeText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenSet(value: string) {
  return new Set(normalizeText(value).split(' ').filter((token) => token.length >= 2));
}

function tokenOverlap(a: string, b: string) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / Math.max(left.size, right.size);
}

function dayDistance(a: string, b: string) {
  return Math.round(Math.abs(dateFromISO(a).getTime() - dateFromISO(b).getTime()) / 86_400_000);
}

export type RecurringMatchSuggestion = {
  recurringCostId: number;
  occurrenceDate: string;
  score: number;
  reason: 'name+amount' | 'name' | 'amount+date';
};

/**
 * Sugiere vínculos solo cuando la señal es suficientemente fuerte. Si hay ambigüedad,
 * no concilia en silencio: la fila queda como gasto normal hasta que el usuario elija.
 */
export function suggestRecurringMatch(
  expense: Pick<ReconciliationExpense, 'date' | 'amount' | 'category' | 'note'> & { reference?: string },
  recurringCosts: ReconciliationRecurringCost[],
): RecurringMatchSuggestion | null {
  const haystack = normalizeText(`${expense.note || ''} ${expense.category || ''} ${expense.reference || ''}`);
  const actual = Math.max(parseAmount(expense.amount), 0);
  if (!expense.date || !actual || !recurringCosts.length) return null;

  const scored = recurringCosts.map((item) => {
    const name = normalizeText(item.name || '');
    const occurrenceDate = recurringOccurrenceDateForExpense(item, expense.date);
    const expected = expectedRecurringAmount(item, occurrenceDate);
    const relativeDiff = expected > 0 ? Math.abs(actual - expected) / expected : 1;
    const distance = dayDistance(expense.date, occurrenceDate);

    const containsName = Boolean(name && name.length >= 3 && haystack.includes(name));
    const overlap = name ? tokenOverlap(haystack, name) : 0;
    const nameScore = containsName ? 0.62 : overlap >= 0.75 ? 0.54 : overlap >= 0.5 ? 0.38 : overlap >= 0.34 ? 0.22 : 0;
    const amountScore = item.amountApproximate
      ? (relativeDiff <= 0.1 ? 0.22 : relativeDiff <= 0.3 ? 0.17 : relativeDiff <= 0.6 ? 0.1 : 0.03)
      : (relativeDiff <= 0.01 ? 0.28 : relativeDiff <= 0.05 ? 0.24 : relativeDiff <= 0.15 ? 0.16 : relativeDiff <= 0.3 ? 0.07 : 0);
    const allowedDistance = item.frequency === 'weekly' ? 3 : item.frequency === 'biweekly' ? 7 : 12;
    const dateScore = distance === 0 ? 0.16 : distance <= allowedDistance ? 0.1 : 0;
    const score = nameScore + amountScore + dateScore;
    const reason: RecurringMatchSuggestion['reason'] = nameScore > 0 && amountScore > 0 ? 'name+amount' : nameScore > 0 ? 'name' : 'amount+date';
    return { recurringCostId: Number(item.id), occurrenceDate, score, reason, nameScore, amountScore, dateScore };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];
  if (!best) return null;
  // Sin señal de nombre exigimos coincidencia casi exacta de importe+fecha y que sea inequívoca.
  const strongWithoutName = best.nameScore === 0 && best.amountScore >= 0.28 && best.dateScore >= 0.16;
  const strongWithName = best.nameScore >= 0.38 && best.score >= 0.7;
  const separated = !second || best.score - second.score >= 0.14;
  if (!(strongWithName || strongWithoutName) || !separated) return null;

  return {
    recurringCostId: best.recurringCostId,
    occurrenceDate: best.occurrenceDate,
    score: best.score,
    reason: best.reason,
  };
}
