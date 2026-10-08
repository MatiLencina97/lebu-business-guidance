'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Ticket,
  Trash2,
  Users,
} from 'lucide-react';
import { calculateEventQuote, type BusinessEvent, type BusinessEventStatus } from './events';
import type { BusinessEventDraft } from './events-client';

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const weekdayLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

const statusCopy: Record<BusinessEventStatus, string> = {
  lead: 'Posible',
  quoted: 'Cotizado',
  confirmed: 'Confirmado',
  done: 'Realizado',
  cancelled: 'Cancelado',
};

function isoDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fromISO(value: string) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayISO() {
  return isoDate(new Date());
}

function monthLabel(date: Date) {
  const value = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function longDate(value: string) {
  return new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(fromISO(value));
}

function numeric(value: string) {
  const parsed = Number(value.replace(/[^0-9.,-]/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

type DraftState = {
  id?: number;
  name: string;
  date: string;
  location: string;
  attendees: string;
  averageTicket: string;
  fixedCost: string;
  variableCostPerPerson: string;
  expectedConversionPct: string;
  status: BusinessEventStatus;
  notes: string;
};

function blankDraft(date: string, suggestedAverageTicket: number): DraftState {
  return {
    name: '',
    date,
    location: '',
    attendees: '',
    averageTicket: suggestedAverageTicket > 0 ? String(Math.round(suggestedAverageTicket)) : '',
    fixedCost: '',
    variableCostPerPerson: '',
    expectedConversionPct: '50',
    status: 'lead',
    notes: '',
  };
}

type Props = {
  businessId: string | null;
  canOperate: boolean;
  events: BusinessEvent[];
  loading: boolean;
  error: string;
  suggestedAverageTicket: number;
  onRefresh: () => Promise<void> | void;
  onSave: (draft: BusinessEventDraft) => Promise<number>;
  onDelete: (eventId: number) => Promise<void>;
};

export default function EventsView(props: Props) {
  const today = todayISO();
  const [month, setMonth] = useState(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(today);
  const [draft, setDraft] = useState<DraftState>(() => blankDraft(today, props.suggestedAverageTicket));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (draft.id || draft.averageTicket || props.suggestedAverageTicket <= 0) return;
    setDraft((current) => ({ ...current, averageTicket: String(Math.round(props.suggestedAverageTicket)) }));
  }, [draft.id, draft.averageTicket, props.suggestedAverageTicket]);

  const quote = useMemo(() => calculateEventQuote({
    attendees: numeric(draft.attendees),
    averageTicket: numeric(draft.averageTicket),
    fixedCost: numeric(draft.fixedCost),
    variableCostPerPerson: numeric(draft.variableCostPerPerson),
    expectedConversionPct: numeric(draft.expectedConversionPct),
  }), [draft.attendees, draft.averageTicket, draft.fixedCost, draft.variableCostPerPerson, draft.expectedConversionPct]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, BusinessEvent[]>();
    for (const event of props.events) {
      const list = map.get(event.date) || [];
      list.push(event);
      map.set(event.date, list);
    }
    return map;
  }, [props.events]);

  const calendarCells = useMemo(() => {
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const first = new Date(year, monthIndex, 1);
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    const leading = (first.getDay() + 6) % 7;
    const cells: Array<{ date: string; day: number } | null> = Array.from({ length: leading }, () => null);
    for (let day = 1; day <= lastDay; day += 1) {
      cells.push({ date: isoDate(new Date(year, monthIndex, day)), day });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [month]);

  const selectedEvents = useMemo(() => (eventsByDate.get(selectedDate) || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'es')), [eventsByDate, selectedDate]);
  const upcoming = useMemo(() => props.events.filter((event) => event.date >= today && event.status !== 'cancelled').slice().sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6), [props.events, today]);

  function showMessage(value: string) {
    setMessage(value);
    window.setTimeout(() => setMessage((current) => current === value ? '' : current), 3200);
  }

  function chooseDate(date: string) {
    setSelectedDate(date);
    if (!draft.id) setDraft((current) => ({ ...current, date }));
  }

  function newQuote(date = selectedDate) {
    setDraft(blankDraft(date, props.suggestedAverageTicket));
  }

  function editEvent(event: BusinessEvent) {
    setSelectedDate(event.date);
    const eventDate = fromISO(event.date);
    setMonth(new Date(eventDate.getFullYear(), eventDate.getMonth(), 1));
    setDraft({
      id: event.id,
      name: event.name,
      date: event.date,
      location: event.location,
      attendees: event.attendees ? String(event.attendees) : '',
      averageTicket: event.averageTicket ? String(Math.round(event.averageTicket)) : '',
      fixedCost: event.fixedCost ? String(Math.round(event.fixedCost)) : '',
      variableCostPerPerson: event.variableCostPerPerson ? String(Math.round(event.variableCostPerPerson)) : '',
      expectedConversionPct: String(event.expectedConversionPct),
      status: event.status,
      notes: event.notes,
    });
  }

  async function save() {
    if (!props.canOperate || busy) return;
    if (!draft.name.trim()) { showMessage('Poné un nombre para el evento.'); return; }
    if (!draft.date) { showMessage('Elegí una fecha.'); return; }
    setBusy(true);
    try {
      const id = await props.onSave({
        id: draft.id,
        date: draft.date,
        name: draft.name,
        location: draft.location,
        attendees: Math.max(Math.floor(numeric(draft.attendees)), 0),
        averageTicket: Math.max(numeric(draft.averageTicket), 0),
        fixedCost: Math.max(numeric(draft.fixedCost), 0),
        variableCostPerPerson: Math.max(numeric(draft.variableCostPerPerson), 0),
        expectedConversionPct: Math.min(Math.max(numeric(draft.expectedConversionPct), 0), 100),
        status: draft.status,
        notes: draft.notes,
      });
      showMessage(draft.id ? 'Evento actualizado.' : 'Evento guardado en el calendario.');
      setDraft((current) => ({ ...current, id }));
      setSelectedDate(draft.date);
    } catch (cause: any) {
      showMessage(cause?.message || 'No pudimos guardar el evento.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!props.canOperate || !draft.id || busy) return;
    if (!window.confirm('¿Eliminar este evento del calendario?')) return;
    setBusy(true);
    try {
      await props.onDelete(draft.id);
      showMessage('Evento eliminado.');
      newQuote(selectedDate);
    } catch (cause: any) {
      showMessage(cause?.message || 'No pudimos eliminar el evento.');
    } finally {
      setBusy(false);
    }
  }

  if (!props.businessId) {
    return (
      <section className="events-view mx-auto max-w-6xl">
        <div className="events-hero">
          <div><div className="eyebrow"><CalendarDays size={14} /> EVENTOS</div><h1>Planificá antes de salir a vender.</h1><p>Calendario y punto de equilibrio para decidir qué eventos convienen y cuántas ventas necesitás.</p></div>
        </div>
        <div className="panel-card mt-4 p-6">
          <strong className="text-[var(--ink)]">Eventos necesita un negocio sincronizado.</strong>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Ingresá a tu cuenta para guardar cotizaciones y ver el mismo calendario desde todos tus dispositivos.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="events-view mx-auto max-w-6xl">
      <div className="events-hero">
        <div>
          <div className="eyebrow"><CalendarDays size={14} /> EVENTOS</div>
          <h1>¿Cuánto tiene que vender este evento?</h1>
          <p>Estimá costos, gente y ticket promedio. Lebu te dice cuántas compras necesitás para cubrir gastos y qué conversión exige eso.</p>
        </div>
        <div className="events-hero-actions">
          <button type="button" className="secondary-button" onClick={() => void props.onRefresh()} disabled={props.loading}><RefreshCw size={16} className={props.loading ? 'events-spin' : ''} /> Actualizar</button>
          {props.canOperate && <button type="button" className="primary-button" onClick={() => newQuote()}><Plus size={16} /> Nuevo evento</button>}
        </div>
      </div>

      {(message || props.error) && <div className={`events-message mt-4 ${props.error ? 'events-message-error' : ''}`}>{props.error || message}</div>}

      <div className="events-layout mt-5">
        <div className="events-calendar-card">
          <div className="events-calendar-heading">
            <button type="button" className="icon-button" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} aria-label="Mes anterior"><ChevronLeft size={18} /></button>
            <div><div className="eyebrow">CALENDARIO</div><h2>{monthLabel(month)}</h2></div>
            <button type="button" className="icon-button" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} aria-label="Mes siguiente"><ChevronRight size={18} /></button>
          </div>

          <div className="events-weekdays mt-5">
            {weekdayLabels.map((label) => <span key={label}>{label}</span>)}
          </div>
          <div className="events-calendar-grid">
            {calendarCells.map((cell, index) => {
              if (!cell) return <div key={`empty-${index}`} className="events-calendar-empty" />;
              const dayEvents = eventsByDate.get(cell.date) || [];
              const selected = cell.date === selectedDate;
              const isToday = cell.date === today;
              return (
                <button type="button" key={cell.date} onClick={() => chooseDate(cell.date)} className={`events-calendar-day ${selected ? 'events-calendar-day-selected' : ''} ${isToday ? 'events-calendar-day-today' : ''}`}>
                  <span className="events-calendar-number">{cell.day}</span>
                  {dayEvents.slice(0, 2).map((event) => <span key={event.id} className={`events-calendar-chip events-status-${event.status}`}>{event.name}</span>)}
                  {dayEvents.length > 2 && <small>+{dayEvents.length - 2}</small>}
                </button>
              );
            })}
          </div>

          <div className="events-selected-day mt-4">
            <div className="events-section-heading">
              <div><span>Fecha seleccionada</span><strong>{longDate(selectedDate)}</strong></div>
              {props.canOperate && <button type="button" onClick={() => newQuote(selectedDate)}>Cotizar acá <Plus size={14} /></button>}
            </div>
            {selectedEvents.length ? (
              <div className="events-day-list mt-3">
                {selectedEvents.map((event) => (
                  <button type="button" key={event.id} onClick={() => editEvent(event)} className="events-list-row">
                    <span className={`events-status-dot events-status-${event.status}`} />
                    <span className="events-list-main"><strong>{event.name}</strong><small>{event.location || `${integer.format(event.attendees)} personas`}</small></span>
                    <span className="events-list-meta">{statusCopy[event.status]}<ChevronRight size={14} /></span>
                  </button>
                ))}
              </div>
            ) : <p className="events-empty-copy mt-3">No hay eventos guardados para este día.</p>}
          </div>

          {upcoming.length > 0 && (
            <div className="events-upcoming mt-5">
              <div className="eyebrow">PRÓXIMOS</div>
              <div className="events-upcoming-list mt-2">
                {upcoming.map((event) => (
                  <button type="button" key={event.id} onClick={() => editEvent(event)}>
                    <span className="events-upcoming-date">{new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short' }).format(fromISO(event.date))}</span>
                    <span><strong>{event.name}</strong><small>{integer.format(event.attendees)} personas · {statusCopy[event.status]}</small></span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="events-quote-card">
          <div className="events-quote-heading">
            <div><div className="eyebrow">{draft.id ? 'EVENTO GUARDADO' : 'COTIZADOR'}</div><h2>{draft.id ? 'Revisá la cuenta' : 'Armá el escenario'}</h2></div>
            {draft.id && <button type="button" className="icon-button" onClick={() => newQuote()} title="Nueva cotización"><Plus size={18} /></button>}
          </div>

          <div className="events-form-grid mt-5">
            <label className="events-field events-field-wide">
              <span>Nombre del evento</span>
              <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ej. Torneo sábado · La Rana" />
            </label>
            <label className="events-field">
              <span>Fecha</span>
              <input type="date" value={draft.date} onChange={(event) => { setDraft((current) => ({ ...current, date: event.target.value })); if (event.target.value) chooseDate(event.target.value); }} />
            </label>
            <label className="events-field">
              <span>Estado</span>
              <select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as BusinessEventStatus }))}>
                {(Object.keys(statusCopy) as BusinessEventStatus[]).map((status) => <option key={status} value={status}>{statusCopy[status]}</option>)}
              </select>
            </label>
            <label className="events-field events-field-wide">
              <span>Lugar</span>
              <div className="events-input-icon"><MapPin size={15} /><input value={draft.location} onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))} placeholder="Opcional" /></div>
            </label>
            <label className="events-field">
              <span>Personas estimadas</span>
              <div className="events-input-icon"><Users size={15} /><input inputMode="numeric" value={draft.attendees} onChange={(event) => setDraft((current) => ({ ...current, attendees: event.target.value.replace(/[^0-9]/g, '') }))} placeholder="Ej. 300" /></div>
            </label>
            <label className="events-field">
              <span>Ticket promedio</span>
              <div className="events-input-icon"><Ticket size={15} /><input inputMode="numeric" value={draft.averageTicket} onChange={(event) => setDraft((current) => ({ ...current, averageTicket: event.target.value.replace(/[^0-9]/g, '') }))} placeholder="Ej. 6.000" /></div>
              {props.suggestedAverageTicket > 0 && <small>Promedio reciente de Lebu: <button type="button" onClick={() => setDraft((current) => ({ ...current, averageTicket: String(Math.round(props.suggestedAverageTicket)) }))}>{money.format(props.suggestedAverageTicket)}</button></small>}
            </label>
            <label className="events-field">
              <span>Costos fijos del evento</span>
              <div className="events-input-icon"><CircleDollarSign size={15} /><input inputMode="numeric" value={draft.fixedCost} onChange={(event) => setDraft((current) => ({ ...current, fixedCost: event.target.value.replace(/[^0-9]/g, '') }))} placeholder="Personal, traslado, canon…" /></div>
            </label>
            <label className="events-field">
              <span>Costo variable por persona</span>
              <div className="events-input-icon"><CircleDollarSign size={15} /><input inputMode="numeric" value={draft.variableCostPerPerson} onChange={(event) => setDraft((current) => ({ ...current, variableCostPerPerson: event.target.value.replace(/[^0-9]/g, '') }))} placeholder="Opcional" /></div>
            </label>
            <label className="events-field events-field-wide">
              <span>¿Qué % de asistentes creés que compra?</span>
              <div className="events-conversion-row">
                <input type="range" min="0" max="100" step="5" value={Math.min(Math.max(numeric(draft.expectedConversionPct), 0), 100)} onChange={(event) => setDraft((current) => ({ ...current, expectedConversionPct: event.target.value }))} />
                <input className="events-conversion-number" inputMode="numeric" value={draft.expectedConversionPct} onChange={(event) => setDraft((current) => ({ ...current, expectedConversionPct: event.target.value.replace(/[^0-9]/g, '').slice(0, 3) }))} />
                <strong>%</strong>
              </div>
            </label>
          </div>

          <div className="events-result-hero mt-5">
            <div>
              <span>Para cubrir {money.format(quote.totalCost)} de gastos necesitás</span>
              <strong>{quote.ticketsNeeded ? integer.format(quote.ticketsNeeded) : '—'} tickets</strong>
              <small>Tomando {draft.averageTicket ? money.format(numeric(draft.averageTicket)) : 'un ticket todavía sin definir'} por compra promedio.</small>
            </div>
            <div className={`events-feasibility ${quote.breakEvenPossibleWithOneTicketEach ? 'events-feasible' : 'events-not-feasible'}`}>
              {quote.totalCost <= 0 ? 'Sin gastos cargados' : quote.breakEvenPossibleWithOneTicketEach ? 'Equilibrio posible' : 'Exige más de 1 compra por persona'}
            </div>
          </div>

          <div className="events-metrics mt-3">
            <div><span>Conversión mínima</span><strong>{quote.ticketsNeeded && numeric(draft.attendees) > 0 ? `${Math.ceil(quote.requiredConversionPct)}%` : '—'}</strong><small>de los asistentes comprando 1 ticket</small></div>
            <div><span>Con tu escenario</span><strong>{integer.format(quote.expectedTickets)} tickets</strong><small>{draft.expectedConversionPct || '0'}% de conversión estimada</small></div>
            <div><span>Venta esperada</span><strong>{money.format(quote.expectedRevenue)}</strong><small>tickets esperados × ticket promedio</small></div>
            <div className={quote.expectedResult >= 0 ? 'events-metric-positive' : 'events-metric-negative'}><span>Resultado estimado</span><strong>{money.format(quote.expectedResult)}</strong><small>después de los gastos del evento</small></div>
          </div>

          {quote.totalCost > 0 && numeric(draft.attendees) > 0 && !quote.breakEvenPossibleWithOneTicketEach && (
            <div className="events-advice mt-4">
              <strong>Con un solo ticket por persona no alcanza.</strong>
              <p>Incluso si comprara el 100% de los asistentes, la venta máxima sería {money.format(quote.maxRevenue)}. Necesitás subir el ticket promedio, bajar costos o lograr más de una compra por persona.</p>
            </div>
          )}

          {quote.totalCost > 0 && quote.expectedTickets > 0 && quote.expectedResult < 0 && Number.isFinite(quote.averageTicketNeededAtExpectedConversion) && (
            <div className="events-advice mt-3">
              <strong>Con {draft.expectedConversionPct}% de conversión</strong>
              <p>El ticket promedio debería ser al menos {money.format(Math.ceil(quote.averageTicketNeededAtExpectedConversion))} para quedar en equilibrio.</p>
            </div>
          )}

          <label className="events-field mt-4">
            <span>Notas</span>
            <textarea rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Contacto, horario, condiciones, electricidad, comisión del organizador…" />
          </label>

          {props.canOperate && (
            <div className="events-actions mt-5">
              {draft.id && <button type="button" className="secondary-button events-delete" disabled={busy} onClick={() => void remove()}><Trash2 size={15} /> Eliminar</button>}
              <button type="button" className="primary-button flex-1 justify-center" disabled={busy || !draft.name.trim() || !draft.date} onClick={() => void save()}>{draft.id ? <Pencil size={16} /> : <Save size={16} />}{busy ? 'Guardando…' : draft.id ? 'Guardar cambios' : 'Guardar en calendario'}</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
