'use client';

import Image from 'next/image';
import {
  ArrowUpRight,
  CalendarRange,
  ChevronRight,
  Eye,
  Gauge,
  Lightbulb,
  Store,
  WalletCards,
  PackageSearch,
  Repeat2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wheat,
} from 'lucide-react';
import type {
  AdjustmentSuggestion,
  ComparisonMetric,
  MiradaAnalysis,
  MiradaAnalysisWindowKind,
  MiradaObservation,
  MiradaTone,
  PacePoint,
  TemporalPattern,
} from './mirada';
import type { CommercialConfidence, CommercialOpportunity, CommercialOpportunityAnalysis } from './commercial-opportunities';
import type { FinancialDiagnosis, FinancialPaceStatus } from './financial-diagnosis';
import type { ProductionAnalysis } from './production';

const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

function fromISO(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatRange(start: string, end: string) {
  const startDate = fromISO(start);
  const endDate = fromISO(end);
  if (start === end) return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(startDate);
  const sameMonth = startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear();
  const startLabel = new Intl.DateTimeFormat('es-AR', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' }).format(startDate);
  const endLabel = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(endDate);
  return `${startLabel}–${endLabel}`;
}

function observationIcon(observation: MiradaObservation) {
  if (observation.tone === 'positive') return <TrendingUp size={19} />;
  if (observation.tone === 'attention') return <TrendingDown size={19} />;
  return <Sparkles size={19} />;
}

function toneClass(tone: MiradaTone) {
  return tone === 'attention' ? 'mirada-tone-attention' : tone === 'positive' ? 'mirada-tone-positive' : 'mirada-tone-neutral';
}

function deltaText(metric: ComparisonMetric) {
  if (!metric.comparable) return 'Sin comparación confiable';
  if (metric.deltaPct === null) {
    if (metric.previous === 0 && metric.current === 0) return 'Sin movimientos en ambos tramos';
    if (metric.previous === 0) return 'No había base en el período anterior';
    return 'Sin variación porcentual';
  }
  const pct = Math.round(Math.abs(metric.deltaPct) * 100);
  return `${metric.delta >= 0 ? '↑' : '↓'} ${pct}% vs. tramo anterior`;
}

function metricTone(metric: ComparisonMetric) {
  if (!metric.comparable || metric.delta === 0) return 'neutral';
  if (metric.key === 'expenses') return metric.delta < 0 ? 'positive' : 'attention';
  return metric.delta > 0 ? 'positive' : 'attention';
}

function metricExplanation(metric: ComparisonMetric) {
  if (!metric.comparable) return 'Todavía no hay detalle suficiente para comparar este dato sin adivinar.';
  if (metric.delta === 0) return 'Está prácticamente igual que en el mismo tramo anterior.';
  const absolute = money.format(Math.abs(metric.delta));
  if (metric.key === 'sales') return `Vendiste ${absolute} ${metric.delta > 0 ? 'más' : 'menos'} en el mismo tramo.`;
  if (metric.key === 'expenses') return `Registraste ${absolute} ${metric.delta > 0 ? 'más' : 'menos'} de gastos en el mismo tramo.`;
  if (metric.key === 'rhythm') return `Por cada día abierto vendiste ${absolute} ${metric.delta > 0 ? 'más' : 'menos'} que en el tramo anterior.`;
  return `El resultado estimado está ${absolute} ${metric.delta > 0 ? 'arriba' : 'abajo'} del mismo tramo anterior.`;
}

function ComparisonMetricCard({ metric }: { metric: ComparisonMetric }) {
  const tone = metricTone(metric);
  return (
    <div className={`mirada-comparison-metric mirada-comparison-${tone}`}>
      <div className="mirada-comparison-topline">
        <span>{metric.label}</span>
        <small>{deltaText(metric)}</small>
      </div>
      <strong>{metric.comparable ? money.format(metric.current) : 'Aprendiendo'}</strong>
      <p>{metricExplanation(metric)}</p>
    </div>
  );
}

function buildPolyline(points: PacePoint[], key: 'actualCumulative' | 'expectedCumulative', maxValue: number) {
  if (!points.length) return '';
  const width = 100;
  const height = 42;
  const xFor = (index: number) => points.length <= 1 ? width / 2 : (index / (points.length - 1)) * width;
  const yFor = (value: number) => height - Math.min(Math.max(value / maxValue, 0), 1) * (height - 4) - 2;
  return points.map((point, index) => `${xFor(index).toFixed(2)},${yFor(point[key]).toFixed(2)}`).join(' ');
}

function PaceChart({ analysis }: { analysis: MiradaAnalysis }) {
  const { pace } = analysis;
  const maxValue = Math.max(
    ...pace.points.map((point) => Math.max(point.actualCumulative, point.expectedCumulative)),
    pace.actualToDate,
    pace.expectedToDate,
    1,
  );
  const actualPoints = buildPolyline(pace.points, 'actualCumulative', maxValue);
  const expectedPoints = buildPolyline(pace.points, 'expectedCumulative', maxValue);
  const ahead = pace.paceDelta >= 0;

  return (
    <section className="mirada-section-card mirada-pace-card">
      <div className="mirada-section-heading">
        <div className="mirada-section-icon"><Gauge size={18} /></div>
        <div>
          <div className="eyebrow">TU RITMO ACTUAL</div>
          <h2>¿Vas por encima o por debajo de lo que necesitabas?</h2>
        </div>
      </div>

      {!pace.available ? (
        <div className="mirada-learning-state mt-4">
          <strong>Todavía estoy construyendo tu ritmo.</strong>
          <p>Cuando haya un objetivo y algún día abierto transcurrido, Lebu va a mostrarte la distancia entre lo real y lo esperado.</p>
        </div>
      ) : (
        <>
          {pace.points.length >= 2 ? (
            <div className="mirada-pace-chart mt-4" role="img" aria-label="Ventas acumuladas comparadas con el ritmo esperado">
              <svg viewBox="0 0 100 42" preserveAspectRatio="none">
                <polyline className="mirada-pace-expected" points={expectedPoints} vectorEffect="non-scaling-stroke" />
                <polyline className="mirada-pace-actual" points={actualPoints} vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="mirada-pace-legend">
                <span><i className="mirada-legend-actual" /> Ventas reales</span>
                <span><i className="mirada-legend-expected" /> Ritmo esperado</span>
              </div>
            </div>
          ) : (
            <div className="mirada-learning-state mt-4">
              <strong>Ya tengo el número de hoy.</strong>
              <p>Necesito un poco más de recorrido con movimientos fechados para dibujar una evolución que tenga sentido.</p>
            </div>
          )}

          <div className={`mirada-pace-summary mt-4 ${ahead ? 'mirada-pace-ahead' : 'mirada-pace-behind'}`}>
            <div>
              <span>Ventas en días cerrados</span>
              <strong>{money.format(pace.actualToDate)}</strong>
            </div>
            <div>
              <span>Ritmo esperado en esos días</span>
              <strong>{money.format(pace.expectedToDate)}</strong>
            </div>
          </div>
          <p className="mirada-pace-copy mt-3">
            {ahead
              ? <>En los días ya cerrados venís <strong>{money.format(Math.abs(pace.paceDelta))} por delante</strong> del ritmo esperado.</>
              : <>En los días ya cerrados venís <strong>{money.format(Math.abs(pace.paceDelta))} por debajo</strong>. Con los días que quedan, todavía podés recuperar terreno.</>}
          </p>
        </>
      )}

      {pace.hasAggregateGap && pace.aggregateRange && (
        <div className="mirada-data-note mt-3">
          Tu progreso inicial de <strong>{formatRange(pace.aggregateRange.start, pace.aggregateRange.end)}</strong> cuenta para el total. El gráfico no inventa cómo se repartió dentro de esos días: empieza a aprender la curva con movimientos fechados.
        </div>
      )}
    </section>
  );
}

function confidenceLabel(pattern: TemporalPattern) {
  if (pattern.confidence === 'high') return 'Confianza alta';
  if (pattern.confidence === 'medium') return 'Confianza media';
  if (pattern.confidence === 'early') return 'Patrón temprano';
  return 'Aprendiendo';
}

function TemporalPatternCard({ title, pattern }: { title: string; pattern: TemporalPattern }) {
  return (
    <div className="mirada-temporal-pattern-card">
      <div className="mirada-temporal-pattern-heading">
        <span>{title}</span>
        <small>{confidenceLabel(pattern)}</small>
      </div>
      {!pattern.available || !pattern.strongest || !pattern.quietest ? (
        <p>{pattern.learningMessage}</p>
      ) : (
        <>
          <strong>{pattern.strongest.label} viene siendo el tramo más fuerte</strong>
          <p>
            Promedia {money.format(pattern.strongest.averagePerObservedDay)} por día con ventas registradas,
            frente a {money.format(pattern.quietest.averagePerObservedDay)} en {pattern.quietest.label.toLowerCase()}.
          </p>
          <small className="mirada-temporal-sample">{pattern.sampleMonths} meses con evidencia · diferencia aproximada {Math.round(pattern.differencePct * 100)}%</small>
        </>
      )}
    </div>
  );
}

function commercialConfidenceLabel(confidence: CommercialConfidence) {
  if (confidence === 'high') return 'Confianza alta';
  if (confidence === 'medium') return 'Confianza media';
  if (confidence === 'early') return 'Señal temprana';
  return 'Aprendiendo';
}

function CommercialOpportunityCard({ opportunity }: { opportunity: CommercialOpportunity }) {
  return (
    <article className={`mirada-opportunity-card mirada-opportunity-${opportunity.tone}`}>
      <div className="mirada-opportunity-topline">
        <span>{opportunity.label}</span>
        <small>{commercialConfidenceLabel(opportunity.confidence)}</small>
      </div>
      <h3>{opportunity.title}</h3>
      <p>{opportunity.body}</p>
      <div className="mirada-opportunity-evidence">{opportunity.evidence}</div>
    </article>
  );
}

function CommercialCapabilities({ analysis }: { analysis: CommercialOpportunityAnalysis }) {
  const rows = [
    { label: 'Días', active: analysis.capabilities.daily },
    { label: 'Operaciones', active: analysis.capabilities.transactions },
    { label: 'Horarios', active: analysis.capabilities.hourly },
    { label: 'Productos', active: analysis.capabilities.products },
  ];
  return (
    <div className="mirada-commercial-capabilities">
      <div className="mirada-commercial-capability-copy">
        <strong>Qué puede leer Lebu hoy</strong>
        <p>Solo aparecen recomendaciones cuando hay evidencia suficiente. Horarios y productos se activan cuando la fuente entrega ese nivel de detalle.</p>
      </div>
      <div className="mirada-commercial-capability-chips" aria-label="Detalle comercial disponible">
        {rows.map((row) => <span key={row.label} className={row.active ? 'is-active' : ''}>{row.label}{row.active ? ' ✓' : ''}</span>)}
      </div>
    </div>
  );
}

function financialPaceLabel(status: FinancialPaceStatus) {
  if (status === 'ahead') return 'Por encima del ritmo';
  if (status === 'on-track') return 'En ritmo';
  if (status === 'behind') return 'Por debajo del ritmo';
  return 'Aprendiendo';
}

function financialCashConfidenceLabel(confidence: FinancialDiagnosis['cash']['confidence']) {
  if (confidence === 'high') return 'Caja confiable';
  if (confidence === 'medium') return 'Caja parcial';
  return 'Caja por confirmar';
}

function FinancialDiagnosisCard({
  analysis,
  onOpenCash,
  onOpenMovements,
}: {
  analysis: FinancialDiagnosis;
  onOpenCash: () => void;
  onOpenMovements: () => void;
}) {
  const maxBucket = Math.max(...analysis.buckets.map((item) => item.amount), 1);
  const balancePositive = analysis.recordedBalance >= 0;

  function handleAction() {
    if (analysis.nextStep.action === 'cash') onOpenCash();
    if (analysis.nextStep.action === 'movements') onOpenMovements();
  }

  return (
    <section className="mirada-section-card mirada-financial-section mt-4">
      <div className="mirada-section-heading">
        <div className="mirada-section-icon"><WalletCards size={18} /></div>
        <div>
          <div className="eyebrow">RENTABILIDAD Y CAJA</div>
          <h2>¿Dónde se está yendo la plata?</h2>
          <p>Lebu separa ritmo de ventas, gastos registrados y caja para no confundir facturación con dinero realmente disponible.</p>
        </div>
      </div>

      {!analysis.available ? (
        <div className="mirada-learning-state mt-4">
          <strong>Todavía falta movimiento para armar el mapa.</strong>
          <p>Cuando haya ventas o gastos del período, Lebu va a empezar a explicar qué está absorbiendo la caja.</p>
        </div>
      ) : (
        <>
          <div className={`mirada-financial-headline mt-4 mirada-financial-${analysis.tone}`}>
            <div className="mirada-financial-headline-icon"><PackageSearch size={19} /></div>
            <div>
              <span>{financialPaceLabel(analysis.paceStatus)}</span>
              <strong>{analysis.headline}</strong>
              <p>{analysis.body}</p>
            </div>
          </div>

          <div className="mirada-financial-summary mt-4">
            <div>
              <span>Ventas hasta hoy</span>
              <strong>{money.format(analysis.salesToDate)}</strong>
              {analysis.expectedSalesByToday > 0 && <small>Referencia a hoy {money.format(analysis.expectedSalesByToday)}</small>}
            </div>
            <div>
              <span>Gastos registrados</span>
              <strong>{money.format(analysis.recordedExpenses)}</strong>
              <small>Movimientos de gasto imputados hasta hoy</small>
            </div>
            <div>
              <span>Diferencia registrada</span>
              <strong className={balancePositive ? 'is-positive' : 'is-negative'}>{balancePositive ? '+' : '-'}{money.format(Math.abs(analysis.recordedBalance))}</strong>
              <small>{balancePositive ? 'Ventas menos gastos registrados' : 'Los gastos registrados superan lo vendido'}</small>
            </div>
          </div>

          <div className="mirada-financial-grid mt-4">
            <div className="mirada-financial-panel">
              <div className="mirada-financial-panel-heading">
                <div>
                  <span>MAPA DE GASTOS</span>
                  <strong>Qué concentra los gastos registrados</strong>
                </div>
                <small>{analysis.buckets.length} grupo{analysis.buckets.length === 1 ? '' : 's'}</small>
              </div>
              {analysis.buckets.length === 0 ? (
                <p className="mirada-financial-empty">Todavía no hay gastos detallados para repartir por rubro.</p>
              ) : (
                <div className="mirada-financial-buckets">
                  {analysis.buckets.slice(0, 6).map((bucket) => (
                    <div className="mirada-financial-bucket" key={bucket.key}>
                      <div className="mirada-financial-bucket-top">
                        <span>{bucket.label}</span>
                        <strong>{money.format(bucket.amount)}</strong>
                      </div>
                      <div className="mirada-financial-bar"><i style={{ width: `${Math.max((bucket.amount / maxBucket) * 100, 3)}%` }} /></div>
                      <small>{Math.round(bucket.shareOfExpenses * 100)}% de los gastos registrados{bucket.shareOfSales > 0 ? ` · ${Math.round(bucket.shareOfSales * 100)}% de lo vendido` : ''}</small>
                    </div>
                  ))}
                </div>
              )}
              {analysis.topPressure && <div className="mirada-financial-pressure-note"><strong>{analysis.topPressure.label}</strong><span>{analysis.topPressure.note}</span></div>}
            </div>

            <div className="mirada-financial-panel mirada-financial-cash-panel">
              <div className="mirada-financial-panel-heading">
                <div>
                  <span>PUENTE A CAJA</span>
                  <strong>{financialCashConfidenceLabel(analysis.cash.confidence)}</strong>
                </div>
                {analysis.cash.hasSnapshot && <small>{analysis.cash.daysSinceConfirmation === 0 ? 'Confirmada hoy' : `Hace ${analysis.cash.daysSinceConfirmation ?? '?'} días`}</small>}
              </div>

              {analysis.cash.hasSnapshot ? (
                <div className="mirada-financial-cash-values">
                  <div><span>Última caja confirmada</span><strong>{money.format(analysis.cash.confirmed)}</strong></div>
                  <div><span>Estimación con netos conocidos</span><strong>{money.format(analysis.cash.estimated)}</strong></div>
                </div>
              ) : (
                <div className="mirada-financial-cash-missing"><strong>Falta un punto de partida real.</strong><span>Confirmar caja no cambia tu ganancia ni tu objetivo.</span></div>
              )}

              <p className="mirada-financial-cash-message">{analysis.cash.message}</p>
              {(analysis.cash.unknownSalesGross > 0 || analysis.cash.unknownExpenseGross > 0) && (
                <div className="mirada-financial-unknowns">
                  {analysis.cash.unknownSalesGross > 0 && <div><span>Ventas sin neto conocido</span><strong>{money.format(analysis.cash.unknownSalesGross)}</strong></div>}
                  {analysis.cash.unknownExpenseGross > 0 && <div><span>Gastos sin impacto confirmado</span><strong>{money.format(analysis.cash.unknownExpenseGross)}</strong></div>}
                </div>
              )}

              <div className="mirada-financial-commitment-note">
                <span>Costos económicos contemplados en el período</span>
                <strong>{money.format(analysis.economicExpenses)}</strong>
                <small>Incluye {money.format(analysis.recurringExpected)} de recurrentes previstos. No significa que todo ya haya salido de caja.</small>
              </div>
            </div>
          </div>

          <div className="mirada-financial-next mt-4">
            <div>
              <div className="eyebrow">QUÉ HARÍA LEBU AHORA</div>
              <strong>{analysis.nextStep.title}</strong>
              <p>{analysis.nextStep.body}</p>
            </div>
            {analysis.nextStep.action && analysis.nextStep.actionLabel && (
              <button type="button" className="mirada-inline-action" onClick={handleAction}>{analysis.nextStep.actionLabel} <ChevronRight size={15} /></button>
            )}
          </div>

          <div className="mirada-financial-caveat">{analysis.caveat}</div>
        </>
      )}
    </section>
  );
}

function ProductionGuidanceCard({ analysis, onOpenProduction }: { analysis: ProductionAnalysis; onOpenProduction: () => void }) {
  const main = analysis.insights[0];
  return (
    <section className="mirada-section-card mirada-production-section mt-4">
      <div className="mirada-section-heading">
        <div className="mirada-section-icon"><Wheat size={18} /></div>
        <div>
          <div className="eyebrow">PRODUCCIÓN Y MERMA</div>
          <h2>Qué conviene tener y qué conviene reducir</h2>
          <p>Lebu cruza disponibilidad, tandas, ventas por producto y cierre para buscar menos merma sin quedarte corto.</p>
        </div>
      </div>

      {!analysis.available ? (
        <div className="mirada-learning-state mt-4">
          <strong>Todavía no estás siguiendo productos en Producción.</strong>
          <p>Empezá por los productos frescos que más te importa no tirar. No hace falta cargar todo el catálogo.</p>
          <button type="button" className="mirada-inline-action mt-3" onClick={onOpenProduction}>Configurar Producción <ChevronRight size={15} /></button>
        </div>
      ) : analysis.insights.length === 0 ? (
        <div className="mirada-learning-state mt-4">
          <strong>{analysis.productSalesDetailAvailable ? 'Lebu ya está aprendiendo.' : 'Falta detalle de ventas por producto.'}</strong>
          <p>{analysis.learningMessage}</p>
          <button type="button" className="mirada-inline-action mt-3" onClick={onOpenProduction}>Ir a Producción <ChevronRight size={15} /></button>
        </div>
      ) : (
        <>
          <div className={`mirada-production-headline mt-4 mirada-production-${main.tone}`}>
            <Sparkles size={18} />
            <div><span>LEBU VIO ESTO</span><strong>{main.title}</strong><p>{main.body}</p></div>
          </div>
          <div className="mirada-production-grid mt-4">
            {analysis.insights.slice(0, 3).map((insight) => (
              <article key={insight.id} className={`mirada-production-insight mirada-production-${insight.tone}`}>
                <div className="mirada-production-insight-top"><span>{insight.productName}</span><small>{insight.sampleDays} cierres</small></div>
                <strong>{insight.kind === 'reduce' ? 'Reducir' : insight.kind === 'increase' ? 'Subir disponibilidad' : 'Mantener'}</strong>
                <p>{insight.evidence}</p>
              </article>
            ))}
          </div>
          <div className="mirada-production-foot mt-4">
            <div>
              <span>Merma observada</span>
              <strong>{Math.round(analysis.totalWasteUnits)} u.{analysis.totalWasteCost > 0 ? ` · ${money.format(analysis.totalWasteCost)}` : ''}</strong>
              <small>Solo en jornadas cerradas dentro de la ventana de aprendizaje.</small>
            </div>
            <button type="button" className="mirada-inline-action" onClick={onOpenProduction}>Ver Producción <ChevronRight size={15} /></button>
          </div>
        </>
      )}
    </section>
  );
}

function CommercialOpportunitiesCard({ analysis }: { analysis: CommercialOpportunityAnalysis }) {
  return (
    <section className="mirada-section-card mirada-commercial-section mt-4">
      <div className="mirada-section-heading">
        <div className="mirada-section-icon"><Store size={18} /></div>
        <div>
          <div className="eyebrow">OPORTUNIDADES</div>
          <h2>Qué puede ayudarte a vender mejor</h2>
          <p>Lebu cruza tu objetivo con la forma en que realmente se mueve el negocio. No busca llenar un tablero: busca una palanca concreta.</p>
        </div>
      </div>

      {!analysis.available || analysis.opportunities.length === 0 ? (
        <div className="mirada-learning-state mt-4">
          <strong>Todavía estoy aprendiendo dónde está la oportunidad.</strong>
          <p>{analysis.learningMessage || 'Ya puedo mirar el ritmo general, pero todavía no hay una diferencia suficientemente clara como para recomendar una acción comercial.'}</p>
        </div>
      ) : (
        <div className="mirada-opportunity-grid mt-4">
          {analysis.opportunities.map((opportunity) => <CommercialOpportunityCard key={opportunity.id} opportunity={opportunity} />)}
        </div>
      )}

      {analysis.transactionSignal.available && analysis.transactionSignal.averageTicket > 0 && (
        <div className="mirada-commercial-summary mt-4">
          <div>
            <span>Ticket estimado reciente</span>
            <strong>{money.format(analysis.transactionSignal.averageTicket)}</strong>
          </div>
          <div>
            <span>Promedio por día observado</span>
            <strong>{money.format(analysis.recentDailyAverage)}</strong>
          </div>
          <div>
            <span>Días observados</span>
            <strong>{analysis.observedDays}</strong>
          </div>
        </div>
      )}

      <CommercialCapabilities analysis={analysis} />
    </section>
  );
}

function PatternCard({ analysis }: { analysis: MiradaAnalysis }) {
  const { patterns } = analysis;
  const maxAverage = Math.max(...patterns.stats.map((item) => item.average), 1);
  return (
    <section className="mirada-section-card">
      <div className="mirada-section-heading">
        <div className="mirada-section-icon"><CalendarRange size={18} /></div>
        <div>
          <div className="eyebrow">PATRONES</div>
          <h2>Lo que empieza a repetirse</h2>
        </div>
      </div>

      <div className="mirada-temporal-pattern-grid mt-4">
        <TemporalPatternCard title="Semanas del mes" pattern={patterns.weeks} />
        <TemporalPatternCard title="Quincenas" pattern={patterns.fortnights} />
      </div>

      {!patterns.available || !patterns.strongest || !patterns.quietest ? (
        <div className="mirada-learning-state mt-4">
          <strong>Todavía estoy aprendiendo tus días.</strong>
          <p>{patterns.learningMessage}</p>
        </div>
      ) : (
        <>
          <div className="mirada-pattern-summary mt-4">
            <div>
              <span>Día que viene más fuerte</span>
              <strong>{patterns.strongest.label}</strong>
              <small>Promedio {money.format(patterns.strongest.average)} · {patterns.strongest.samples} días observados</small>
            </div>
            <div>
              <span>Día más tranquilo</span>
              <strong>{patterns.quietest.label}</strong>
              <small>Promedio {money.format(patterns.quietest.average)} · {patterns.quietest.samples} días observados</small>
            </div>
          </div>
          <div className="mirada-weekday-bars mt-4">
            {patterns.stats.filter((item) => item.samples > 0).map((item) => (
              <div className="mirada-weekday-row" key={item.weekday}>
                <span>{item.label.slice(0, 3)}</span>
                <div className="mirada-weekday-track"><i style={{ width: `${Math.max((item.average / maxAverage) * 100, 4)}%` }} /></div>
                <strong>{money.format(item.average)}</strong>
              </div>
            ))}
          </div>
          <p className="mirada-pattern-copy mt-3">
            {patterns.strongestVsAveragePct >= 0.1
              ? <><strong>{patterns.strongest.label}</strong> promedia alrededor de {Math.round(patterns.strongestVsAveragePct * 100)}% más que tu promedio entre los días con evidencia suficiente.</>
              : <>Hay diferencias entre días, pero todavía son suaves. Lebu va a seguir mirando antes de sugerir cambios.</>}
          </p>
        </>
      )}
    </section>
  );
}

function AdjustmentCard({ suggestion, onAction }: { suggestion: AdjustmentSuggestion; onAction: (action: NonNullable<AdjustmentSuggestion['action']>) => void }) {
  return (
    <section className={`mirada-adjustment-card ${toneClass(suggestion.tone)}`}>
      <div className="mirada-adjustment-icon"><Lightbulb size={19} /></div>
      <div className="min-w-0 flex-1">
        <div className="eyebrow">QUÉ PODRÍAS AJUSTAR</div>
        <h2>{suggestion.title}</h2>
        <p>{suggestion.body}</p>
        {suggestion.action && suggestion.actionLabel && (
          <button type="button" className="mirada-inline-action" onClick={() => onAction(suggestion.action!)}>
            {suggestion.actionLabel} <ChevronRight size={15} />
          </button>
        )}
      </div>
    </section>
  );
}

type MiradaViewProps = {
  analysis: MiradaAnalysis;
  theme: 'light' | 'dark';
  analysisWindow: MiradaAnalysisWindowKind;
  onAnalysisWindowChange: (window: MiradaAnalysisWindowKind) => void;
  onOpenSimulator: () => void;
  onOpenStrategy: () => void;
  onOpenMovements: () => void;
  production: ProductionAnalysis;
  onOpenProduction: () => void;
};

const analysisWindows: { value: MiradaAnalysisWindowKind; label: string }[] = [
  { value: 'auto', label: 'Automático' },
  { value: 'week', label: 'Semana' },
  { value: 'fortnight', label: 'Quincena' },
  { value: 'month', label: 'Mes' },
];

export default function MiradaView({ analysis, theme, analysisWindow, onAnalysisWindowChange, onOpenSimulator, onOpenStrategy, onOpenMovements, production, onOpenProduction }: MiradaViewProps) {
  const { comparison, primary } = analysis;

  function handleAdjustmentAction(action: NonNullable<AdjustmentSuggestion['action']>) {
    if (action === 'simulator') onOpenSimulator();
    if (action === 'strategy') onOpenStrategy();
    if (action === 'movements') onOpenMovements();
  }

  return (
    <div className="mirada-root">
      <section className="mirada-hero">
        <div className="mirada-hero-visual" aria-hidden="true">
          <Image
            key={theme}
            src={theme === 'dark' ? '/mirada-banner-dark.png' : '/mirada-banner-light-v4.png'}
            alt=""
            fill
            priority
            quality={100}
            unoptimized
            sizes="(max-width: 760px) 100vw, 1100px"
            className="mirada-hero-banner"
          />
          <div className="mirada-hero-shade" />
        </div>
        <div className="mirada-hero-copy">
          <div className="eyebrow mirada-eyebrow"><Eye size={14} /> MIRADA</div>
          <h1>Bajo la mirada de Lebu</h1>
          <p>Esto es lo que estoy viendo sobre tu negocio.</p>
          <small>Ventas, gastos, ritmo y patrones explicados de forma simple para que puedas decidir qué ajustar.</small>
          <button type="button" onClick={onOpenSimulator} className="mirada-simulator-button"><Repeat2 size={16} /> Probar un escenario</button>
        </div>
      </section>

      <div className="mirada-top-grid mt-4">
        <section className={`mirada-primary-card ${toneClass(primary.tone)}`}>
          <div className="mirada-primary-icon">{observationIcon(primary)}</div>
          <div className="min-w-0">
            <div className="eyebrow">LEBU VIO ESTO</div>
            <h2>{primary.title}</h2>
            <p>{primary.body}</p>
          </div>
        </section>
        <AdjustmentCard suggestion={analysis.adjustment} onAction={handleAdjustmentAction} />
      </div>

      <section className="mirada-lens-card mt-4">
        <div className="mirada-lens-copy">
          <div className="eyebrow">LENTE DE ANÁLISIS</div>
          <strong>Elegí qué tramo querés entender</strong>
          <p>Esto no cambia tu meta. Solo cambia la comparación que Lebu usa para mirar el negocio.</p>
        </div>
        <div className="mirada-window-picker" role="group" aria-label="Período de análisis">
          {analysisWindows.map((window) => (
            <button
              type="button"
              key={window.value}
              className={analysisWindow === window.value ? 'mirada-window-option mirada-window-option-active' : 'mirada-window-option'}
              onClick={() => onAnalysisWindowChange(window.value)}
            >
              {window.label}
            </button>
          ))}
        </div>
        {comparison.requestedWindow === 'auto' && comparison.autoReason && (
          <div className="mirada-auto-reason"><Sparkles size={14} /> {comparison.autoReason}</div>
        )}
      </section>

      <section className="mirada-section-card mt-4">
        <div className="mirada-section-heading mirada-comparison-heading">
          <div className="mirada-section-icon"><ArrowUpRight size={18} /></div>
          <div className="min-w-0 flex-1">
            <div className="eyebrow">COMPARACIÓN · {comparison.windowLabel.toUpperCase()}</div>
            <h2>¿Cómo viene este tramo frente al anterior?</h2>
            <p>
              {formatRange(comparison.currentComparable.start, comparison.currentComparable.end)} vs. {formatRange(comparison.previousComparable.start, comparison.previousComparable.end)}
              {comparison.currentOpenDays > 0 && comparison.previousOpenDays > 0 && <> · {comparison.currentOpenDays} días abiertos vs. {comparison.previousOpenDays}</>}
            </p>
          </div>
          {comparison.isPartial && <span className="mirada-comparable-chip">Mismo tramo</span>}
        </div>

        {!comparison.available && comparison.unavailableReason ? (
          <div className="mirada-learning-state mt-4">
            <strong>Esta comparación necesita un poco más de detalle.</strong>
            <p>{comparison.unavailableReason}</p>
          </div>
        ) : (
          <div className="mirada-comparison-grid mt-4">
            <ComparisonMetricCard metric={comparison.sales} />
            <ComparisonMetricCard metric={comparison.rhythm} />
            <ComparisonMetricCard metric={comparison.expenses} />
            <ComparisonMetricCard metric={comparison.profit} />
          </div>
        )}
      </section>

      <FinancialDiagnosisCard analysis={analysis.financial} onOpenCash={onOpenStrategy} onOpenMovements={onOpenMovements} />
      <ProductionGuidanceCard analysis={production} onOpenProduction={onOpenProduction} />
      <PaceChart analysis={analysis} />
      <PatternCard analysis={analysis} />
      <CommercialOpportunitiesCard analysis={analysis.commercial} />
    </div>
  );
}
