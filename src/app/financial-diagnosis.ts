import type { CashGuidance } from './cashflow';

export type FinancialDiagnosisTone = 'positive' | 'attention' | 'neutral';
export type FinancialPaceStatus = 'ahead' | 'on-track' | 'behind' | 'learning';
export type FinancialBucketKey = 'purchases' | 'payroll' | 'structure' | 'taxes' | 'investment' | 'other' | 'aggregate';

export type FinancialExpense = {
  date: string;
  amount: string | number;
  category?: string;
  note?: string;
  recurringCostId?: number | null;
};

export type FinancialRecurringCost = {
  id: number;
  name?: string;
};

export type FinancialHistoricalSummary = {
  startDate: string;
  endDate: string;
  expensesTotal: string | number;
  expensesCovered?: boolean;
} | null;

export type FinancialBucket = {
  key: FinancialBucketKey;
  label: string;
  amount: number;
  movements: number;
  shareOfExpenses: number;
  shareOfSales: number;
  note: string;
};

export type FinancialDiagnosis = {
  available: boolean;
  headline: string;
  body: string;
  tone: FinancialDiagnosisTone;
  salesToDate: number;
  expectedSalesByToday: number;
  salesPaceDelta: number;
  salesPacePct: number | null;
  paceStatus: FinancialPaceStatus;
  recordedExpenses: number;
  recordedBalance: number;
  economicExpenses: number;
  economicResult: number;
  recurringExpected: number;
  buckets: FinancialBucket[];
  topPressure: FinancialBucket | null;
  cash: {
    hasSnapshot: boolean;
    confidence: CashGuidance['confidence'];
    confirmed: number;
    estimated: number;
    daysSinceConfirmation: number | null;
    knownInflows: number;
    knownOutflows: number;
    unknownSalesGross: number;
    unknownExpenseGross: number;
    unknownSalesCount: number;
    unknownExpenseCount: number;
    bridgeComplete: boolean;
    message: string;
  };
  nextStep: {
    title: string;
    body: string;
    action: 'cash' | 'movements' | null;
    actionLabel: string | null;
  };
  caveat: string;
};

function parseAmount(value: string | number | null | undefined) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || '').replace(/[^0-9.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalize(value: string | undefined | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function expenseCoveredBySummary(expense: FinancialExpense, summary: FinancialHistoricalSummary) {
  if (!summary) return false;
  const covered = typeof summary.expensesCovered === 'boolean'
    ? summary.expensesCovered
    : parseAmount(summary.expensesTotal) > 0;
  return covered && expense.date >= summary.startDate && expense.date <= summary.endDate;
}

function bucketDefinition(key: FinancialBucketKey) {
  if (key === 'purchases') return { label: 'Compras / mercadería', note: 'Presiona caja ahora; una parte puede seguir convertida en stock y no ser pérdida todavía.' };
  if (key === 'payroll') return { label: 'Sueldos', note: 'Costo de trabajo del negocio. Los pagos parciales siguen conciliados contra su obligación completa.' };
  if (key === 'structure') return { label: 'Estructura fija', note: 'Alquiler, servicios profesionales, software y otros costos que existen aunque vendas menos.' };
  if (key === 'taxes') return { label: 'Impuestos y tasas', note: 'Obligaciones fiscales y municipales registradas.' };
  if (key === 'investment') return { label: 'Inversión / equipamiento', note: 'Salida de caja que no conviene confundir automáticamente con costo operativo recurrente.' };
  if (key === 'aggregate') return { label: 'Acumulado sin detalle', note: 'Lebu conoce el total, pero no puede repartirlo por rubro sin movimientos individuales.' };
  return { label: 'Otros gastos', note: 'Movimientos que todavía no encajan con suficiente certeza en otro grupo.' };
}

function classifyExpense(expense: FinancialExpense, recurringName: string) : FinancialBucketKey {
  const haystack = normalize(`${expense.category || ''} ${expense.note || ''} ${recurringName}`);

  if (/sueldo|emplead|personal|jornal|honorario de empleado/.test(haystack)) return 'payroll';
  if (/monotrib|impuesto|seg[ .-]*e[ .-]*hig|seguridad e higiene|tasa|iva|ingresos brutos|arba|afip|arca/.test(haystack)) return 'taxes';
  if (/mobiliario|equipamiento|maquina|máquina|obra|reforma|heladera|horno|molino|cafetera|computadora|mueble/.test(haystack)) return 'investment';
  if (/compra|proveedor|mercader|insumo|materia prima|pan|laminado|cafe|café|leche|harina|manteca|fruta|naranja|envase|vaso|bolsa|packaging/.test(haystack)) return 'purchases';
  if (/alquiler|contador|software|internet|luz|gas|agua|servicio|mantenimiento|limpieza|seguro|telefono|teléfono/.test(haystack)) return 'structure';
  return 'other';
}

function paceStatus(sales: number, expected: number): { status: FinancialPaceStatus; pct: number | null; delta: number } {
  const delta = sales - expected;
  if (expected <= 0) return { status: 'learning', pct: null, delta };
  const pct = delta / expected;
  if (pct >= 0.1) return { status: 'ahead', pct, delta };
  if (pct >= -0.08) return { status: 'on-track', pct, delta };
  return { status: 'behind', pct, delta };
}

export function buildFinancialDiagnosis({
  today,
  period,
  salesToDate,
  expectedSalesByToday,
  economicExpenses,
  economicResult,
  recurringExpected,
  expenses,
  recurringCosts,
  historicalSummary,
  cashGuidance,
}: {
  today: string;
  period: { start: string; end: string };
  salesToDate: number;
  expectedSalesByToday: number;
  economicExpenses: number;
  economicResult: number;
  recurringExpected: number;
  expenses: FinancialExpense[];
  recurringCosts: FinancialRecurringCost[];
  historicalSummary: FinancialHistoricalSummary;
  cashGuidance: CashGuidance;
}): FinancialDiagnosis {
  const recurringNames = new Map(recurringCosts.map((item) => [Number(item.id), item.name || '']));
  const detail = expenses.filter((expense) => (
    expense.date >= period.start
    && expense.date <= today
    && !expenseCoveredBySummary(expense, historicalSummary)
  ));

  const bucketAccumulator = new Map<FinancialBucketKey, { amount: number; movements: number }>();
  for (const expense of detail) {
    const amount = Math.max(parseAmount(expense.amount), 0);
    if (!amount) continue;
    const recurringName = expense.recurringCostId ? recurringNames.get(Number(expense.recurringCostId)) || '' : '';
    const key = classifyExpense(expense, recurringName);
    const current = bucketAccumulator.get(key) || { amount: 0, movements: 0 };
    current.amount += amount;
    current.movements += 1;
    bucketAccumulator.set(key, current);
  }

  const summaryCovered = Boolean(historicalSummary && (typeof historicalSummary.expensesCovered === 'boolean'
    ? historicalSummary.expensesCovered
    : parseAmount(historicalSummary.expensesTotal) > 0));
  const summaryInsidePeriod = Boolean(historicalSummary && historicalSummary.startDate >= period.start && historicalSummary.endDate <= period.end);
  const aggregateAmount = summaryCovered && summaryInsidePeriod && historicalSummary
    ? Math.max(parseAmount(historicalSummary.expensesTotal), 0)
    : 0;
  if (aggregateAmount > 0) bucketAccumulator.set('aggregate', { amount: aggregateAmount, movements: 1 });

  const recordedExpenses = [...bucketAccumulator.values()].reduce((sum, item) => sum + item.amount, 0);
  const buckets = [...bucketAccumulator.entries()]
    .map(([key, value]): FinancialBucket => {
      const definition = bucketDefinition(key);
      return {
        key,
        label: definition.label,
        amount: value.amount,
        movements: value.movements,
        shareOfExpenses: recordedExpenses > 0 ? value.amount / recordedExpenses : 0,
        shareOfSales: salesToDate > 0 ? value.amount / salesToDate : 0,
        note: definition.note,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const topPressure = buckets.find((item) => item.key !== 'aggregate') || buckets[0] || null;
  const pace = paceStatus(salesToDate, expectedSalesByToday);
  const recordedBalance = salesToDate - recordedExpenses;
  const recordedExpenseRatio = salesToDate > 0 ? recordedExpenses / salesToDate : 0;

  const bridgeComplete = cashGuidance.hasCashSnapshot
    && cashGuidance.confidence === 'high'
    && cashGuidance.untrackedSalesCount === 0
    && cashGuidance.untrackedExpenseCount === 0;

  let cashMessage = 'Confirmá cuánto dinero hay realmente disponible para que Lebu pueda seguir el puente entre resultado y caja.';
  if (cashGuidance.hasCashSnapshot) {
    if (bridgeComplete) {
      cashMessage = `Desde la última confirmación Lebu conoce ${cashGuidance.knownInflows > 0 ? 'ingresos' : 'los movimientos'} netos y puede estimar la caja con confianza alta.`;
    } else {
      const age = cashGuidance.daysSinceConfirmation === null
        ? ''
        : cashGuidance.daysSinceConfirmation === 0
          ? 'La caja fue confirmada hoy, pero '
          : `La caja fue confirmada hace ${cashGuidance.daysSinceConfirmation} día${cashGuidance.daysSinceConfirmation === 1 ? '' : 's'} y `;
      const unknownParts: string[] = [];
      if (cashGuidance.untrackedSalesGross > 0) unknownParts.push(`${Math.round(cashGuidance.untrackedSalesGross).toLocaleString('es-AR')} de ventas sin neto de caja conocido`);
      if (cashGuidance.untrackedExpenseGross > 0) unknownParts.push(`${Math.round(cashGuidance.untrackedExpenseGross).toLocaleString('es-AR')} de gastos sin impacto de caja confirmado`);
      cashMessage = `${age}${unknownParts.length ? `hay ${unknownParts.join(' y ')}.` : 'todavía hay movimientos sin trazabilidad suficiente para cerrar el puente.'}`;
    }
  }

  let headline = 'Lebu todavía está armando el mapa del dinero';
  let body = 'Ya puedo separar ventas, gastos registrados y compromisos, pero necesito más movimientos para señalar una presión dominante sin adivinar.';
  let tone: FinancialDiagnosisTone = 'neutral';

  const salesPaceHealthy = pace.status === 'on-track' || pace.status === 'ahead';
  if (salesPaceHealthy && recordedExpenseRatio > 1.05) {
    tone = 'attention';
    headline = 'El problema no parece ser solo vender más';
    body = `Vas ${pace.status === 'ahead' ? 'por encima' : 'cerca'} del ritmo de ventas esperado, pero los gastos registrados hasta hoy superan a las ventas en ${Math.abs(recordedBalance).toLocaleString('es-AR', { maximumFractionDigits: 0 })}. La presión está entre costos, timing de pagos y caja.`;
  } else if (pace.status === 'behind' && recordedExpenseRatio > 0.8) {
    tone = 'attention';
    headline = 'Se están combinando dos presiones';
    body = 'El ritmo de ventas está por debajo de la referencia y, al mismo tiempo, los gastos registrados absorben una parte alta de lo vendido. Lebu no debería resolverlo con una sola recomendación comercial.';
  } else if (topPressure && topPressure.shareOfSales >= 0.35) {
    tone = 'attention';
    headline = `${topPressure.label} está presionando fuerte la caja`;
    body = `Ese grupo equivale aproximadamente al ${Math.round(topPressure.shareOfSales * 100)}% de lo vendido hasta hoy. Eso no significa automáticamente pérdida: en compras puede haber stock y en inversión puede haber activos.`;
  } else if (salesPaceHealthy && recordedBalance >= 0 && bridgeComplete) {
    tone = 'positive';
    headline = 'El negocio está convirtiendo mejor las ventas en caja';
    body = 'El ritmo de ventas está sano, los gastos registrados no superan lo vendido y Lebu tiene suficiente trazabilidad de caja para seguir buscando desvíos más pequeños.';
  } else if (!bridgeComplete && cashGuidance.hasCashSnapshot) {
    tone = 'attention';
    headline = 'Hay una parte de la caja que Lebu todavía no puede explicar';
    body = 'Las ventas y los gastos económicos se pueden analizar, pero faltan netos/acreditaciones o una conciliación reciente para saber con precisión dónde quedó cada peso.';
  }

  let nextStep: FinancialDiagnosis['nextStep'] = {
    title: 'Seguí cargando movimientos normalmente',
    body: 'Lebu va a recalcular qué rubro absorbe más dinero a medida que entra información real.',
    action: null,
    actionLabel: null,
  };

  if (!cashGuidance.hasCashSnapshot || cashGuidance.confidence === 'low') {
    nextStep = {
      title: 'Primero cerrá el puente de caja',
      body: 'Confirmá cuánto dinero tenés disponible ahora. Eso no cambia la ganancia ni el objetivo: solo le da a Lebu un punto real desde el cual explicar entradas y salidas.',
      action: 'cash',
      actionLabel: 'Actualizar caja',
    };
  } else if (topPressure?.key === 'purchases') {
    nextStep = {
      title: 'Separá compra de pérdida',
      body: 'Compras/mercadería está pesando fuerte. El siguiente nivel será distinguir cuánto ya se consumió/vendió y cuánto sigue siendo stock para no confundir una compra grande con margen perdido.',
      action: 'movements',
      actionLabel: 'Revisar movimientos',
    };
  } else if (topPressure) {
    nextStep = {
      title: `Revisá ${topPressure.label.toLowerCase()}`,
      body: topPressure.note,
      action: 'movements',
      actionLabel: 'Ver movimientos',
    };
  }

  return {
    available: salesToDate > 0 || recordedExpenses > 0 || economicExpenses > 0,
    headline,
    body,
    tone,
    salesToDate,
    expectedSalesByToday,
    salesPaceDelta: pace.delta,
    salesPacePct: pace.pct,
    paceStatus: pace.status,
    recordedExpenses,
    recordedBalance,
    economicExpenses,
    economicResult,
    recurringExpected,
    buckets,
    topPressure,
    cash: {
      hasSnapshot: cashGuidance.hasCashSnapshot,
      confidence: cashGuidance.confidence,
      confirmed: cashGuidance.confirmedCash,
      estimated: cashGuidance.estimatedCash,
      daysSinceConfirmation: cashGuidance.daysSinceConfirmation,
      knownInflows: cashGuidance.knownInflows,
      knownOutflows: cashGuidance.knownOutflows,
      unknownSalesGross: cashGuidance.untrackedSalesGross,
      unknownExpenseGross: cashGuidance.untrackedExpenseGross,
      unknownSalesCount: cashGuidance.untrackedSalesCount,
      unknownExpenseCount: cashGuidance.untrackedExpenseCount,
      bridgeComplete,
      message: cashMessage,
    },
    nextStep,
    caveat: '“Gasto registrado” muestra dinero imputado al período. La agrupación usa tus categorías, notas y recurrentes; no infiere que todo sea costo variable. Compras pueden quedar en stock, inversiones pueden generar valor futuro y los pagos pueden corresponder a obligaciones de otro momento.',
  };
}
