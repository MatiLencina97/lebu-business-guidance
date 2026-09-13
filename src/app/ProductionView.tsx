'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  PackageCheck,
  PackageOpen,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wheat,
  X,
} from 'lucide-react';
import {
  buildProductionAnalysis,
  buildProductionDayStatus,
  detectedProductNamesFromSales,
  hasProductSalesDetail,
  normalizeProductionName,
  type ProductionDay,
  type ProductionEvent,
  type ProductionProduct,
  type ProductionSaleLike,
  type ProductionShelfLife,
} from './production';
import type { ProductionEventDraft, ProductionProductDraft } from './production-client';

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const qty = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

function todayISO() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatLongDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(year, month - 1, day));
}

function parseQuantity(value: string) {
  const normalized = value.replace(',', '.').replace(/[^0-9.-]/g, '');
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseCost(value: string) {
  const numeric = Number(value.replace(/[^0-9]/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function shelfLifeLabel(value: ProductionShelfLife) {
  if (value === 'carry') return 'Puede pasar a mañana';
  if (value === 'durable') return 'No vence en el día';
  return 'Del día';
}

type Props = {
  businessId: string | null;
  canOperate: boolean;
  products: ProductionProduct[];
  events: ProductionEvent[];
  days: ProductionDay[];
  sales: ProductionSaleLike[];
  loading: boolean;
  error: string;
  onRefresh: () => Promise<void> | void;
  onSaveProduct: (draft: ProductionProductDraft) => Promise<number>;
  onDeactivateProduct: (productId: number) => Promise<void>;
  onStartDay: (date: string, opening: Array<{ productId: number; quantity: number }>) => Promise<void>;
  onAddEvents: (events: ProductionEventDraft[]) => Promise<number[]>;
  onCloseDay: (date: string, closures: Array<{ productId: number; waste: number; carry: number }>) => Promise<void>;
  onReopenDay: (date: string) => Promise<void>;
};

type ProductDraftState = {
  id?: number;
  name: string;
  unitCost: string;
  shelfLife: ProductionShelfLife;
  saleAliases: string[];
};

type QuickActionState = {
  product: ProductionProduct;
  type: 'prep_started' | 'prep_ready' | 'manual_sale' | 'adjustment';
};

function ProductModal({
  draft,
  onChange,
  onClose,
  onSave,
  onDeactivate,
  busy,
}: {
  draft: ProductDraftState;
  onChange: (next: ProductDraftState) => void;
  onClose: () => void;
  onSave: () => void;
  onDeactivate?: () => void;
  busy: boolean;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-sheet production-modal-sheet">
        <div className="production-modal-heading">
          <div>
            <div className="eyebrow">PRODUCTO DE PRODUCCIÓN</div>
            <h2>{draft.id ? 'Editar producto' : 'Agregar producto'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}><X size={19} /></button>
        </div>

        <label className="block mt-5">
          <span className="field-label">Nombre</span>
          <input className="field-input" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="Ej. Medialuna" autoFocus />
        </label>

        <div className="production-form-grid mt-4">
          <label className="block">
            <span className="field-label">Costo por unidad · opcional</span>
            <input className="field-input" inputMode="numeric" value={draft.unitCost} onChange={(event) => onChange({ ...draft, unitCost: event.target.value.replace(/[^0-9]/g, '') })} placeholder="Ej. 800" />
          </label>
          <label className="block">
            <span className="field-label">Vida útil</span>
            <select className="field-input" value={draft.shelfLife} onChange={(event) => onChange({ ...draft, shelfLife: event.target.value as ProductionShelfLife })}>
              <option value="same_day">Se vende en el día</option>
              <option value="carry">Puede pasar a mañana</option>
              <option value="durable">No vence en el día</option>
            </select>
          </label>
        </div>

        {draft.saleAliases.length > 0 && (
          <div className="production-alias-note mt-4">
            <strong>Se vincula con ventas:</strong> {draft.saleAliases.join(', ')}
          </div>
        )}

        <div className="production-modal-actions mt-5">
          {draft.id && onDeactivate && <button type="button" className="secondary-button production-deactivate-button" disabled={busy} onClick={onDeactivate}><Trash2 size={15} /> Dejar de seguir</button>}
          <button type="button" className="primary-button flex-1 justify-center" disabled={busy || !draft.name.trim()} onClick={onSave}>
            {busy ? 'Guardando…' : draft.id ? 'Guardar cambios' : 'Agregar a Producción'}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuantityModal({ action, pending, onClose, onConfirm }: {
  action: QuickActionState;
  pending: number;
  onClose: () => void;
  onConfirm: (value: number) => void;
}) {
  const isAdjustment = action.type === 'adjustment';
  const isManualSale = action.type === 'manual_sale';
  const [value, setValue] = useState(action.type === 'prep_ready' && pending > 0 ? String(pending) : '');
  const numeric = parseQuantity(value);
  const title = action.type === 'prep_started'
    ? 'Agregar a preparación'
    : action.type === 'prep_ready'
      ? 'Marcar como disponible'
      : action.type === 'manual_sale'
        ? 'Registrar o corregir vendido'
        : 'Ajustar disponibilidad';
  const help = action.type === 'prep_started'
    ? 'Todavía no se suma al disponible. Queda como “en preparación” hasta que marques que está listo.'
    : action.type === 'prep_ready'
      ? `Tenés ${qty.format(pending)} en preparación. Al confirmar se suman a lo disponible para vender.`
      : action.type === 'manual_sale'
        ? `Llevás ${qty.format(pending)} unidades registradas manualmente. Sumá lo vendido o usá un valor negativo para corregir. Esto no modifica la facturación.`
        : 'Usá un número positivo para sumar unidades o negativo para corregir hacia abajo.';
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-sheet production-modal-sheet">
        <div className="production-modal-heading">
          <div><div className="eyebrow">{action.product.name.toUpperCase()}</div><h2>{title}</h2></div>
          <button type="button" className="icon-button" onClick={onClose}><X size={19} /></button>
        </div>
        <p className="production-modal-copy mt-3">{help}</p>
        <label className="block mt-5">
          <span className="field-label">Cantidad</span>
          <input className="field-input production-quantity-input" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder={isAdjustment || isManualSale ? 'Ej. -2 o 5' : '0'} autoFocus />
        </label>
        <button type="button" className="primary-button mt-5 w-full justify-center" disabled={!numeric || (action.type === 'prep_ready' && (numeric < 0 || numeric > pending)) || (!isAdjustment && !isManualSale && numeric < 0) || (isManualSale && pending + numeric < 0)} onClick={() => onConfirm(numeric)}>Confirmar</button>
      </div>
    </div>
  );
}

export default function ProductionView(props: Props) {
  const date = todayISO();
  const [productDraft, setProductDraft] = useState<ProductDraftState | null>(null);
  const [openingDraft, setOpeningDraft] = useState<Record<number, string>>({});
  const [quickAction, setQuickAction] = useState<QuickActionState | null>(null);
  const [closingOpen, setClosingOpen] = useState(false);
  const [closingDraft, setClosingDraft] = useState<Record<number, { waste: string; carry: string }>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const day = useMemo(() => props.days.find((item) => item.date === date) || null, [props.days, date]);
  const statuses = useMemo(() => buildProductionDayStatus({ date, products: props.products, events: props.events, sales: props.sales }), [date, props.events, props.products, props.sales]);
  const analysis = useMemo(() => buildProductionAnalysis({ products: props.products, events: props.events, days: props.days, sales: props.sales, today: date }), [date, props.days, props.events, props.products, props.sales]);
  const detectedNames = useMemo(() => {
    const existing = new Set(props.products.flatMap((product) => [product.name, ...product.saleAliases]).map(normalizeProductionName));
    return detectedProductNamesFromSales(props.sales).filter((name) => !existing.has(normalizeProductionName(name))).slice(0, 12);
  }, [props.products, props.sales]);
  const productSalesDetail = analysis.productSalesDetailAvailable;
  const automaticProductSalesDetail = useMemo(() => hasProductSalesDetail(props.sales), [props.sales]);

  useEffect(() => {
    if (!closingOpen) return;
    setClosingDraft(Object.fromEntries(statuses.map((status) => {
      const available = Math.max(status.available, 0);
      if (status.product.shelfLife === 'same_day') return [status.product.id, { waste: available ? String(available) : '', carry: '' }];
      return [status.product.id, { waste: '', carry: available ? String(available) : '' }];
    })));
  }, [closingOpen, statuses]);

  useEffect(() => {
    if (day || props.products.length === 0) return;
    if (Object.values(openingDraft).some((value) => String(value || '').trim())) return;
    const previous = [...props.days]
      .filter((item) => item.closedAt && item.date < date)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!previous) return;
    const previousStatuses = buildProductionDayStatus({ date: previous.date, products: props.products, events: props.events, sales: props.sales });
    const carried = Object.fromEntries(previousStatuses.filter((status) => status.carry > 0).map((status) => [status.product.id, String(status.carry)]));
    if (Object.keys(carried).length) setOpeningDraft(carried);
  }, [day, date, props.days, props.events, props.products, props.sales, openingDraft]);

  function showMessage(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage((current) => current === text ? '' : current), 3200);
  }

  async function run(action: () => Promise<void>, success: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      showMessage(success);
    } catch (cause: any) {
      showMessage(cause?.message || 'No pudimos guardar el cambio.');
    } finally {
      setBusy(false);
    }
  }

  function openNewProduct(prefill?: string) {
    setProductDraft({ name: prefill || '', unitCost: '', shelfLife: 'same_day', saleAliases: prefill ? [prefill] : [] });
  }

  function openEditProduct(product: ProductionProduct) {
    setProductDraft({
      id: product.id,
      name: product.name,
      unitCost: product.unitCost == null ? '' : String(Math.round(product.unitCost)),
      shelfLife: product.shelfLife,
      saleAliases: product.saleAliases,
    });
  }

  async function saveProduct() {
    if (!productDraft) return;
    await run(async () => {
      await props.onSaveProduct({
        id: productDraft.id,
        name: productDraft.name,
        unitCost: productDraft.unitCost ? parseCost(productDraft.unitCost) : null,
        shelfLife: productDraft.shelfLife,
        saleAliases: productDraft.saleAliases,
      });
      setProductDraft(null);
    }, 'Producto guardado.');
  }

  async function startDay() {
    const rows = props.products.map((product) => ({ productId: product.id, quantity: parseQuantity(openingDraft[product.id] || '') })).filter((item) => item.quantity > 0);
    await run(async () => {
      await props.onStartDay(date, rows);
      setOpeningDraft({});
    }, 'Jornada de producción iniciada.');
  }

  async function confirmQuick(value: number) {
    if (!quickAction) return;
    const action = quickAction;
    await run(async () => {
      await props.onAddEvents([{
        productId: action.product.id,
        date,
        type: action.type,
        quantity: value,
        note: action.type === 'prep_started' ? 'Nueva tanda' : action.type === 'prep_ready' ? 'Tanda lista' : action.type === 'manual_sale' ? 'Venta manual de unidades' : 'Ajuste manual',
      }]);
      setQuickAction(null);
    }, action.type === 'prep_started' ? 'Tanda agregada a preparación.' : action.type === 'prep_ready' ? 'Ya figura como disponible.' : action.type === 'manual_sale' ? 'Unidades vendidas registradas.' : 'Disponibilidad ajustada.');
  }

  async function closeToday() {
    const preparing = statuses.filter((status) => status.inPreparation > 0);
    if (preparing.length) {
      showMessage(`Todavía hay productos en preparación (${preparing.map((item) => `${item.product.name}: ${qty.format(item.inPreparation)}`).join(', ')}). Marcálos como listos o ajustalos antes de cerrar.`);
      return;
    }
    const closures = statuses.map((status) => ({
      productId: status.product.id,
      waste: Math.max(parseQuantity(closingDraft[status.product.id]?.waste || ''), 0),
      carry: Math.max(parseQuantity(closingDraft[status.product.id]?.carry || ''), 0),
      available: status.available,
    }));
    const oversold = statuses.find((status) => status.oversold > 0);
    if (oversold) {
      showMessage(`${oversold.product.name} tiene ${qty.format(oversold.oversold)} ventas por encima de la disponibilidad registrada. Ajustá la disponibilidad antes de cerrar.`);
      return;
    }
    const invalid = closures.find((row) => Math.abs((row.waste + row.carry) - row.available) > 0.001);
    if (invalid) {
      showMessage('Para cerrar, cada unidad disponible tiene que quedar como merma o “para mañana”.');
      return;
    }
    await run(async () => {
      await props.onCloseDay(date, closures.map(({ productId, waste, carry }) => ({ productId, waste, carry })));
      setClosingOpen(false);
    }, 'Jornada cerrada. Lebu ya puede aprender de la merma de hoy.');
  }

  if (!props.businessId) {
    return (
      <section className="production-view mx-auto max-w-5xl">
        <div className="production-hero">
          <div><div className="eyebrow"><Wheat size={14} /> PRODUCCIÓN</div><h1>Producí con menos merma.</h1><p>Registrá lo disponible, las nuevas tandas y lo que sobra. Lebu cruza eso con ventas para aprender cuánto conviene tener.</p></div>
        </div>
        <div className="panel-card mt-4 p-6">
          <strong className="text-[var(--ink)]">Producción necesita un negocio sincronizado.</strong>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Estos datos tienen que acompañarte entre dispositivos y formar historial. Ingresá a tu cuenta de Lebu para activarlo.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="production-view mx-auto max-w-5xl">
      <div className="production-hero">
        <div className="production-hero-copy">
          <div className="eyebrow"><Wheat size={14} /> PRODUCCIÓN</div>
          <h1>Lo justo para vender, no para tirar.</h1>
          <p>{formatLongDate(date)} · Lebu separa lo disponible de lo que todavía está en preparación y usa las ventas por producto para estimar lo que queda.</p>
        </div>
        <div className="production-hero-actions">
          <button type="button" className="secondary-button" onClick={() => void props.onRefresh()} disabled={props.loading}><RefreshCw size={16} className={props.loading ? 'production-spin' : ''} /> Actualizar</button>
          {props.canOperate && <button type="button" className="primary-button" onClick={() => openNewProduct()}><Plus size={16} /> Producto</button>}
        </div>
      </div>

      {(message || props.error) && <div className={`production-message mt-4 ${props.error ? 'production-message-error' : ''}`}>{props.error || message}</div>}

      {!automaticProductSalesDetail && props.products.length > 0 && (
        <div className="production-data-note mt-4">
          <AlertTriangle size={18} />
          <div><strong>Todavía no recibo productos dentro de las ventas.</strong><p>Mientras tanto podés tocar “Vendí” para registrar unidades sin duplicar la facturación. Cuando FUDO o una importación traigan ítems, Lebu las descontará automáticamente.</p></div>
        </div>
      )}

      {props.products.length === 0 ? (
        <div className="panel-card mt-4 production-empty-state">
          <PackageOpen size={30} />
          <h2>Elegí qué productos vale la pena seguir.</h2>
          <p>No hace falta cargar todo el catálogo. Empezá por productos frescos o de merma relevante.</p>
          {props.canOperate && <button type="button" className="primary-button mt-4" onClick={() => openNewProduct()}><Plus size={16} /> Agregar primer producto</button>}
          {detectedNames.length > 0 && (
            <div className="production-detected mt-5">
              <strong>Lebu ya vio estos productos en ventas</strong>
              <p>Tocá solamente los que quieras controlar en Producción.</p>
              <div className="production-detected-chips mt-3">
                {detectedNames.map((name) => <button type="button" key={name} onClick={() => openNewProduct(name)}>{name} <Plus size={13} /></button>)}
              </div>
            </div>
          )}
        </div>
      ) : !day ? (
        <div className="panel-card mt-4 production-opening-card">
          <div className="production-section-heading">
            <div><div className="eyebrow">AL ABRIR</div><h2>¿Con qué arrancás hoy?</h2><p>Cargá lo que ya está disponible para vender. Lo que pongas a leudar o preparar después se suma aparte.</p></div>
            <PackageCheck size={24} />
          </div>
          <div className="production-opening-grid mt-5">
            {props.products.map((product) => (
              <label key={product.id} className="production-opening-row">
                <span><strong>{product.name}</strong><small>{shelfLifeLabel(product.shelfLife)}</small></span>
                <input inputMode="decimal" value={openingDraft[product.id] || ''} onChange={(event) => setOpeningDraft((current) => ({ ...current, [product.id]: event.target.value }))} placeholder="0" />
              </label>
            ))}
          </div>
          {props.canOperate && <button type="button" className="primary-button mt-5 w-full justify-center" disabled={busy} onClick={() => void startDay()}>{busy ? 'Guardando…' : 'Empezar jornada'}</button>}
        </div>
      ) : (
        <>
          <div className={`production-day-strip mt-4 ${day.closedAt ? 'production-day-closed' : ''}`}>
            <div>{day.closedAt ? <CheckCircle2 size={18} /> : <Clock3 size={18} />}<span>{day.closedAt ? 'Jornada cerrada' : 'Jornada en curso'}</span></div>
            <strong>{statuses.length} producto{statuses.length === 1 ? '' : 's'} seguido{statuses.length === 1 ? '' : 's'}</strong>
            {day.closedAt && props.canOperate && <button type="button" onClick={() => void run(() => props.onReopenDay(date), 'Jornada reabierta.')}>Reabrir</button>}
          </div>

          <div className="production-product-grid mt-4">
            {statuses.map((status) => (
              <article className="production-product-card" key={status.product.id}>
                <div className="production-product-heading">
                  <div className="min-w-0"><div className="production-product-name"><strong>{status.product.name}</strong><span>{shelfLifeLabel(status.product.shelfLife)}</span></div>{status.product.unitCost != null && <small>Costo {money.format(status.product.unitCost)} / u.</small>}</div>
                  {props.canOperate && <button type="button" className="production-edit-button" onClick={() => openEditProduct(status.product)} aria-label={`Editar ${status.product.name}`}><Pencil size={15} /></button>}
                </div>

                <div className="production-product-numbers mt-4">
                  <div className={status.available <= 0 ? 'is-warning' : ''}><span>Disponible</span><strong>{qty.format(status.available)}</strong></div>
                  <div><span>En preparación</span><strong>{qty.format(status.inPreparation)}</strong></div>
                  <div><span>Vendido</span><strong>{productSalesDetail || status.manualSold > 0 ? qty.format(status.sold) : '—'}</strong></div>
                </div>

                {status.oversold > 0 && <div className="production-product-warning mt-3">Hay {qty.format(status.oversold)} ventas por encima de la disponibilidad registrada. Puede faltar una tanda o un ajuste.</div>}
                {day.closedAt && (status.waste > 0 || status.carry > 0) && (
                  <div className="production-close-result mt-3">
                    {status.waste > 0 && <span>Merma <b>{qty.format(status.waste)}</b>{status.wasteCost > 0 ? ` · ${money.format(status.wasteCost)}` : ''}</span>}
                    {status.carry > 0 && <span>Pasa a mañana <b>{qty.format(status.carry)}</b></span>}
                  </div>
                )}

                {!day.closedAt && props.canOperate && (
                  <div className="production-card-actions mt-4">
                    <button type="button" onClick={() => setQuickAction({ product: status.product, type: 'prep_started' })}><Plus size={15} /> Preparar</button>
                    {status.inPreparation > 0 && <button type="button" className="is-primary" onClick={() => setQuickAction({ product: status.product, type: 'prep_ready' })}><PackageCheck size={15} /> Ya está listo</button>}
                    {!automaticProductSalesDetail && <button type="button" onClick={() => setQuickAction({ product: status.product, type: 'manual_sale' })}>Vendí</button>}
                    <button type="button" onClick={() => setQuickAction({ product: status.product, type: 'adjustment' })}>Ajustar</button>
                  </div>
                )}
              </article>
            ))}
          </div>

          {!day.closedAt && props.canOperate && (
            <button type="button" className="production-close-button mt-4" onClick={() => {
              const preparing = statuses.filter((status) => status.inPreparation > 0);
              if (preparing.length) {
                showMessage(`Antes de cerrar, resolvé lo que sigue en preparación: ${preparing.map((item) => `${item.product.name} (${qty.format(item.inPreparation)})`).join(', ')}.`);
                return;
              }
              setClosingOpen(true);
            }}>
              <CheckCircle2 size={18} /><span><strong>Cerrar jornada de producción</strong><small>Confirmá qué se descartó y qué queda para mañana.</small></span><ChevronRight size={18} />
            </button>
          )}

          {analysis.insights.length > 0 && (
            <div className="production-learning-preview mt-4">
              <Sparkles size={18} />
              <div><strong>Lebu ya está aprendiendo</strong><p>{analysis.insights[0].title}. El detalle completo aparece en Mirada.</p></div>
            </div>
          )}
        </>
      )}

      {props.products.length > 0 && detectedNames.length > 0 && (
        <div className="production-detected panel-card mt-4">
          <strong>Otros productos detectados en ventas</strong>
          <p>Agregalos solo si querés controlar disponibilidad o merma.</p>
          <div className="production-detected-chips mt-3">{detectedNames.slice(0, 8).map((name) => <button type="button" key={name} onClick={() => openNewProduct(name)}>{name} <Plus size={13} /></button>)}</div>
        </div>
      )}

      {productDraft && <ProductModal
        draft={productDraft}
        onChange={setProductDraft}
        onClose={() => setProductDraft(null)}
        onSave={() => void saveProduct()}
        onDeactivate={productDraft.id ? () => {
          if (!confirm(`¿Dejar de seguir ${productDraft.name} en Producción? El historial queda guardado.`)) return;
          void run(async () => { await props.onDeactivateProduct(productDraft.id!); setProductDraft(null); }, 'Producto quitado de Producción.');
        } : undefined}
        busy={busy}
      />}
      {quickAction && <QuantityModal
        action={quickAction}
        pending={quickAction.type === 'manual_sale'
          ? (statuses.find((status) => status.product.id === quickAction.product.id)?.manualSold || 0)
          : (statuses.find((status) => status.product.id === quickAction.product.id)?.inPreparation || 0)}
        onClose={() => setQuickAction(null)}
        onConfirm={(value) => void confirmQuick(value)}
      />}

      {closingOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) setClosingOpen(false); }}>
          <div className="modal-sheet modal-sheet-wide production-modal-sheet">
            <div className="production-modal-heading">
              <div><div className="eyebrow">CIERRE DE PRODUCCIÓN</div><h2>¿Qué pasó con lo que quedó?</h2><p>La merma se mide en unidades y, si cargaste costo, Lebu también estima la plata que terminó descartada.</p></div>
              <button type="button" className="icon-button" onClick={() => setClosingOpen(false)}><X size={19} /></button>
            </div>
            <div className="production-closing-list mt-5">
              {statuses.filter((status) => status.available > 0 || status.sold > 0 || status.inPreparation > 0).map((status) => (
                <div className="production-closing-row" key={status.product.id}>
                  <div className="production-closing-product"><strong>{status.product.name}</strong><span>Lebu espera {qty.format(status.available)} disponibles{status.inPreparation > 0 ? ` · ${qty.format(status.inPreparation)} aún en preparación` : ''}</span></div>
                  <label><span>Merma</span><input inputMode="decimal" value={closingDraft[status.product.id]?.waste || ''} onChange={(event) => setClosingDraft((current) => ({ ...current, [status.product.id]: { ...(current[status.product.id] || { waste: '', carry: '' }), waste: event.target.value } }))} /></label>
                  <label><span>Para mañana</span><input inputMode="decimal" value={closingDraft[status.product.id]?.carry || ''} onChange={(event) => setClosingDraft((current) => ({ ...current, [status.product.id]: { ...(current[status.product.id] || { waste: '', carry: '' }), carry: event.target.value } }))} /></label>
                </div>
              ))}
            </div>
            <div className="production-closing-note mt-4"><AlertTriangle size={16} /><span>Si el conteo físico no coincide con lo que Lebu espera, cerrá y después usá “Ajustar” al día siguiente. Más adelante podemos agregar conciliación física dedicada.</span></div>
            <button type="button" className="primary-button mt-5 w-full justify-center" disabled={busy} onClick={() => void closeToday()}>{busy ? 'Cerrando…' : 'Confirmar cierre'}</button>
          </div>
        </div>
      )}
    </section>
  );
}
