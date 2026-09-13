export type CommercialTone = 'positive' | 'attention' | 'neutral';
export type CommercialConfidence = 'learning' | 'early' | 'medium' | 'high';

export type CommercialSaleItem = {
  name: string;
  quantity?: number;
  amount?: number;
  category?: string;
};

export type CommercialSale = {
  date: string;
  amount: string;
  // Preparado para FUDO/API o importaciones que conserven el timestamp real.
  occurredAt?: string;
  // Hora local del comercio ya normalizada por la integración. Se prefiere sobre parsear
  // un timestamp en el dispositivo para no depender de la zona horaria desde la que se mira Lebu.
  localHour?: number;
  // Cuando la fuente lo conozca, evita depender de heurísticas para hablar de tickets.
  ticketId?: string;
  // Detalle opcional de productos. La 1.21.10 no lo persiste todavía: el motor queda listo
  // para consumirlo cuando FUDO lo entregue.
  items?: CommercialSaleItem[];
};

export type CommercialDayException = { date: string; open: boolean };
export type CommercialRange = { start: string; end: string };

export type CommercialOpportunityKind =
  | 'goal-pressure'
  | 'goal-operations'
  | 'traffic'
  | 'ticket'
  | 'quiet-day'
  | 'strong-day'
  | 'hourly-gap'
  | 'product-driver';

export type CommercialOpportunity = {
  id: string;
  kind: CommercialOpportunityKind;
  label: string;
  title: string;
  body: string;
  evidence: string;
  tone: CommercialTone;
  confidence: CommercialConfidence;
  priority: number;
  referenceAmount?: number;
};

export type CommercialTransactionSignal = {
  available: boolean;
  confidence: CommercialConfidence;
  totalRows: number;
  activeDays: number;
  medianRowsPerDay: number;
  averageTicket: number;
  currentCount: number;
  previousCount: number;
  currentAverageTicket: number;
  previousAverageTicket: number;
  countDeltaPct: number | null;
  ticketDeltaPct: number | null;
  learningMessage: string;
};

export type CommercialCapabilities = {
  daily: boolean;
  transactions: boolean;
  hourly: boolean;
  products: boolean;
};

export type CommercialOpportunityAnalysis = {
  available: boolean;
  observedDays: number;
  recentDailyAverage: number;
  remainingOpenDays: number;
  remainingRevenueGap: number;
  requiredPerOpenDay: number;
  pressureVsAveragePct: number | null;
  opportunities: CommercialOpportunity[];
  transactionSignal: CommercialTransactionSignal;
  capabilities: CommercialCapabilities;
  learningMessage: string;
};

export type BuildCommercialOpportunitiesInput = {
  today: string;
  period: CommercialRange;
  currentComparable: CommercialRange;
  previousComparable: CommercialRange;
  hasTarget: boolean;
  goalReached: boolean;
  soldSoFar: number;
  salesNeededForGoal: number;
  sales: CommercialSale[];
  openWeekdays: number[];
  dayExceptions: CommercialDayException[];
  // Opcional: si hay un acumulado sin detalle, no inventamos operaciones dentro de ese rango.
  historicalSummary?: { startDate: string; endDate: string; salesCovered?: boolean; salesTotal?: string } | null;
};

const weekdayLabels = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

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

function confidenceForSamples(samples: number): CommercialConfidence {
  if (samples >= 12) return 'high';
  if (samples >= 7) return 'medium';
  if (samples >= 3) return 'early';
  return 'learning';
}

function summaryCoversSales(summary: BuildCommercialOpportunitiesInput['historicalSummary']) {
  if (!summary) return false;
  if (typeof summary.salesCovered === 'boolean') return summary.salesCovered;
  return parseMoney(summary.salesTotal || '') > 0;
}

function insideAggregateSummary(date: string, summary: BuildCommercialOpportunitiesInput['historicalSummary']) {
  return Boolean(summary && summaryCoversSales(summary) && date >= summary.startDate && date <= summary.endDate);
}

function isOpenDate(dateISO: string, openWeekdays: number[], exceptions: CommercialDayException[]) {
  const exception = exceptions.find((item) => item.date === dateISO);
  if (exception) return exception.open;
  return openWeekdays.includes(fromISO(dateISO).getDay());
}

function listOpenDates(start: string, end: string, openWeekdays: number[], exceptions: CommercialDayException[]) {
  const dates: string[] = [];
  if (!start || !end || end < start) return dates;
  for (let date = fromISO(start); toISO(date) <= end; date = addDays(date, 1)) {
    const iso = toISO(date);
    if (isOpenDate(iso, openWeekdays, exceptions)) dates.push(iso);
  }
  return dates;
}

function pctDelta(current: number, previous: number) {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function salesInRange(input: BuildCommercialOpportunitiesInput, range: CommercialRange) {
  return input.sales.filter((sale) => sale.date >= range.start && sale.date <= range.end && !insideAggregateSummary(sale.date, input.historicalSummary) && parseMoney(sale.amount) > 0);
}

function buildTransactionSignal(input: BuildCommercialOpportunitiesInput): CommercialTransactionSignal {
  const cutoff = toISO(addDays(fromISO(input.today), -84));
  const history = input.sales.filter((sale) => sale.date < input.today && sale.date >= cutoff && !insideAggregateSummary(sale.date, input.historicalSummary) && parseMoney(sale.amount) > 0);
  const counts = new Map<string, number>();
  for (const sale of history) counts.set(sale.date, (counts.get(sale.date) || 0) + 1);
  const rowsPerDay = [...counts.values()];
  const totalRows = history.length;
  const activeDays = counts.size;
  const medianRowsPerDay = median(rowsPerDay);

  // Sin un identificador explícito de ticket, evitamos llamar “ticket” a cualquier lista de movimientos.
  // Varias operaciones por día + una muestra suficiente es una señal razonable; FUDO podrá marcarlo
  // de forma explícita más adelante y eliminar esta heurística.
  const explicitTicketRows = history.filter((sale) => Boolean(sale.ticketId)).length;
  const explicitEnough = explicitTicketRows >= Math.max(20, totalRows * 0.7);
  const heuristicEnough = totalRows >= 30 && activeDays >= 5 && medianRowsPerDay >= 3;
  const available = explicitEnough || heuristicEnough;
  const confidence: CommercialConfidence = !available
    ? 'learning'
    : explicitEnough && totalRows >= 100
      ? 'high'
      : totalRows >= 140
        ? 'high'
        : totalRows >= 70
          ? 'medium'
          : 'early';

  const averageTicket = available && totalRows > 0
    ? history.reduce((sum, sale) => sum + parseMoney(sale.amount), 0) / totalRows
    : 0;

  const currentRows = salesInRange(input, input.currentComparable);
  const previousRows = salesInRange(input, input.previousComparable);
  const currentTotal = currentRows.reduce((sum, sale) => sum + parseMoney(sale.amount), 0);
  const previousTotal = previousRows.reduce((sum, sale) => sum + parseMoney(sale.amount), 0);
  const currentCount = available ? currentRows.length : 0;
  const previousCount = available ? previousRows.length : 0;
  const currentAverageTicket = currentCount > 0 ? currentTotal / currentCount : 0;
  const previousAverageTicket = previousCount > 0 ? previousTotal / previousCount : 0;

  return {
    available,
    confidence,
    totalRows,
    activeDays,
    medianRowsPerDay,
    averageTicket,
    currentCount,
    previousCount,
    currentAverageTicket,
    previousAverageTicket,
    countDeltaPct: available ? pctDelta(currentCount, previousCount) : null,
    ticketDeltaPct: available ? pctDelta(currentAverageTicket, previousAverageTicket) : null,
    learningMessage: available
      ? ''
      : 'Todavía no puedo asegurar que cada venta cargada represente una operación individual. Cuando la fuente lo confirme, voy a separar cantidad de tickets y ticket promedio sin adivinar.',
  };
}

function buildDailyHistory(input: BuildCommercialOpportunitiesInput) {
  const cutoff = toISO(addDays(fromISO(input.today), -84));
  const totals = new Map<string, number>();
  for (const sale of input.sales) {
    if (!sale.date || sale.date >= input.today || sale.date < cutoff) continue;
    if (insideAggregateSummary(sale.date, input.historicalSummary)) continue;
    if (!isOpenDate(sale.date, input.openWeekdays, input.dayExceptions)) continue;
    const amount = parseMoney(sale.amount);
    if (amount <= 0) continue;
    totals.set(sale.date, (totals.get(sale.date) || 0) + amount);
  }

  const recentEntries = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-24);
  const recentDailyAverage = recentEntries.length
    ? recentEntries.reduce((sum, [, amount]) => sum + amount, 0) / recentEntries.length
    : 0;

  const weekdayValues = new Map<number, number[]>();
  for (const [date, amount] of recentEntries) {
    const weekday = fromISO(date).getDay();
    const list = weekdayValues.get(weekday) || [];
    list.push(amount);
    weekdayValues.set(weekday, list);
  }

  const weekdayStats = input.openWeekdays.map((weekday) => {
    const values = weekdayValues.get(weekday) || [];
    return {
      weekday,
      samples: values.length,
      average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    };
  });

  return { totals, recentEntries, recentDailyAverage, weekdayStats };
}

function buildHourlyOpportunity(input: BuildCommercialOpportunitiesInput): CommercialOpportunity | null {
  const cutoff = toISO(addDays(fromISO(input.today), -56));
  const timestamped = input.sales.filter((sale) => sale.occurredAt && sale.date < input.today && sale.date >= cutoff && !insideAggregateSummary(sale.date, input.historicalSummary) && parseMoney(sale.amount) > 0);
  const days = new Set(timestamped.map((sale) => sale.date));
  if (timestamped.length < 40 || days.size < 5) return null;

  const buckets = new Map<number, { total: number; days: Set<string>; rows: number }>();
  for (const sale of timestamped) {
    const parsed = new Date(sale.occurredAt!);
    const normalizedHour = Number.isFinite(sale.localHour) ? Number(sale.localHour) : null;
    if (normalizedHour == null && Number.isNaN(parsed.getTime())) continue;
    const hour = normalizedHour == null ? parsed.getHours() : Math.min(Math.max(Math.floor(normalizedHour), 0), 23);
    const bucket = Math.floor(hour / 2) * 2;
    const row = buckets.get(bucket) || { total: 0, days: new Set<string>(), rows: 0 };
    row.total += parseMoney(sale.amount);
    row.days.add(sale.date);
    row.rows += 1;
    buckets.set(bucket, row);
  }

  const eligible = [...buckets.entries()]
    .filter(([, value]) => value.days.size >= 3 && value.rows >= 8)
    .map(([bucket, value]) => ({ bucket, samples: value.days.size, averagePerDay: value.total / value.days.size }));
  if (eligible.length < 2) return null;

  const sorted = eligible.slice().sort((a, b) => a.averagePerDay - b.averagePerDay);
  const quiet = sorted[0];
  const typical = eligible.reduce((sum, item) => sum + item.averagePerDay, 0) / eligible.length;
  if (typical <= 0 || quiet.averagePerDay >= typical * 0.82) return null;
  const gapPct = (typical - quiet.averagePerDay) / typical;
  const end = (quiet.bucket + 2) % 24;
  const label = `${String(quiet.bucket).padStart(2, '0')}:00–${String(end).padStart(2, '0')}:00`;

  return {
    id: `hourly-${quiet.bucket}`,
    kind: 'hourly-gap',
    label: 'FRANJA HORARIA',
    title: `${label} aparece como una franja más floja`,
    body: `En los días comparables mueve alrededor de ${Math.round(gapPct * 100)}% menos que una franja típica observada. Es un buen lugar para probar una acción comercial y medir si cambia el resultado.`,
    evidence: `${quiet.samples} días con evidencia en esa franja`,
    tone: 'attention',
    confidence: confidenceForSamples(quiet.samples),
    priority: 84,
  };
}

function buildProductOpportunity(input: BuildCommercialOpportunitiesInput): CommercialOpportunity | null {
  const cutoff = toISO(addDays(fromISO(input.today), -84));
  const rows = input.sales.filter((sale) => sale.items?.length && sale.date < input.today && sale.date >= cutoff && !insideAggregateSummary(sale.date, input.historicalSummary));
  if (rows.length < 30) return null;

  const overallAverage = rows.reduce((sum, sale) => sum + parseMoney(sale.amount), 0) / rows.length;
  const products = new Map<string, { tickets: number; ticketTotal: number }>();
  for (const sale of rows) {
    const seen = new Set<string>();
    for (const item of sale.items || []) {
      const name = item.name?.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const row = products.get(name) || { tickets: 0, ticketTotal: 0 };
      row.tickets += 1;
      row.ticketTotal += parseMoney(sale.amount);
      products.set(name, row);
    }
  }

  const candidates = [...products.entries()]
    .map(([name, value]) => ({ name, ...value, penetration: value.tickets / rows.length, averageTicket: value.ticketTotal / value.tickets }))
    .filter((item) => item.tickets >= 10 && item.penetration >= 0.12 && item.averageTicket >= overallAverage * 1.12)
    .sort((a, b) => (b.averageTicket / overallAverage) - (a.averageTicket / overallAverage));
  const best = candidates[0];
  if (!best || overallAverage <= 0) return null;
  const lift = (best.averageTicket - overallAverage) / overallAverage;

  return {
    id: `product-${best.name.toLowerCase()}`,
    kind: 'product-driver',
    label: 'PRODUCTO',
    title: `${best.name} aparece en tickets más altos`,
    body: `Cuando aparece, el ticket promedio observado es aproximadamente ${Math.round(lift * 100)}% mayor. No significa que lo cause, pero sí es una pista útil para pensar combinaciones o visibilidad.`,
    evidence: `${best.tickets} operaciones observadas · aparece en ${Math.round(best.penetration * 100)}% de la muestra`,
    tone: 'positive',
    confidence: confidenceForSamples(Math.min(best.tickets, 12)),
    priority: 82,
  };
}

export function buildCommercialOpportunityAnalysis(input: BuildCommercialOpportunitiesInput): CommercialOpportunityAnalysis {
  const daily = buildDailyHistory(input);
  const transactionSignal = buildTransactionSignal(input);
  const remainingOpenDates = listOpenDates(input.today, input.period.end, input.openWeekdays, input.dayExceptions);
  const remainingOpenDays = remainingOpenDates.length;
  const remainingRevenueGap = input.hasTarget && !input.goalReached
    ? Math.max(input.salesNeededForGoal - input.soldSoFar, 0)
    : 0;
  const requiredPerOpenDay = remainingOpenDays > 0 ? remainingRevenueGap / remainingOpenDays : 0;
  const pressureVsAveragePct = daily.recentDailyAverage > 0 && requiredPerOpenDay > 0
    ? (requiredPerOpenDay - daily.recentDailyAverage) / daily.recentDailyAverage
    : null;

  const opportunities: CommercialOpportunity[] = [];

  if (input.hasTarget && !input.goalReached && remainingOpenDays > 0 && daily.recentDailyAverage > 0) {
    const pressure = pressureVsAveragePct || 0;
    if (pressure >= 0.2) {
      opportunities.push({
        id: 'goal-pressure',
        kind: 'goal-pressure',
        label: 'RITMO NECESARIO',
        title: 'El objetivo pide más que tu ritmo reciente',
        body: `Para cerrar el período, necesitás promediar aproximadamente ${Math.round(pressure * 100)}% más por día abierto que en tus últimas jornadas observadas. Acá conviene buscar una palanca comercial concreta, no solamente “vender un poco más”.`,
        evidence: `${remainingOpenDays} días abiertos por delante · promedio reciente ${Math.round(daily.recentDailyAverage).toLocaleString('es-AR')}`,
        tone: 'attention',
        confidence: confidenceForSamples(daily.recentEntries.length),
        priority: 96,
        referenceAmount: requiredPerOpenDay,
      });
    } else if (pressure <= -0.15) {
      opportunities.push({
        id: 'goal-pressure',
        kind: 'goal-pressure',
        label: 'RITMO NECESARIO',
        title: 'La meta está dentro de tu ritmo habitual',
        body: `El promedio diario que necesitás de acá al cierre está por debajo de lo que venís logrando recientemente. No hace falta forzar una acción agresiva si el ritmo se sostiene.`,
        evidence: `${remainingOpenDays} días abiertos por delante · exigencia diaria de referencia ${Math.round(requiredPerOpenDay).toLocaleString('es-AR')}`,
        tone: 'positive',
        confidence: confidenceForSamples(daily.recentEntries.length),
        priority: 78,
        referenceAmount: requiredPerOpenDay,
      });
    } else {
      opportunities.push({
        id: 'goal-pressure',
        kind: 'goal-pressure',
        label: 'RITMO NECESARIO',
        title: 'El objetivo pide un ritmo parecido al que ya venís logrando',
        body: 'La exigencia de los días que quedan está cerca de tu promedio reciente. El foco debería estar en sostener la regularidad antes que cambiar todo el plan.',
        evidence: `${remainingOpenDays} días abiertos por delante · exigencia diaria de referencia ${Math.round(requiredPerOpenDay).toLocaleString('es-AR')}`,
        tone: 'neutral',
        confidence: confidenceForSamples(daily.recentEntries.length),
        priority: 76,
        referenceAmount: requiredPerOpenDay,
      });
    }
  }

  if (transactionSignal.available) {
    const { countDeltaPct, ticketDeltaPct } = transactionSignal;
    const currentHasComparison = transactionSignal.currentCount >= 5 && transactionSignal.previousCount >= 5;
    if (currentHasComparison && countDeltaPct !== null && ticketDeltaPct !== null) {
      if (countDeltaPct <= -0.1 && ticketDeltaPct > -0.07) {
        opportunities.push({
          id: 'traffic-diagnosis',
          kind: 'traffic',
          label: 'OPERACIONES',
          title: 'La caída parece venir más por cantidad de operaciones que por ticket',
          body: `En el tramo comparable hubo aproximadamente ${Math.round(Math.abs(countDeltaPct) * 100)}% menos operaciones, mientras el ticket promedio se sostuvo bastante mejor. La primera hipótesis a atacar es tráfico/frecuencia, no descuento general.`,
          evidence: `${transactionSignal.currentCount} operaciones vs. ${transactionSignal.previousCount} en el tramo anterior`,
          tone: 'attention',
          confidence: transactionSignal.confidence,
          priority: 91,
        });
      } else if (ticketDeltaPct <= -0.1 && countDeltaPct > -0.07) {
        opportunities.push({
          id: 'ticket-diagnosis',
          kind: 'ticket',
          label: 'TICKET',
          title: 'La cantidad de operaciones se sostiene, pero el ticket se achicó',
          body: `El ticket promedio está cerca de ${Math.round(Math.abs(ticketDeltaPct) * 100)}% abajo mientras la cantidad de operaciones cambió menos. Acá tiene más sentido pensar en combinaciones, agregado por compra o mix que en traer mucha más gente.`,
          evidence: `Ticket actual de referencia ${Math.round(transactionSignal.currentAverageTicket).toLocaleString('es-AR')} vs. ${Math.round(transactionSignal.previousAverageTicket).toLocaleString('es-AR')}`,
          tone: 'attention',
          confidence: transactionSignal.confidence,
          priority: 91,
        });
      } else if (countDeltaPct >= 0.12 && Math.abs(ticketDeltaPct) < 0.1) {
        opportunities.push({
          id: 'traffic-growth',
          kind: 'traffic',
          label: 'OPERACIONES',
          title: 'El crecimiento viene principalmente por más operaciones',
          body: `La cantidad de operaciones subió aproximadamente ${Math.round(countDeltaPct * 100)}% y el ticket promedio cambió bastante menos. La señal más fuerte hoy es que estás moviendo más gente/compras, no solamente cobrando tickets más altos.`,
          evidence: `${transactionSignal.currentCount} operaciones vs. ${transactionSignal.previousCount} en el tramo comparable`,
          tone: 'positive',
          confidence: transactionSignal.confidence,
          priority: 83,
        });
      } else if (ticketDeltaPct >= 0.12 && Math.abs(countDeltaPct) < 0.1) {
        opportunities.push({
          id: 'ticket-growth',
          kind: 'ticket',
          label: 'TICKET',
          title: 'El crecimiento viene principalmente por un ticket más alto',
          body: `El ticket promedio subió aproximadamente ${Math.round(ticketDeltaPct * 100)}% mientras la cantidad de operaciones cambió bastante menos. Vale la pena entender qué mix o combinación está empujando ese resultado.`,
          evidence: `Ticket actual de referencia ${Math.round(transactionSignal.currentAverageTicket).toLocaleString('es-AR')}`,
          tone: 'positive',
          confidence: transactionSignal.confidence,
          priority: 83,
        });
      }
    }

    if (remainingRevenueGap > 0 && remainingOpenDays > 0 && transactionSignal.averageTicket > 0) {
      const operationsTotal = Math.ceil(remainingRevenueGap / transactionSignal.averageTicket);
      const operationsPerDay = Math.ceil(operationsTotal / remainingOpenDays);
      opportunities.push({
        id: 'goal-operations',
        kind: 'goal-operations',
        label: 'TRADUCIDO A OPERACIONES',
        title: `El faltante equivale a unas ${operationsTotal} operaciones de tu ticket habitual`,
        body: `Como referencia, son cerca de ${operationsPerDay} operaciones adicionales por cada día abierto que queda. Es una forma más concreta de dimensionar el esfuerzo que mirar solamente un monto grande.`,
        evidence: `Ticket estimado reciente ${Math.round(transactionSignal.averageTicket).toLocaleString('es-AR')} · no es un pronóstico`,
        tone: pressureVsAveragePct !== null && pressureVsAveragePct >= 0.2 ? 'attention' : 'neutral',
        confidence: transactionSignal.confidence,
        priority: 86,
        referenceAmount: operationsTotal,
      });
    }
  }

  const eligibleWeekdays = daily.weekdayStats.filter((item) => item.samples >= 3 && item.average > 0);
  if (eligibleWeekdays.length >= 2) {
    const overall = eligibleWeekdays.reduce((sum, item) => sum + item.average, 0) / eligibleWeekdays.length;
    const sorted = eligibleWeekdays.slice().sort((a, b) => a.average - b.average);
    const quiet = sorted[0];
    const strong = sorted[sorted.length - 1];
    const quietGapPct = overall > 0 ? (overall - quiet.average) / overall : 0;
    const strongLiftPct = overall > 0 ? (strong.average - overall) / overall : 0;
    const remainingQuiet = remainingOpenDates.filter((date) => fromISO(date).getDay() === quiet.weekday).length;
    const remainingStrong = remainingOpenDates.filter((date) => fromISO(date).getDay() === strong.weekday).length;

    if (quietGapPct >= 0.15) {
      const potential = Math.max(overall - quiet.average, 0) * remainingQuiet;
      opportunities.push({
        id: `quiet-day-${quiet.weekday}`,
        kind: 'quiet-day',
        label: 'DÍA CON OPORTUNIDAD',
        title: `${weekdayLabels[quiet.weekday]} viene siendo tu día más flojo`,
        body: remainingQuiet > 0
          ? `Promedia alrededor de ${Math.round(quietGapPct * 100)}% menos que un día típico de tu negocio. Si querés probar una acción comercial, es un buen lugar para hacerlo sin tocar primero los días que ya funcionan.`
          : `Promedia alrededor de ${Math.round(quietGapPct * 100)}% menos que un día típico. Aunque no quede otro este período, es una señal para el próximo ciclo.`,
        evidence: remainingQuiet > 0 && potential > 0
          ? `${quiet.samples} muestras · llevar los ${remainingQuiet} que quedan al promedio representaría ~${Math.round(potential).toLocaleString('es-AR')} de diferencia de referencia`
          : `${quiet.samples} muestras · promedio ${Math.round(quiet.average).toLocaleString('es-AR')}`,
        tone: 'attention',
        confidence: confidenceForSamples(quiet.samples),
        priority: 81,
        referenceAmount: potential > 0 ? potential : undefined,
      });
    }

    if (remainingRevenueGap > 0 && remainingStrong > 0 && strongLiftPct >= 0.1) {
      const referenceContribution = strong.average * remainingStrong;
      const coveragePct = remainingRevenueGap > 0 ? referenceContribution / remainingRevenueGap : 0;
      opportunities.push({
        id: `strong-day-${strong.weekday}`,
        kind: 'strong-day',
        label: 'DÍA FUERTE',
        title: `${weekdayLabels[strong.weekday]} puede ayudarte a absorber una parte importante del faltante`,
        body: `Te ${remainingStrong === 1 ? 'queda' : 'quedan'} ${remainingStrong} ${weekdayLabels[strong.weekday]} en el período y viene promediando por encima de tus otros días. La prioridad ahí es sostener lo que ya funciona; las pruebas comerciales más agresivas tienen más sentido en los días flojos.`,
        evidence: `${strong.samples} muestras · promedio ${Math.round(strong.average).toLocaleString('es-AR')} · referencia equivalente a ${Math.round(Math.min(coveragePct, 1) * 100)}% del faltante actual`,
        tone: 'positive',
        confidence: confidenceForSamples(strong.samples),
        priority: 73,
        referenceAmount: referenceContribution,
      });
    }
  }

  const hourlyOpportunity = buildHourlyOpportunity(input);
  if (hourlyOpportunity) opportunities.push(hourlyOpportunity);
  const productOpportunity = buildProductOpportunity(input);
  if (productOpportunity) opportunities.push(productOpportunity);

  const timestampedRows = input.sales.filter((sale) => Boolean(sale.occurredAt)).length;
  const itemRows = input.sales.filter((sale) => Boolean(sale.items?.length)).length;
  const capabilities: CommercialCapabilities = {
    daily: daily.recentEntries.length >= 5,
    transactions: transactionSignal.available,
    hourly: timestampedRows >= 40 && new Set(input.sales.filter((sale) => sale.occurredAt).map((sale) => sale.date)).size >= 5,
    products: itemRows >= 30,
  };

  const unique = new Map<string, CommercialOpportunity>();
  opportunities
    .sort((a, b) => b.priority - a.priority)
    .forEach((item) => { if (!unique.has(item.id)) unique.set(item.id, item); });
  const selected = [...unique.values()].slice(0, 3);

  const available = selected.length > 0 || capabilities.daily;
  const learningMessage = available
    ? ''
    : 'Todavía necesito algunos días de ventas con fecha real para separar una oportunidad comercial de una variación normal.';

  return {
    available,
    observedDays: daily.recentEntries.length,
    recentDailyAverage: daily.recentDailyAverage,
    remainingOpenDays,
    remainingRevenueGap,
    requiredPerOpenDay,
    pressureVsAveragePct,
    opportunities: selected,
    transactionSignal,
    capabilities,
    learningMessage,
  };
}
