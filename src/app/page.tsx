'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight,
  Bell,
  BellRing,
  ArrowUpRight,
  CalendarDays,
  Cloud,
  CloudOff,
  Download,
  ChevronRight,
  CheckCircle2,
  CircleDollarSign,
  Plus,
  Repeat2,
  Pencil,
  Settings2,
  Trash2,
  Upload,
  RefreshCw,
  LogOut,
  Undo2,
  Volume2,
  VolumeX,
  TrendingUp,
  TrendingDown,
  Users,
  UserPlus,
  ShieldCheck,
  KeyRound,
  Building2,
  X,
  House,
  ListChecks,
  Target,
  UserRound,
  ChevronDown,
  HelpCircle,
  PlayCircle,
  Eye,
  Sun,
  Moon,
  Monitor,
  Wallet,
  CalendarClock,
  PackageOpen,
} from 'lucide-react';
import { useUiSounds } from './useUiSounds';
import MovementImportModal from './MovementImportModal';
import type { ImportKind, PreparedImportRow } from './import-utils';
import { clearLocalState, readLocalState, writeLocalState } from './storage';
import { useLebuCloudSync, type CloudState } from './cloud-sync';
import { cancelTeamInvitation, fetchTeamOverview, inviteTeamMember, removeTeamMember, renameBusiness, updateAccountPassword, updateTeamMemberRole, type InvitabledTeamRole, type TeamOverview, type TeamRole } from './team-client';
import { enablePushNotifications, getPushPreferences, getPushSupportStatus, savePushPreferences, sendPushSnapshot, sendTestPush, type PushPreferences, type PushSupportStatus, type SmartSyncEvent } from './push-client';
import MiradaView from './MiradaView';
import ProductionView from './ProductionView';
import { buildMiradaAnalysis, type MiradaAnalysisWindowKind } from './mirada';
import { applyThemePreference, readThemePreference, resolveTheme, saveThemePreference, type ThemePreference } from './theme';
import { buildCashGuidance, normalizeCashPaymentSchedule, type CashPaymentSchedule } from './cashflow';
import { applyRecurringConfigChange, normalizeRecurringHistory, recurringEconomicConfigChanged, resolveRecurringConfig, type RecurringHistoryEntry } from '../lib/recurring-history';
import { expectedRecurringAmount, reconcileRecurringExpenses, recurringOccurrenceCandidates, recurringOccurrenceDateForExpense } from '../lib/recurring-reconciliation';
import { connectFudo, disconnectFudo, getFudoStatus, syncFudo, type FudoConnectionStatus, type FudoSyncResult } from './fudo-client';
import { buildProductionAnalysis, buildProductionDayStatus, buildProductionHomeAlert } from './production';
import { useProductionData } from './production-client';

const money = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const ONBOARDING_KEY = 'lebu.onboarding.v1.seen';
const NOTIFICATION_PROMPT_KEY = 'lebu.notifications.contextual.v1.dismissed';
const MIRADA_WINDOW_KEY = 'lebu.mirada.analysis-window.v1';

function parseMoney(value: string) {
  const cleaned = value.replace(/[^0-9]/g, '');
  return cleaned ? Number(cleaned) : 0;
}

function parseSignedMoney(value: string) {
  const cleaned = value.replace(/[^0-9]/g, '');
  if (!cleaned) return 0;
  return /^\s*-/.test(value) ? -Number(cleaned) : Number(cleaned);
}

function formatMoneyInput(value: string, allowNegative = false) {
  const digits = value.replace(/[^0-9]/g, '');
  const isNegative = allowNegative && /^\s*-/.test(value);
  if (!digits) return isNegative ? '-' : '';
  const formatted = number.format(Number(digits));
  return `${isNegative ? '-' : ''}${formatted}`;
}

function createEntityId() {
  // Date.now() solo puede colisionar si dos dispositivos crean algo en el mismo milisegundo.
  // El sufijo aleatorio conserva un número JS seguro y reduce drásticamente esa posibilidad.
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

function toLocalISO(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function todayISO() {
  return toLocalISO(new Date());
}

function cashEffectTimestampForDate(dateISO: string) {
  if (!dateISO) return '';
  // "Ya salió de caja" significa que el egreso ya ocurrió. Para hoy o una fecha contable futura,
  // el efecto real es ahora. En fechas pasadas usamos ese día como mejor aproximación.
  if (dateISO >= todayISO()) return new Date().toISOString();
  const date = fromISO(dateISO);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

function historicalCutoff(startISO: string, endISO: string) {
  const today = todayISO();
  const yesterday = toLocalISO(addDays(fromISO(today), -1));
  const preferred = yesterday >= startISO ? yesterday : today;
  return preferred > endISO ? endISO : preferred < startISO ? startISO : preferred;
}

function fromISO(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function daysInMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function formatShortDate(value: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short' }).format(fromISO(value));
}

function formatLongDate(value: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).format(fromISO(value));
}

function formatPeriodRange(start: string, end: string) {
  const startDate = fromISO(start);
  const endDate = fromISO(end);
  const sameMonth = startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear();
  const startLabel = new Intl.DateTimeFormat('es-AR', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' }).format(startDate);
  const endLabel = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short' }).format(endDate);
  return `${startLabel}–${endLabel}`;
}

type PeriodType = 'weekly' | 'biweekly' | 'monthly';
type SettingsSection = 'plan' | 'preferences' | 'account';
type MainView = 'home' | 'movements' | 'production' | 'insights' | 'simulator';

type RecurringFrequency = 'weekly' | 'biweekly' | 'monthly';

type RecurringCost = {
  id: number;
  name: string;
  amount: string;
  frequency: RecurringFrequency;
  paymentSchedule?: CashPaymentSchedule | null;
  amountApproximate?: boolean;
  // Línea temporal de cambios. El primer cambio sobre un dato legado crea una entrada baseline
  // y las siguientes entradas solo afectan desde effectiveFrom en adelante.
  configHistory?: RecurringHistoryEntry[];
};

type DayException = {
  date: string;
  open: boolean;
};

type HistoricalSummary = {
  startDate: string;
  endDate: string;
  salesTotal: string;
  expensesTotal: string;
  // Estos flags permiten que un resumen cubra solo ventas, solo gastos o ambos.
  // Para datos viejos sin flags, Lebu infiere cobertura únicamente si el total es > 0.
  salesCovered?: boolean;
  expensesCovered?: boolean;
  expensesIncludeRecurring: boolean;
  // IDs de gastos recurrentes que ya estaban contemplados dentro de expensesTotal.
  // La fecha endDate marca hasta dónde llega el acumulado. En planes mensuales, un recurrente
  // semanal/quincenal puede volver a ocurrir después de esa fecha y esa parte futura sí cuenta.
  // Si falta en datos viejos y expensesIncludeRecurring=true, Lebu asume incluidos los
  // recurrentes configurados en ese momento.
  coveredRecurringCostIds?: number[];
  capturedAt: string;
};

function historicalSummaryCoversSales(summary: HistoricalSummary | null) {
  return Boolean(summary && (typeof summary.salesCovered === 'boolean' ? summary.salesCovered : parseMoney(summary.salesTotal) > 0));
}

function historicalSummaryCoversExpenses(summary: HistoricalSummary | null) {
  return Boolean(summary && (typeof summary.expensesCovered === 'boolean' ? summary.expensesCovered : parseMoney(summary.expensesTotal) > 0));
}

function historicalSummaryIsActiveForPeriod(summary: HistoricalSummary | null, period: { start: string; end: string }) {
  return Boolean(
    summary
    && summary.startDate >= period.start
    && summary.endDate <= period.end
    && summary.startDate <= summary.endDate,
  );
}

function coveredRecurringIdsForSummary(summary: HistoricalSummary | null, recurringCosts: RecurringCost[]) {
  if (!summary || !historicalSummaryCoversExpenses(summary) || !summary.expensesIncludeRecurring) return [] as number[];
  if (Array.isArray(summary.coveredRecurringCostIds)) {
    return summary.coveredRecurringCostIds.filter((id) => Number.isFinite(Number(id))).map(Number);
  }
  // Compatibilidad: en datos viejos la casilla solo indicaba que los recurrentes estaban
  // incluidos en el acumulado. Conservamos esa intención y aplicamos la cobertura temporal
  // según endDate y la frecuencia de cada recurrente.
  return recurringCosts.map((item) => item.id);
}

function recurringCoveredAmountForSummary(
  item: RecurringCost,
  summary: HistoricalSummary | null,
  period: { start: string; end: string },
  planType: PeriodType,
) {
  if (!summary || !historicalSummaryCoversExpenses(summary) || !summary.expensesIncludeRecurring) return 0;

  const fullPeriodAmount = prorateRecurringCost(item, period.start, period.end, planType, period.start, period.end);
  if (fullPeriodAmount <= 0) return 0;

  // Si la frecuencia coincide con el período del objetivo hay una sola ocurrencia atribuida a
  // ese período (semanal+semana, quincenal+quincena, mensual+mes). Si el usuario afirma que ya
  // estaba incluida en el acumulado, esa ocurrencia completa ya está cubierta.
  if (resolveRecurringConfig(item, summary.endDate).frequency === planType) return fullPeriodAmount;

  // Cuando dentro del período hay varias repeticiones (por ejemplo sueldo semanal dentro de un
  // objetivo mensual), el acumulado cubre únicamente hasta su fecha final. Lo que vuelva a
  // ocurrir después sigue siendo un costo pendiente y debe formar parte del camino al objetivo.
  const coveredStart = summary.startDate > period.start ? summary.startDate : period.start;
  const coveredEnd = summary.endDate < period.end ? summary.endDate : period.end;
  if (coveredEnd < coveredStart) return 0;

  const coveredAmount = prorateRecurringCost(item, coveredStart, coveredEnd, planType, period.start, period.end);
  return Math.min(Math.max(coveredAmount, 0), fullPeriodAmount);
}

type SettingsDraft = {
  profitTarget: string;
  periodType: PeriodType;
  periodStartDay: number;
  openWeekdays: number[];
  dayExceptions: DayException[];
  recurringCosts: RecurringCost[];
  categories: string[];
  smartDistributionEnabled: boolean;
  availableCash: string;
};

type SimulatorDraft = {
  profitTarget: string;
  extraMonthlyCost: string;
  openWeekdays: number[];
};

type Sale = {
  id: number;
  date: string;
  amount: string;
  source?: 'manual' | 'fudo' | string;
  externalId?: string;
  sourceUpdatedAt?: string;
  sourceMetadata?: Record<string, unknown>;
  paymentBreakdown?: Array<{ id?: string; amount?: number; methodName?: string; isCash?: boolean }>;
  // FUDO conserva el timestamp real cuando la API lo entrega. Mirada 1.21.10 lo usa
  // para habilitar análisis horario sin convertir a Lebu en un POS.
  occurredAt?: string;
  ticketId?: string;
  items?: Array<{ name: string; quantity?: number; amount?: number; category?: string }>;
  // Impacto neto conocido sobre caja. Las ventas manuales quedan sin completar porque
  // Lebu no estima comisiones ni acreditaciones.
  cashEffectAmount?: string;
  cashEffectAt?: string;
  createdBy?: string;
  createdByEmail?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedByEmail?: string;
};

type Expense = {
  id: number;
  date: string;
  amount: string;
  category: string;
  note: string;
  // Un gasto manual puede marcarse como efectivamente pagado. En ese caso Lebu conoce
  // el egreso neto exacto y puede descontarlo de la caja estimada.
  cashEffectAmount?: string;
  cashEffectAt?: string;
  recurringCostId?: number;
  recurringOccurrenceDate?: string;
  reconciliationSource?: 'import' | 'manual' | 'fudo';
  createdBy?: string;
  createdByEmail?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedByEmail?: string;
};

type CashAdjustment = {
  id: number;
  amount: string;
  adjustedAt: string;
  estimatedBefore: string;
  confirmedAfter: string;
  reason: 'reconciliation';
};

type DailySnapshot = {
  date: string;
  periodStart: string;
  periodEnd: string;
  dailyNeeded: number;
  currentProfit: number;
  soldSoFar: number;
  totalExpenses: number;
  projectedProfit: number;
  target: number;
  referenceDailyTarget?: number;
};

type UndoMovement = {
  kind: 'sale' | 'expense';
  item: Sale | Expense;
};

type MovementEditDraft = {
  kind: 'sale' | 'expense';
  id: number;
  amount: string;
  date: string;
  category: string;
  note: string;
  cashPaid: boolean;
  recurringCostId: number | null;
  recurringOccurrenceDate: string | null;
};

type LebuInsight = {
  title: string;
  body: string;
  tone: 'positive' | 'warning' | 'neutral';
};

type Movement =
  | { id: number; kind: 'sale'; date: string; amount: number; title: string; source?: string; createdBy?: string; createdByEmail?: string; createdAt?: string; updatedBy?: string; updatedByEmail?: string }
  | { id: number; kind: 'expense'; date: string; amount: number; title: string; subtitle?: string; createdBy?: string; createdByEmail?: string; createdAt?: string; updatedBy?: string; updatedByEmail?: string };

const periodCopy: Record<PeriodType, { label: string; phrase: string; targetLabel: string }> = {
  weekly: { label: 'Semanal', phrase: 'esta semana', targetLabel: 'Quiero ganar esta semana' },
  biweekly: { label: 'Quincenal', phrase: 'esta quincena', targetLabel: 'Quiero ganar esta quincena' },
  monthly: { label: 'Mensual', phrase: 'este mes', targetLabel: 'Quiero ganar este mes' },
};

const recurringFrequencyCopy: Record<RecurringFrequency, { label: string; short: string }> = {
  weekly: { label: 'Semanal', short: 'semana' },
  biweekly: { label: 'Quincenal', short: 'quincena' },
  monthly: { label: 'Mensual', short: 'mes' },
};

const cashConfidenceCopy = {
  high: { label: 'Caja muy fresca', tone: 'high' },
  medium: { label: 'Caja estimada', tone: 'medium' },
  low: { label: 'Conviene confirmar', tone: 'low' },
} as const;

const teamRoleCopy: Record<TeamRole, { label: string; description: string }> = {
  owner: { label: 'Dueño', description: 'Control total del comercio y del equipo.' },
  admin: { label: 'Administrador', description: 'Objetivos, configuración, movimientos y equipo operativo.' },
  operator: { label: 'Carga', description: 'Registra ventas y gastos. Solo puede corregir o borrar los movimientos que cargó.' },
  viewer: { label: 'Solo lectura', description: 'Puede ver números y movimientos, sin modificar el negocio.' },
};

const weekdayOptions = [
  { value: 1, short: 'L', label: 'Lunes' },
  { value: 2, short: 'M', label: 'Martes' },
  { value: 3, short: 'X', label: 'Miércoles' },
  { value: 4, short: 'J', label: 'Jueves' },
  { value: 5, short: 'V', label: 'Viernes' },
  { value: 6, short: 'S', label: 'Sábado' },
  { value: 0, short: 'D', label: 'Domingo' },
];

function recurringPaymentLabel(item: Pick<RecurringCost, 'frequency' | 'paymentSchedule'>) {
  const schedule = normalizeCashPaymentSchedule(item.paymentSchedule, item.frequency);
  if (!schedule) return 'Sin fecha de pago';
  if (schedule.type === 'weekday') {
    const day = weekdayOptions.find((option) => option.value === schedule.weekday);
    return day ? `Cada ${day.label.toLowerCase()}` : 'Semanal';
  }
  if (item.frequency === 'monthly') return `Día ${schedule.days[0]} de cada mes`;
  return schedule.days.length > 1
    ? `Días ${schedule.days[0]} y ${schedule.days[1]} de cada mes`
    : `Día ${schedule.days[0]} de cada mes`;
}

function capitalizeLabel(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function recurringOccurrenceLabel(item: Pick<RecurringCost, 'frequency'>, occurrenceDate: string) {
  if (!occurrenceDate) return 'Ocurrencia';
  if (item.frequency === 'monthly') {
    return capitalizeLabel(new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(fromISO(occurrenceDate)));
  }
  if (item.frequency === 'biweekly') return `Quincena · ${formatShortDate(occurrenceDate)}`;
  return `Semana · ${formatShortDate(occurrenceDate)}`;
}

function recurringPaymentStatusLabel(status: 'pending' | 'partial' | 'paid' | 'over', approximate = false) {
  if (status === 'paid') return 'Pagado';
  if (status === 'over') return approximate ? 'Real por encima del estimado' : 'Pagado por encima';
  if (status === 'partial') return 'Parcialmente pagado';
  return 'Pendiente';
}

function PaymentScheduleEditor({
  frequency,
  schedule,
  onChange,
}: {
  frequency: RecurringFrequency;
  schedule?: CashPaymentSchedule | null;
  onChange: (value: CashPaymentSchedule | null) => void;
}) {
  const normalized = normalizeCashPaymentSchedule(schedule, frequency);
  if (frequency === 'weekly') {
    const weekday = normalized?.type === 'weekday' ? normalized.weekday : '';
    return (
      <label className="recurring-payment-control">
        <span className="recurring-field-label recurring-payment-label">Día de pago</span>
        <select
          value={weekday}
          onChange={(event) => onChange(event.target.value === '' ? null : { type: 'weekday', weekday: Number(event.target.value) })}
          className="field-input recurring-select"
        >
          <option value="">Sin configurar</option>
          {weekdayOptions.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
        </select>
      </label>
    );
  }

  const days = normalized?.type === 'month_days' ? normalized.days : [];
  const first = days[0] ?? '';
  const second = days[1] ?? '';
  const updateMonthDays = (nextFirst: number | '', nextSecond: number | '' = '') => {
    const nextDays = [nextFirst, ...(frequency === 'biweekly' ? [nextSecond] : [])]
      .filter((value): value is number => typeof value === 'number' && value >= 1 && value <= 31);
    onChange(nextDays.length ? { type: 'month_days', days: [...new Set(nextDays)].sort((a, b) => a - b) } : null);
  };

  return (
    <div className={`recurring-payment-control ${frequency === 'biweekly' ? 'recurring-payment-control-double' : ''}`}>
      <label>
        <span className="recurring-field-label recurring-payment-label">{frequency === 'biweekly' ? '1.er pago' : 'Día de pago'}</span>
        <select value={first} onChange={(event) => updateMonthDays(event.target.value === '' ? '' : Number(event.target.value), second)} className="field-input recurring-select">
          <option value="">Sin configurar</option>
          {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>Día {day}</option>)}
        </select>
      </label>
      {frequency === 'biweekly' && (
        <label>
          <span className="recurring-field-label recurring-payment-label">2.º pago</span>
          <select value={second} onChange={(event) => updateMonthDays(first, event.target.value === '' ? '' : Number(event.target.value))} className="field-input recurring-select">
            <option value="">Sin configurar</option>
            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>Día {day}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

function getCurrentPeriod(type: PeriodType, monthlyStartDay = 1) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (type === 'weekly') {
    const mondayOffset = (today.getDay() + 6) % 7;
    const start = addDays(today, -mondayOffset);
    return { start: toLocalISO(start), end: toLocalISO(addDays(start, 6)) };
  }

  if (type === 'biweekly') {
    const firstHalf = today.getDate() <= 15;
    const start = new Date(today.getFullYear(), today.getMonth(), firstHalf ? 1 : 16);
    const end = new Date(today.getFullYear(), today.getMonth(), firstHalf ? 15 : daysInMonth(today));
    return { start: toLocalISO(start), end: toLocalISO(end) };
  }

  const requestedDay = Math.min(Math.max(Math.round(monthlyStartDay || 1), 1), 31);
  const startForMonth = (year: number, month: number) => new Date(year, month, Math.min(requestedDay, daysInMonth(new Date(year, month, 1))));
  const candidate = startForMonth(today.getFullYear(), today.getMonth());
  const start = today >= candidate ? candidate : startForMonth(today.getFullYear(), today.getMonth() - 1);
  const nextStart = startForMonth(start.getFullYear(), start.getMonth() + 1);
  return { start: toLocalISO(start), end: toLocalISO(addDays(nextStart, -1)) };
}

function isWithinPeriod(value: string, start: string, end: string) {
  return value >= start && value <= end;
}

function isDateOpen(dateISO: string, openWeekdays: number[], dayExceptions: DayException[] = []) {
  const exception = dayExceptions.find((item) => item.date === dateISO);
  if (exception) return exception.open;
  return openWeekdays.includes(fromISO(dateISO).getDay());
}

function countOpenDays(startISO: string, endISO: string, openWeekdays: number[], fromISOValue = todayISO(), dayExceptions: DayException[] = []) {
  const start = fromISO(startISO);
  const end = fromISO(endISO);
  const from = fromISO(fromISOValue);
  const cursor = start > from ? new Date(start) : new Date(from);
  let count = 0;
  for (let date = cursor; date <= end; date = addDays(date, 1)) {
    if (isDateOpen(toLocalISO(date), openWeekdays, dayExceptions)) count += 1;
  }
  return count;
}

function listOpenDates(startISO: string, endISO: string, openWeekdays: number[], dayExceptions: DayException[] = []) {
  const dates: string[] = [];
  for (let date = fromISO(startISO); date <= fromISO(endISO); date = addDays(date, 1)) {
    const value = toLocalISO(date);
    if (isDateOpen(value, openWeekdays, dayExceptions)) dates.push(value);
  }
  return dates;
}

function recurringDailyRate(item: RecurringCost, date: Date, planType?: PeriodType, planStartISO?: string, planEndISO?: string) {
  const dateISO = toLocalISO(date);
  const config = resolveRecurringConfig(item, dateISO);
  const amount = parseMoney(String(config.amount));
  if (!amount) return 0;
  if (config.frequency === 'monthly' && planType === 'monthly' && planStartISO && planEndISO) {
    return amount / Math.max(countCalendarDays(planStartISO, planEndISO), 1);
  }
  if (config.frequency === 'weekly') return amount / 7;
  if (config.frequency === 'biweekly') {
    const halfDays = date.getDate() <= 15 ? 15 : daysInMonth(date) - 15;
    return amount / halfDays;
  }
  return amount / daysInMonth(date);
}

function countCalendarDays(startISO: string, endISO: string) {
  let count = 0;
  for (let date = fromISO(startISO); date <= fromISO(endISO); date = addDays(date, 1)) count += 1;
  return count;
}

function prorateRecurringCost(item: RecurringCost, startISO: string, endISO: string, planType?: PeriodType, planStartISO?: string, planEndISO?: string) {
  if (endISO < startISO) return 0;
  let total = 0;
  for (let date = fromISO(startISO); date <= fromISO(endISO); date = addDays(date, 1)) {
    total += recurringDailyRate(item, date, planType, planStartISO, planEndISO);
  }
  return total;
}

function recurringDailyLabel(item: RecurringCost) {
  return recurringDailyRate(item, new Date());
}

type SmartWeekdayStat = {
  weekday: number;
  samples: number;
  average: number;
  weight: number;
};

type SmartDistributionModel = {
  ready: boolean;
  progress: number;
  totalSamples: number;
  minimumSamples: number;
  coveredWeekdays: number;
  requiredCoverage: number;
  stats: SmartWeekdayStat[];
  weightByWeekday: Record<number, number>;
};

function weekdayLabel(value: number) {
  return weekdayOptions.find((day) => day.value === value)?.label || 'Día';
}

function buildSmartDistributionModel(sales: Sale[], openWeekdays: number[]): SmartDistributionModel {
  const today = todayISO();
  const cutoff = toLocalISO(addDays(fromISO(today), -84));
  const totalsByDate = new Map<string, number>();

  for (const sale of sales) {
    if (!sale?.date || sale.date >= today || sale.date < cutoff) continue;
    const weekday = fromISO(sale.date).getDay();
    if (!openWeekdays.includes(weekday)) continue;
    const amount = parseMoney(sale.amount);
    if (amount <= 0) continue;
    totalsByDate.set(sale.date, (totalsByDate.get(sale.date) || 0) + amount);
  }

  const valuesByWeekday = new Map<number, { date: string; amount: number }[]>();
  for (const [date, amount] of totalsByDate) {
    const weekday = fromISO(date).getDay();
    const list = valuesByWeekday.get(weekday) || [];
    list.push({ date, amount });
    valuesByWeekday.set(weekday, list);
  }

  const rawStats = openWeekdays.map((weekday) => {
    const values = (valuesByWeekday.get(weekday) || []).sort((a, b) => a.date.localeCompare(b.date));
    const recent = values.slice(-8);
    const average = recent.length ? recent.reduce((sum, value) => sum + value.amount, 0) / recent.length : 0;
    return { weekday, samples: recent.length, average };
  });
  const observedAverages = rawStats.filter((item) => item.samples > 0).map((item) => item.average);
  const baseAverage = observedAverages.length ? observedAverages.reduce((sum, value) => sum + value, 0) / observedAverages.length : 0;
  const stats: SmartWeekdayStat[] = rawStats.map((item) => {
    if (!baseAverage || !item.average) return { ...item, weight: 1 };
    const rawWeight = Math.min(Math.max(item.average / baseAverage, 0.6), 1.6);
    const confidence = Math.min(item.samples / 4, 1);
    return { ...item, weight: 1 + (rawWeight - 1) * confidence };
  });

  const totalSamples = totalsByDate.size;
  const coveredWeekdays = stats.filter((item) => item.samples >= 2).length;
  const requiredCoverage = Math.min(openWeekdays.length, Math.max(1, Math.ceil(openWeekdays.length * 0.7)));
  const minimumSamples = Math.max(8, Math.min(14, openWeekdays.length * 2));
  const sampleProgress = Math.min(totalSamples / minimumSamples, 1);
  const coverageProgress = requiredCoverage > 0 ? Math.min(coveredWeekdays / requiredCoverage, 1) : 0;
  const progress = Math.round(Math.min(sampleProgress, coverageProgress) * 100);
  const ready = openWeekdays.length > 0 && totalSamples >= minimumSamples && coveredWeekdays >= requiredCoverage;
  const weightByWeekday = Object.fromEntries(stats.map((item) => [item.weekday, item.weight])) as Record<number, number>;

  return { ready, progress, totalSamples, minimumSamples, coveredWeekdays, requiredCoverage, stats, weightByWeekday };
}

function weightedTargets(dates: string[], total: number, model: SmartDistributionModel, enabled: boolean) {
  if (!dates.length || total <= 0) return {} as Record<string, number>;
  const useSmart = enabled && model.ready;
  const weights = dates.map((date) => useSmart ? (model.weightByWeekday[fromISO(date).getDay()] || 1) : 1);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || dates.length;
  return Object.fromEntries(dates.map((date, index) => [date, total * weights[index] / weightTotal])) as Record<string, number>;
}

const initialCategories = [
  'Café',
  'Laminados',
  'Materia prima',
  'Packaging',
  'Papelería',
  'Limpieza',
  'Mantenimiento',
  'Marketing',
  'Transporte',
  'Comisiones',
  'Otros',
];

const initialRecurringCosts: RecurringCost[] = [];
const initialSales: Sale[] = [];
const initialExpenses: Expense[] = [];

const APP_VERSION = '1.22.6';
const STORAGE_KEY = 'lebu-v1-data';
const LEGACY_STORAGE_KEYS = ['lebu-v011-demo', 'lebu-v010-demo', 'tarasca-v09-demo', 'tarasca-v08-demo', 'tarasca-v07-demo'];

export default function Home() {
  const [profitTarget, setProfitTarget] = useState('');
  const [periodType, setPeriodType] = useState<PeriodType>('monthly');
  const [periodStartDay, setPeriodStartDay] = useState(1);
  const [historicalSummary, setHistoricalSummary] = useState<HistoricalSummary | null>(null);
  const [openWeekdays, setOpenWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [dayExceptions, setDayExceptions] = useState<DayException[]>([]);
  const [recurringCosts, setRecurringCosts] = useState<RecurringCost[]>(initialRecurringCosts);
  const [sales, setSales] = useState<Sale[]>(initialSales);
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [dailySnapshots, setDailySnapshots] = useState<DailySnapshot[]>([]);
  const [categories, setCategories] = useState<string[]>(initialCategories);
  const [soundsEnabled, setSoundsEnabled] = useState(true);
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [smartDistributionEnabled, setSmartDistributionEnabled] = useState(true);
  const [availableCash, setAvailableCash] = useState('');
  const [cashUpdatedAt, setCashUpdatedAt] = useState('');
  const [cashAdjustments, setCashAdjustments] = useState<CashAdjustment[]>([]);
  const { play: playLebuSound, preview: previewLebuSound } = useUiSounds(soundsEnabled);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [quickActionOpen, setQuickActionOpen] = useState(false);
  const [movementImportOpen, setMovementImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('preferences');
  const [activeView, setActiveView] = useState<MainView>('home');
  const [miradaAnalysisWindow, setMiradaAnalysisWindow] = useState<MiradaAnalysisWindowKind>('auto');
  const [simulatorDraft, setSimulatorDraft] = useState<SimulatorDraft>({
    profitTarget: '',
    extraMonthlyCost: '',
    openWeekdays: [0, 1, 2, 3, 4, 5, 6],
  });
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft>({
    profitTarget: '',
    periodType: 'monthly',
    periodStartDay: 1,
    openWeekdays: [0, 1, 2, 3, 4, 5, 6],
    dayExceptions: [],
    recurringCosts: [],
    categories: [...initialCategories],
    smartDistributionEnabled: true,
    availableCash: '',
  });
  const [toast, setToast] = useState('');
  const [registerKind, setRegisterKind] = useState<'sale' | 'expense'>('sale');
  const [showAllMovements, setShowAllMovements] = useState(false);
  const [editingMovement, setEditingMovement] = useState<MovementEditDraft | null>(null);
  const [undoMovement, setUndoMovement] = useState<UndoMovement | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [pushStatus, setPushStatus] = useState<PushSupportStatus>('default');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState('');
  const [pushPreferences, setPushPreferences] = useState<PushPreferences>({ morningEnabled: true, smartChangesEnabled: true, morningTime: '08:00', closingEnabled: false, closingTime: '20:00' });
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [fudoStatus, setFudoStatus] = useState<FudoConnectionStatus>({ connected: false, status: 'disconnected', lastSyncAt: null, lastError: null, lastSyncSalesCount: 0 });
  const [fudoBusy, setFudoBusy] = useState(false);
  const [fudoMessage, setFudoMessage] = useState('');
  const [fudoApiKey, setFudoApiKey] = useState('');
  const [fudoApiSecret, setFudoApiSecret] = useState('');
  const [fudoLastResult, setFudoLastResult] = useState<FudoSyncResult | null>(null);
  const [activationDataSource, setActivationDataSource] = useState<'fudo' | 'manual' | null>(null);
  const [activationDaysSuggestedFromFudo, setActivationDaysSuggestedFromFudo] = useState(false);
  const [teamOverview, setTeamOverview] = useState<TeamOverview>({ members: [], invitations: [] });
  const [teamBusy, setTeamBusy] = useState(false);
  const [teamMessage, setTeamMessage] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InvitabledTeamRole>('operator');
  const [invitePasswordMode, setInvitePasswordMode] = useState(false);
  const [invitePassword, setInvitePassword] = useState('');
  const [businessNameDraft, setBusinessNameDraft] = useState('');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [activationDraft, setActivationDraft] = useState({
    profitTarget: '',
    periodType: 'monthly' as PeriodType,
    openWeekdays: [0, 1, 2, 3, 4, 5, 6] as number[],
    monthlyRecurringTotal: '',
  });
  const [notificationPromptOpen, setNotificationPromptOpen] = useState(false);
  const [startingDataOpen, setStartingDataOpen] = useState(false);
  const [startingDataMode, setStartingDataMode] = useState<'choices' | 'totals'>('choices');
  const [startingDataImportPending, setStartingDataImportPending] = useState(false);
  const [startingDataPromptNotifications, setStartingDataPromptNotifications] = useState(false);
  const [historicalDraft, setHistoricalDraft] = useState({ startDate: '', endDate: '', salesTotal: '', expensesTotal: '', expensesIncludeRecurring: true });
  const [settingsCoveredRecurringIds, setSettingsCoveredRecurringIds] = useState<number[]>([]);
  const [recurringChangeEffective, setRecurringChangeEffective] = useState<Record<number, string>>({});
  const [cashDraftTouched, setCashDraftTouched] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const pendingSmartEventRef = useRef<SmartSyncEvent | null>(null);
  const milestoneStateRef = useRef<{ key: string; breakEven: boolean; goalReached: boolean; dailyReached: boolean } | null>(null);
  const suppressMilestoneSoundRef = useRef(false);

  const [saleDraft, setSaleDraft] = useState({ amount: '', date: todayISO() });
  const [expenseDraft, setExpenseDraft] = useState({ amount: '', date: todayISO(), category: 'Café', note: '', cashPaid: true });
  const [customCategory, setCustomCategory] = useState('');
  const [showCustomCategory, setShowCustomCategory] = useState(false);
  const [showAllExpenseCategories, setShowAllExpenseCategories] = useState(false);
  const [showAdvancedStrategy, setShowAdvancedStrategy] = useState(false);
  const [newRecurring, setNewRecurring] = useState<{ name: string; amount: string; frequency: RecurringFrequency; paymentSchedule: CashPaymentSchedule | null; amountApproximate: boolean; includedInHistoricalSummary: boolean }>({ name: '', amount: '', frequency: 'monthly', paymentSchedule: null, amountApproximate: false, includedInHistoricalSummary: false });
  const [exceptionDate, setExceptionDate] = useState(todayISO());

  useEffect(() => {
    const storedPreference = readThemePreference();
    setThemePreference(storedPreference);
    setResolvedTheme(resolveTheme(storedPreference));
    applyThemePreference(storedPreference);
  }, []);

  useEffect(() => {
    if (themePreference !== 'system' || typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      setResolvedTheme(resolveTheme('system'));
      applyThemePreference('system');
    };
    media.addEventListener('change', handleSystemThemeChange);
    return () => media.removeEventListener('change', handleSystemThemeChange);
  }, [themePreference]);

  function chooseTheme(preference: ThemePreference) {
    setThemePreference(preference);
    setResolvedTheme(resolveTheme(preference));
    saveThemePreference(preference);
  }

  function openSettingsSection(section: SettingsSection) {
    setSettingsSection(section);
    if (section === 'plan') setShowAdvancedStrategy(false);
    setSettingsOpen(true);
  }

  function openCashSettings() {
    setSettingsSection('plan');
    setShowAdvancedStrategy(true);
    setSettingsOpen(true);
    if (typeof window !== 'undefined') {
      window.setTimeout(() => document.getElementById('plan-cash')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    }
  }

  function openRecurringSettings() {
    setSettingsSection('plan');
    setShowAdvancedStrategy(true);
    setSettingsOpen(true);
    if (typeof window !== 'undefined') {
      window.setTimeout(() => document.getElementById('plan-recurring-costs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    }
  }

  function suppressMilestoneSoundOnce() {
    suppressMilestoneSoundRef.current = true;
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        suppressMilestoneSoundRef.current = false;
      }, 800);
    }
  }


  function openSimulator() {
    setQuickActionOpen(false);
    setSimulatorDraft({
      profitTarget,
      extraMonthlyCost: '',
      openWeekdays: [...openWeekdays],
    });
    setActiveView('simulator');
  }

  function resetSimulator() {
    setSimulatorDraft({
      profitTarget,
      extraMonthlyCost: '',
      openWeekdays: [...openWeekdays],
    });
  }

  useEffect(() => {
    if (activeView !== 'simulator') return;

    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeView]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const stored = window.localStorage.getItem(MIRADA_WINDOW_KEY);
      if (stored === 'auto' || stored === 'week' || stored === 'fortnight' || stored === 'month') {
        setMiradaAnalysisWindow(stored);
      }
    } catch {
      // Preferencia local opcional.
    }
  }, [hydrated]);

  const changeMiradaAnalysisWindow = useCallback((windowKind: MiradaAnalysisWindowKind) => {
    setMiradaAnalysisWindow(windowKind);
    try { window.localStorage.setItem(MIRADA_WINDOW_KEY, windowKind); } catch { /* preferencia opcional */ }
  }, []);

  function toggleSimulatorOpenDay(day: number) {
    setSimulatorDraft((current) => {
      const days = current.openWeekdays;
      if (days.includes(day)) {
        if (days.length === 1) return current;
        return { ...current, openWeekdays: days.filter((item) => item !== day) };
      }
      return { ...current, openWeekdays: [...days, day] };
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function hydrateLocalData() {
      try {
        let parsed = await readLocalState<Record<string, unknown>>().catch(() => null);

        // Migración transparente desde las versiones 1.0.x y demos anteriores.
        // Dejamos localStorage como copia de compatibilidad, pero IndexedDB pasa a ser la fuente principal.
        if (!parsed) {
          const legacyRaw = localStorage.getItem(STORAGE_KEY) || LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
          if (legacyRaw) {
            parsed = JSON.parse(legacyRaw) as Record<string, unknown>;
            await writeLocalState(parsed).catch(() => undefined);
          }
        }

        if (cancelled) return;
        if (parsed) {
          if (typeof parsed.profitTarget === 'string') setProfitTarget(parsed.profitTarget);
          if (['weekly', 'biweekly', 'monthly'].includes(String(parsed.periodType))) setPeriodType(parsed.periodType as PeriodType);
          if (Number.isFinite(Number(parsed.periodStartDay))) setPeriodStartDay(Math.min(Math.max(Number(parsed.periodStartDay), 1), 31));
          if (parsed.historicalSummary && typeof parsed.historicalSummary === 'object') setHistoricalSummary(parsed.historicalSummary as HistoricalSummary);
          if (Array.isArray(parsed.openWeekdays) && parsed.openWeekdays.length) setOpenWeekdays(parsed.openWeekdays as number[]);
          if (Array.isArray(parsed.dayExceptions)) setDayExceptions((parsed.dayExceptions as DayException[]).filter((item) => typeof item?.date === 'string' && typeof item?.open === 'boolean'));
          if (Array.isArray(parsed.recurringCosts)) {
            setRecurringCosts(parsed.recurringCosts as RecurringCost[]);
          } else if (Array.isArray(parsed.fixedCosts)) {
            setRecurringCosts((parsed.fixedCosts as { id: number; name: string; amount: string }[]).map((item) => ({ ...item, frequency: 'monthly' as RecurringFrequency })));
          }
          if (Array.isArray(parsed.sales)) setSales(parsed.sales as Sale[]);
          if (Array.isArray(parsed.expenses)) setExpenses(parsed.expenses as Expense[]);
          if (Array.isArray(parsed.dailySnapshots)) setDailySnapshots((parsed.dailySnapshots as DailySnapshot[]).filter((item) => typeof item?.date === 'string' && typeof item?.periodStart === 'string' && typeof item?.periodEnd === 'string'));
          if (Array.isArray(parsed.categories)) setCategories(parsed.categories as string[]);
          if (typeof parsed.soundsEnabled === 'boolean') setSoundsEnabled(parsed.soundsEnabled);
          if (typeof parsed.smartDistributionEnabled === 'boolean') setSmartDistributionEnabled(parsed.smartDistributionEnabled);
          if (typeof parsed.availableCash === 'string' || typeof parsed.availableCash === 'number') setAvailableCash(String(parsed.availableCash));
          if (typeof parsed.cashUpdatedAt === 'string') setCashUpdatedAt(parsed.cashUpdatedAt);
          if (Array.isArray(parsed.cashAdjustments)) setCashAdjustments((parsed.cashAdjustments as CashAdjustment[]).slice(-100));
        }
      } catch {
        // Si es un usuario nuevo, el onboarding se encarga de guiarlo sin abrirle un formulario de golpe.
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }

    void hydrateLocalData();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    setSettingsDraft({
      profitTarget,
      periodType,
      periodStartDay,
      openWeekdays: [...openWeekdays],
      dayExceptions: dayExceptions.map((item) => ({ ...item })),
      recurringCosts: recurringCosts.map((item) => ({ ...item, configHistory: normalizeRecurringHistory(item.configHistory) })),
      categories: [...categories],
      smartDistributionEnabled,
      availableCash,
    });
    setCashDraftTouched(false);
    setRecurringChangeEffective({});
    const currentPeriod = getCurrentPeriod(periodType, periodStartDay);
    const coverageActive = historicalSummaryIsActiveForPeriod(historicalSummary, currentPeriod)
      && historicalSummaryCoversExpenses(historicalSummary)
      && Boolean(historicalSummary?.expensesIncludeRecurring);
    setSettingsCoveredRecurringIds(coverageActive ? coveredRecurringIdsForSummary(historicalSummary, recurringCosts) : []);
    setNewRecurring({ name: '', amount: '', frequency: 'monthly', paymentSchedule: null, amountApproximate: false, includedInHistoricalSummary: coverageActive });
    setExceptionDate(todayISO() < currentPeriod.start ? currentPeriod.start : todayISO() > currentPeriod.end ? currentPeriod.end : todayISO());
  }, [settingsOpen, profitTarget, periodType, periodStartDay, openWeekdays, dayExceptions, recurringCosts, categories, smartDistributionEnabled, historicalSummary, availableCash]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const state = { schemaVersion: 16, profitTarget, periodType, periodStartDay, historicalSummary, openWeekdays, dayExceptions, recurringCosts, sales, expenses, dailySnapshots, categories, soundsEnabled, smartDistributionEnabled, availableCash, cashUpdatedAt, cashAdjustments };

    // IndexedDB es la persistencia principal. Mantenemos un espejo pequeño en localStorage
    // como red de seguridad para navegadores que bloqueen IndexedDB.
    void writeLocalState(state).catch(() => undefined);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Si el navegador rechaza localStorage, IndexedDB sigue siendo suficiente.
    }
  }, [hydrated, profitTarget, periodType, periodStartDay, historicalSummary, openWeekdays, dayExceptions, recurringCosts, sales, expenses, dailySnapshots, categories, soundsEnabled, smartDistributionEnabled, availableCash, cashUpdatedAt, cashAdjustments]);

  useEffect(() => {
    const sync = () => setIsOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  const cloudBusinessState = useMemo<CloudState>(() => ({
    schemaVersion: 16,
    profitTarget,
    periodType,
    periodStartDay,
    historicalSummary,
    openWeekdays,
    dayExceptions,
    recurringCosts,
    sales,
    expenses,
    dailySnapshots,
    categories,
    soundsEnabled,
    smartDistributionEnabled,
    availableCash,
    cashUpdatedAt,
    cashAdjustments,
  }), [profitTarget, periodType, periodStartDay, historicalSummary, openWeekdays, dayExceptions, recurringCosts, sales, expenses, dailySnapshots, categories, soundsEnabled, smartDistributionEnabled, availableCash, cashUpdatedAt, cashAdjustments]);

  const applyCloudBusinessState = useCallback((parsed: CloudState) => {
    if (typeof parsed.profitTarget === 'string') setProfitTarget(parsed.profitTarget);
    if (['weekly', 'biweekly', 'monthly'].includes(String(parsed.periodType))) setPeriodType(parsed.periodType as PeriodType);
    if (Number.isFinite(Number(parsed.periodStartDay))) setPeriodStartDay(Math.min(Math.max(Number(parsed.periodStartDay), 1), 31));
    if (parsed.historicalSummary && typeof parsed.historicalSummary === 'object') setHistoricalSummary(parsed.historicalSummary as HistoricalSummary);
    else setHistoricalSummary(null);
    if (Array.isArray(parsed.openWeekdays) && parsed.openWeekdays.length) setOpenWeekdays(parsed.openWeekdays as number[]);
    if (Array.isArray(parsed.dayExceptions)) setDayExceptions((parsed.dayExceptions as DayException[]).filter((item) => typeof item?.date === 'string' && typeof item?.open === 'boolean'));
    if (Array.isArray(parsed.recurringCosts)) setRecurringCosts(parsed.recurringCosts as RecurringCost[]);
    if (Array.isArray(parsed.sales)) setSales(parsed.sales as Sale[]);
    if (Array.isArray(parsed.expenses)) setExpenses(parsed.expenses as Expense[]);
    if (Array.isArray(parsed.dailySnapshots)) setDailySnapshots((parsed.dailySnapshots as DailySnapshot[]).filter((item) => typeof item?.date === 'string'));
    if (Array.isArray(parsed.categories) && parsed.categories.length) setCategories(parsed.categories as string[]);
    if (typeof parsed.soundsEnabled === 'boolean') setSoundsEnabled(parsed.soundsEnabled);
    if (typeof parsed.smartDistributionEnabled === 'boolean') setSmartDistributionEnabled(parsed.smartDistributionEnabled);
    if (typeof parsed.availableCash === 'string' || typeof parsed.availableCash === 'number') setAvailableCash(String(parsed.availableCash));
    else setAvailableCash('');
    if (typeof parsed.cashUpdatedAt === 'string') setCashUpdatedAt(parsed.cashUpdatedAt);
    else setCashUpdatedAt('');
    if (Array.isArray(parsed.cashAdjustments)) setCashAdjustments((parsed.cashAdjustments as CashAdjustment[]).slice(-100));
    else setCashAdjustments([]);
  }, []);

  const cloud = useLebuCloudSync({
    hydrated,
    online: isOnline,
    state: cloudBusinessState,
    applyState: applyCloudBusinessState,
  });

  const production = useProductionData(cloud.activeBusiness?.businessId || null, hydrated && Boolean(cloud.user));
  const productionTodayStatuses = useMemo(() => buildProductionDayStatus({
    date: todayISO(),
    products: production.products,
    events: production.events,
    sales,
  }), [production.products, production.events, sales]);
  const productionAnalysis = useMemo(() => buildProductionAnalysis({
    products: production.products,
    events: production.events,
    days: production.days,
    sales,
    today: todayISO(),
  }), [production.products, production.events, production.days, sales]);
  const productionHomeAlert = useMemo(() => buildProductionHomeAlert(productionTodayStatuses), [productionTodayStatuses]);

  const canOperateMovements = !cloud.user || cloud.role === 'owner' || cloud.role === 'admin' || cloud.role === 'operator';
  const canManageBusiness = !cloud.user || cloud.role === 'owner' || cloud.role === 'admin';
  const canImportMovements = canManageBusiness;
  const canManageTeam = Boolean(cloud.user && (cloud.role === 'owner' || cloud.role === 'admin'));

  function movementAuditForCurrentUser() {
    if (!cloud.user) return {};
    const email = cloud.user.email || undefined;
    return {
      createdBy: cloud.user.id,
      createdByEmail: email,
      createdAt: new Date().toISOString(),
      updatedBy: cloud.user.id,
      updatedByEmail: email,
    };
  }

  function movementUpdateAuditForCurrentUser() {
    if (!cloud.user) return {};
    return { updatedBy: cloud.user.id, updatedByEmail: cloud.user.email || undefined };
  }

  function canEditMovement(movement: Movement) {
    if (movement.kind === 'sale' && movement.source === 'fudo') return false;
    if (!cloud.user) return true;
    if (cloud.role === 'owner' || cloud.role === 'admin') return true;
    if (cloud.role !== 'operator') return false;
    return Boolean(movement.createdBy && movement.createdBy === cloud.user.id);
  }

  useEffect(() => {
    if (!hydrated) return;
    if (typeof window === 'undefined') return;

    // El onboarding puede abrirse explícitamente (por ejemplo después de "Borrar datos")
    // o automáticamente para un dispositivo realmente nuevo. Nunca programes una segunda
    // apertura mientras ya hay una sesión activa: ese segundo disparo reseteaba el paso y
    // el borrador en mitad de la configuración.
    if (onboardingOpen) return;
    if (localStorage.getItem(ONBOARDING_KEY) === '1') return;

    const hasExistingData = parseMoney(profitTarget) > 0 || Boolean(historicalSummary) || sales.length > 0 || expenses.length > 0 || recurringCosts.length > 0 || dailySnapshots.length > 0;
    if (hasExistingData) {
      localStorage.setItem(ONBOARDING_KEY, '1');
      return;
    }

    const timer = window.setTimeout(() => {
      if (!settingsOpen && !registerOpen && !movementImportOpen && !editingMovement) {
        setActivationDraft({ profitTarget: '', periodType: 'monthly', openWeekdays: [0, 1, 2, 3, 4, 5, 6], monthlyRecurringTotal: '' });
        setActivationDataSource(null);
        setActivationDaysSuggestedFromFudo(false);
        setOnboardingStep(0);
        setOnboardingOpen(true);
      }
    }, cloud.user && cloud.status === 'connecting' ? 1600 : 500);

    return () => window.clearTimeout(timer);
  }, [hydrated, onboardingOpen, profitTarget, historicalSummary, sales.length, expenses.length, recurringCosts.length, dailySnapshots.length, settingsOpen, registerOpen, movementImportOpen, editingMovement, cloud.user, cloud.status]);



  function closeOnboarding(markSeen = true) {
    setOnboardingOpen(false);
    if (markSeen && typeof window !== 'undefined') localStorage.setItem(ONBOARDING_KEY, '1');
  }



  function toggleActivationOpenDay(day: number) {
    setActivationDraft((current) => {
      if (current.openWeekdays.includes(day)) {
        if (current.openWeekdays.length === 1) return current;
        return { ...current, openWeekdays: current.openWeekdays.filter((item) => item !== day) };
      }
      return { ...current, openWeekdays: [...current.openWeekdays, day] };
    });
  }

  function commitActivationPlan() {
    suppressMilestoneSoundOnce();
    const target = parseMoney(activationDraft.profitTarget);
    if (!target) return false;
    const recurringTotal = parseMoney(activationDraft.monthlyRecurringTotal);
    setProfitTarget(String(target));
    setPeriodType(activationDraft.periodType);
    setPeriodStartDay(1);
    setOpenWeekdays([...activationDraft.openWeekdays]);
    setDayExceptions([]);
    setRecurringCosts(recurringTotal > 0 ? [{ id: createEntityId(), name: 'Gastos fijos iniciales', amount: String(recurringTotal), frequency: 'monthly' }] : []);
    pendingSmartEventRef.current = { id: `activation-${Date.now()}`, kind: 'settings_changed', occurredAt: new Date().toISOString() };
    return true;
  }

  function finishActivationWith(mode: 'import' | 'totals' | 'zero') {
    if (!commitActivationPlan()) return;
    closeOnboarding(true);
    const nextPeriod = getCurrentPeriod(activationDraft.periodType, 1);
    if (mode === 'import') {
      setStartingDataImportPending(true);
      setMovementImportOpen(true);
      return;
    }
    if (mode === 'totals') {
      setStartingDataPromptNotifications(true);
      setStartingDataMode('totals');
      setHistoricalDraft(defaultHistoricalDraft(nextPeriod, null));
      setStartingDataOpen(true);
      return;
    }
    maybeSuggestNotifications();
    showSavedToast('Tu primer objetivo ya está listo.');
  }

  function finishActivationWithFudo() {
    if (!fudoStatus.connected) return;
    if (!commitActivationPlan()) return;
    closeOnboarding(true);
    maybeSuggestNotifications();
    showSavedToast('FUDO conectado. Lebu ya está mirando tu operación.');
  }

  const refreshTeam = useCallback(async (targetBusinessId?: string) => {
    const businessId = targetBusinessId || cloud.businessId;
    if (!businessId || !cloud.user || !isOnline) return;
    try {
      const overview = await fetchTeamOverview(businessId);
      setTeamOverview(overview);
    } catch (error) {
      setTeamMessage(error instanceof Error ? error.message : 'No se pudo cargar el equipo.');
    }
  }, [cloud.businessId, cloud.user, isOnline]);

  useEffect(() => {
    if (!settingsOpen || !cloud.user || !cloud.businessId || !isOnline) return;
    void refreshTeam();
  }, [settingsOpen, cloud.user, cloud.businessId, isOnline, refreshTeam]);

  useEffect(() => {
    if (cloud.role !== 'owner' && inviteRole === 'admin') setInviteRole('operator');
  }, [cloud.role, inviteRole]);

  useEffect(() => {
    setBusinessNameDraft(cloud.activeBusiness?.name || '');
  }, [cloud.activeBusiness?.businessId, cloud.activeBusiness?.name]);

  useEffect(() => {
    if (!hydrated || !cloud.user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('team_invite') === '1') setInvitePasswordMode(true);
  }, [hydrated, cloud.user]);

  async function handleInviteMember() {
    if (!cloud.businessId || !inviteEmail.trim() || !canManageTeam) return;
    setTeamBusy(true); setTeamMessage('');
    try {
      const result = await inviteTeamMember(cloud.businessId, inviteEmail, inviteRole);
      setTeamMessage(result.message);
      setInviteEmail('');
      await refreshTeam();
    } catch (error) {
      setTeamMessage(error instanceof Error ? error.message : 'No se pudo invitar al miembro.');
    } finally { setTeamBusy(false); }
  }

  async function handleMemberRole(userId: string, nextRole: InvitabledTeamRole) {
    if (!cloud.businessId) return;
    setTeamBusy(true); setTeamMessage('');
    try { await updateTeamMemberRole(cloud.businessId, userId, nextRole); await refreshTeam(); }
    catch (error) { setTeamMessage(error instanceof Error ? error.message : 'No se pudo cambiar el rol.'); }
    finally { setTeamBusy(false); }
  }

  async function handleRemoveMember(userId: string) {
    if (!cloud.businessId || !confirm('¿Quitar a esta persona del comercio?')) return;
    setTeamBusy(true); setTeamMessage('');
    try { await removeTeamMember(cloud.businessId, userId); await refreshTeam(); }
    catch (error) { setTeamMessage(error instanceof Error ? error.message : 'No se pudo quitar al miembro.'); }
    finally { setTeamBusy(false); }
  }

  async function handleCancelInvitation(invitationId: string) {
    setTeamBusy(true); setTeamMessage('');
    try { await cancelTeamInvitation(invitationId); await refreshTeam(); }
    catch (error) { setTeamMessage(error instanceof Error ? error.message : 'No se pudo cancelar la invitación.'); }
    finally { setTeamBusy(false); }
  }

  async function handleSwitchBusiness(nextBusinessId: string) {
    setTeamBusy(true); setTeamMessage('');
    try {
      setTeamOverview({ members: [], invitations: [] });
      await cloud.switchBusiness(nextBusinessId);
      await refreshTeam(nextBusinessId);
    }
    catch (error) { setTeamMessage(error instanceof Error ? error.message : 'No se pudo cambiar de comercio.'); }
    finally { setTeamBusy(false); }
  }

  async function handleRenameBusiness() {
    if (!cloud.businessId || !canManageBusiness || businessNameDraft.trim().length < 2) return;
    setTeamBusy(true); setTeamMessage('');
    try {
      await renameBusiness(cloud.businessId, businessNameDraft);
      await cloud.refreshBusinesses();
      setTeamMessage('Nombre del comercio actualizado.');
    } catch (error) {
      setTeamMessage(error instanceof Error ? error.message : 'No se pudo cambiar el nombre del comercio.');
    } finally { setTeamBusy(false); }
  }

  async function handleInvitePassword() {
    if (invitePassword.length < 8) return;
    setTeamBusy(true); setTeamMessage('');
    try {
      await updateAccountPassword(invitePassword);
      setInvitePassword(''); setInvitePasswordMode(false);
      setTeamMessage('Contraseña guardada. Ya podés volver a entrar con mail y contraseña.');
      const url = new URL(window.location.href); url.searchParams.delete('team_invite'); window.history.replaceState({}, '', url.toString());
    } catch (error) { setTeamMessage(error instanceof Error ? error.message : 'No se pudo guardar la contraseña.'); }
    finally { setTeamBusy(false); }
  }

  useEffect(() => {
    if (cloud.user?.email && !accountEmail) setAccountEmail(cloud.user.email);
  }, [cloud.user?.email, accountEmail]);

  async function handleCloudAuth(mode: 'signin' | 'signup') {
    if (!accountEmail.trim() || accountPassword.length < 6) return;
    setAccountBusy(true);
    try {
      if (mode === 'signin') await cloud.signIn(accountEmail, accountPassword);
      else await cloud.signUp(accountEmail, accountPassword);
      setAccountPassword('');
    } catch {
      // El hook deja el mensaje de error listo para mostrar.
    } finally {
      setAccountBusy(false);
    }
  }

  const refreshFudoStatus = useCallback(async () => {
    if (!cloud.user || !cloud.businessId || !isOnline) {
      setFudoStatus({ connected: false, status: 'disconnected', lastSyncAt: null, lastError: null, lastSyncSalesCount: 0 });
      return;
    }
    try {
      const status = await getFudoStatus(cloud.businessId);
      setFudoStatus(status);
      if (status.lastError) setFudoMessage(status.lastError);
    } catch (error) {
      setFudoMessage(error instanceof Error ? error.message : 'No se pudo consultar FUDO.');
    }
  }, [cloud.user, cloud.businessId, isOnline]);

  useEffect(() => {
    void refreshFudoStatus();
  }, [refreshFudoStatus]);

  useEffect(() => {
    if (fudoStatus.connected && activationDataSource === null) setActivationDataSource('fudo');
  }, [fudoStatus.connected, activationDataSource]);

  useEffect(() => {
    if (!onboardingOpen || !fudoStatus.connected || activationDaysSuggestedFromFudo) return;
    const weekdays: number[] = Array.from(new Set<number>(sales.filter((sale) => sale.source === 'fudo').map((sale) => fromISO(sale.date).getDay()))).sort((a, b) => a - b);
    if (!weekdays.length) return;
    setActivationDraft((current) => ({ ...current, openWeekdays: weekdays }));
    setActivationDaysSuggestedFromFudo(true);
  }, [onboardingOpen, fudoStatus.connected, activationDaysSuggestedFromFudo, sales]);

  async function handleConnectFudo() {
    if (!cloud.businessId || !cloud.user || !canManageBusiness || !fudoApiKey.trim() || !fudoApiSecret.trim()) return;
    setFudoBusy(true); setFudoMessage(''); setFudoLastResult(null);
    try {
      await connectFudo(cloud.businessId, fudoApiKey.trim(), fudoApiSecret.trim());
      setFudoApiKey(''); setFudoApiSecret('');
      setFudoMessage('FUDO conectado. Trayendo los últimos 90 días…');
      const result = await syncFudo(cloud.businessId, 90);
      setFudoLastResult(result);
      await cloud.syncNow();
      await refreshFudoStatus();
      setFudoMessage(`FUDO conectado · ${number.format(result.imported)} ventas sincronizadas.`);
      setActivationDataSource('fudo');
    } catch (error) {
      setFudoMessage(error instanceof Error ? error.message : 'No se pudo conectar FUDO.');
      await refreshFudoStatus();
    } finally { setFudoBusy(false); }
  }

  async function handleFudoSync() {
    if (!cloud.businessId || !fudoStatus.connected || !isOnline) return;
    setFudoBusy(true); setFudoMessage(''); setFudoLastResult(null);
    try {
      const result = await syncFudo(cloud.businessId, fudoStatus.lastSyncAt ? 14 : 90);
      setFudoLastResult(result);
      await cloud.syncNow();
      await refreshFudoStatus();
      setFudoMessage(`${number.format(result.imported)} ventas revisadas desde FUDO.`);
    } catch (error) {
      setFudoMessage(error instanceof Error ? error.message : 'No se pudo sincronizar FUDO.');
      await refreshFudoStatus();
    } finally { setFudoBusy(false); }
  }

  async function handleDisconnectFudo() {
    if (!cloud.businessId || !canManageBusiness) return;
    if (!confirm('¿Desconectar FUDO? Las ventas ya importadas quedan en Lebu, pero dejan de actualizarse automáticamente.')) return;
    setFudoBusy(true); setFudoMessage('');
    try {
      await disconnectFudo(cloud.businessId);
      setFudoStatus({ connected: false, status: 'disconnected', lastSyncAt: null, lastError: null, lastSyncSalesCount: 0 });
      setActivationDataSource(null);
      setFudoMessage('FUDO desconectado.');
    } catch (error) {
      setFudoMessage(error instanceof Error ? error.message : 'No se pudo desconectar FUDO.');
    } finally { setFudoBusy(false); }
  }

  useEffect(() => {
    if (!hydrated) return;
    setPushStatus(getPushSupportStatus());
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || pushStatus !== 'enabled' || !isOnline) return;
    let cancelled = false;
    void getPushPreferences()
      .then((preferences) => { if (!cancelled) setPushPreferences(preferences); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [hydrated, pushStatus, isOnline]);

  const period = useMemo(() => getCurrentPeriod(periodType, periodStartDay), [periodType, periodStartDay]);
  const settingsPeriod = useMemo(() => getCurrentPeriod(settingsDraft.periodType, settingsDraft.periodStartDay), [settingsDraft.periodType, settingsDraft.periodStartDay]);
  useEffect(() => {
    if (!settingsOpen) return;
    if (exceptionDate < settingsPeriod.start || exceptionDate > settingsPeriod.end) {
      const today = todayISO();
      setExceptionDate(today < settingsPeriod.start ? settingsPeriod.start : today > settingsPeriod.end ? settingsPeriod.end : today);
    }
  }, [settingsOpen, settingsPeriod.start, settingsPeriod.end, exceptionDate]);
  const settingsRemainingOpenDays = useMemo(
    () => countOpenDays(settingsPeriod.start, settingsPeriod.end, settingsDraft.openWeekdays, todayISO(), settingsDraft.dayExceptions),
    [settingsPeriod, settingsDraft.openWeekdays, settingsDraft.dayExceptions],
  );
  const settingsRecurringTotal = useMemo(
    () => settingsDraft.recurringCosts.reduce((sum, item) => sum + prorateRecurringCost(item, settingsPeriod.start, settingsPeriod.end, settingsDraft.periodType, settingsPeriod.start, settingsPeriod.end), 0),
    [settingsDraft.recurringCosts, settingsPeriod],
  );

  const analysisSales = useMemo(() => {
    if (!historicalSummary || !historicalSummaryCoversSales(historicalSummary)) return sales;
    return sales.filter((sale) => sale.date < historicalSummary.startDate || sale.date > historicalSummary.endDate);
  }, [sales, historicalSummary]);
  const analysisExpenses = useMemo(() => {
    if (!historicalSummary || !historicalSummaryCoversExpenses(historicalSummary)) return expenses;
    return expenses.filter((expense) => expense.date < historicalSummary.startDate || expense.date > historicalSummary.endDate);
  }, [expenses, historicalSummary]);
  const smartModel = useMemo(() => buildSmartDistributionModel(analysisSales, openWeekdays), [analysisSales, openWeekdays]);

  const result = useMemo(() => {
    const target = parseMoney(profitTarget);
    const hasTarget = target > 0;
    const historicalSummaryActive = Boolean(
      historicalSummary
      && historicalSummary.startDate >= period.start
      && historicalSummary.endDate <= period.end
      && historicalSummary.startDate <= historicalSummary.endDate,
    );
    const summaryCoversSales = historicalSummaryActive && historicalSummaryCoversSales(historicalSummary);
    const summaryCoversExpenses = historicalSummaryActive && historicalSummaryCoversExpenses(historicalSummary);
    const dateCoveredBySummary = (date: string, kind: 'sale' | 'expense') => Boolean(
      historicalSummaryActive
      && historicalSummary
      && (kind === 'sale' ? summaryCoversSales : summaryCoversExpenses)
      && date >= historicalSummary.startDate
      && date <= historicalSummary.endDate,
    );
    const periodSales = sales.filter((sale) => isWithinPeriod(sale.date, period.start, period.end) && !dateCoveredBySummary(sale.date, 'sale'));
    const periodExpenses = expenses.filter((expense) => isWithinPeriod(expense.date, period.start, period.end) && !dateCoveredBySummary(expense.date, 'expense'));
    const historicalSales = summaryCoversSales && historicalSummary ? parseMoney(historicalSummary.salesTotal) : 0;
    const historicalExpenses = summaryCoversExpenses && historicalSummary ? parseMoney(historicalSummary.expensesTotal) : 0;
    const soldSoFar = historicalSales + periodSales.reduce((sum, sale) => sum + parseMoney(sale.amount), 0);
    const coveredRecurringIds = new Set(
      summaryCoversExpenses && historicalSummary?.expensesIncludeRecurring
        ? coveredRecurringIdsForSummary(historicalSummary, recurringCosts)
        : [],
    );
    const recurringBreakdown = recurringCosts.map((item) => {
      const attributed = prorateRecurringCost(item, period.start, period.end, periodType, period.start, period.end);
      const coveredByHistoricalSummary = historicalSummaryActive && coveredRecurringIds.has(item.id);
      const coveredAmount = coveredByHistoricalSummary
        ? recurringCoveredAmountForSummary(item, historicalSummary, period, periodType)
        : 0;
      return { ...item, attributed, coveredAmount, coveredByHistoricalSummary };
    });
    const recurringConfiguredTotal = recurringBreakdown.reduce((sum, item) => sum + item.attributed, 0);
    const recurringCoveredTotal = recurringBreakdown.reduce((sum, item) => sum + item.coveredAmount, 0);
    // Regla 1.20.4: "ya incluido" evita duplicar lo que el acumulado realmente cubre, pero
    // no borra repeticiones futuras. Ej.: si un sueldo semanal está incluido hasta el 24 y queda
    // otra semana dentro del mes, esa semana pendiente sí forma parte del costo del período.
    const recurringTotal = Math.max(recurringConfiguredTotal - recurringCoveredTotal, 0);
    const recurringReconciliation = reconcileRecurringExpenses(periodExpenses, recurringCosts);
    const detailedExpensesTotal = recurringReconciliation.unlinked.reduce((sum, item) => sum + parseMoney(String(item.amount)), 0);
    // Un gasto real vinculado se concilia contra la ocurrencia recurrente, pero un pago parcial
    // no reduce la obligación económica. Ej.: sueldo 700k, pagados 50k => el costo sigue siendo
    // 700k y quedan 650k pendientes en Caja. Si el total real supera lo previsto (ej. 150k vs
    // 140k), aplicamos únicamente ese exceso como desvío económico.
    const recurringActualAdjustment = recurringReconciliation.delta;
    // Mantenemos el acumulado como un bloque no clasificado para que agregar detalle recurrente
    // tampoco altere la tasa observada ni, por arrastre, el objetivo diario.
    const variableSpent = historicalExpenses + detailedExpensesTotal + recurringActualAdjustment;
    const totalExpenses = recurringTotal + variableSpent;
    const currentProfit = soldSoFar - totalExpenses;
    const missingProfit = Math.max(target - currentProfit, 0);
    const goalReached = hasTarget && currentProfit >= target;
    const surplusProfit = Math.max(currentProfit - target, 0);

    // Un acumulado histórico puede mezclar alquiler, sueldos, compras y otros conceptos.
    // No lo usamos para inferir una tasa variable: sería asumir que todos esos gastos crecen
    // con las ventas. La tasa se aprende solamente de movimientos detallados posteriores al
    // acumulado; mientras no haya muestra suficiente, Lebu trata lo ya gastado como costo
    // comprometido y no inventa costos futuros.
    // 1.21.8: un gasto detallado NO implica que sea variable. Un Excel/FUDO puede traer
    // sueldos, alquiler, servicios, compras puntuales y otros costos que no crecen con cada venta.
    // Hasta que exista una clasificación explícita de costos variables, Lebu no infiere una tasa
    // multiplicando todos los gastos observados contra las ventas: hacerlo puede inflar brutalmente
    // el objetivo diario (por ejemplo, interpretar 6M de gastos del mes como 90% de cada venta futura).
    const variableRate = 0;
    const contributionMargin = 1;
    const additionalSalesNeeded = missingProfit / contributionMargin;
    const todayValue = todayISO();
    const remainingOpenDates = listOpenDates(period.start, period.end, openWeekdays, dayExceptions).filter((date) => date >= todayValue);
    const remainingOpenDays = remainingOpenDates.length;
    const smartActive = smartDistributionEnabled && smartModel.ready;
    const smartTargetsByDate = weightedTargets(remainingOpenDates, additionalSalesNeeded, smartModel, smartActive);

    // La barra principal no mide "ganancia ya obtenida": mide qué parte del camino de ventas
    // necesario para llegar a la ganancia objetivo ya fue recorrido. Así una venta siempre hace
    // visible el avance, incluso mientras todavía estamos cubriendo gastos.
    // Cuando la tasa variable queda limitada (máximo 90%), cualquier gasto ya realizado que
    // quede por encima de esa tasa sigue siendo un costo comprometido y no desaparece del camino.
    const variableCostExcess = Math.max(variableSpent - (soldSoFar * variableRate), 0);
    const committedCosts = recurringTotal + variableCostExcess;
    const salesNeededForGoal = hasTarget
      ? (committedCosts + target) / contributionMargin
      : 0;
    const goalPathProgress = salesNeededForGoal > 0
      ? Math.min(Math.max((soldSoFar / salesNeededForGoal) * 100, 0), 100)
      : 0;

    // Hito de "gastos cubiertos" con exactamente el mismo modelo de costos usado por el
    // objetivo. Por eso siempre queda antes que la ganancia objetivo y no se mueve al vender más
    // salvo que cambie el patrón real de gastos.
    const breakEvenSalesTarget = committedCosts / contributionMargin;
    const breakEvenProgress = salesNeededForGoal > 0
      ? Math.min(Math.max((breakEvenSalesTarget / salesNeededForGoal) * 100, 0), 100)
      : 0;

    // El tiempo no rellena la barra: solamente mueve esta referencia. En modo inteligente se
    // respeta el peso de cada día; sin historial suficiente, el reparto es parejo.
    const allOpenDates = listOpenDates(period.start, period.end, openWeekdays, dayExceptions);
    const fullPeriodTargets = weightedTargets(allOpenDates, salesNeededForGoal, smartModel, smartActive);
    const expectedSalesByToday = allOpenDates
      .filter((date) => date <= todayValue)
      .reduce((sum, date) => sum + Number(fullPeriodTargets[date] || 0), 0);
    const expectedProgressToday = salesNeededForGoal > 0
      ? Math.min(Math.max((expectedSalesByToday / salesNeededForGoal) * 100, 0), 100)
      : 0;
    const pathVsExpectedSales = soldSoFar - expectedSalesByToday;
    const targetDate = remainingOpenDates[0] || null;
    const dailyNeeded = targetDate ? Number(smartTargetsByDate[targetDate] || 0) : 0;
    const profitProgress = target > 0 ? Math.min(Math.max((currentProfit / target) * 100, 0), 100) : 0;

    const betterDayScenario = Math.ceil((dailyNeeded * 1.25) / 1000) * 1000;
    const profitContributionFromScenario = betterDayScenario * contributionMargin;
    const remainingProfitAfterScenario = Math.max(missingProfit - profitContributionFromScenario, 0);
    const remainingSalesAfterScenario = remainingProfitAfterScenario / contributionMargin;
    const nextDates = remainingOpenDates.slice(1);
    const nextTargets = weightedTargets(nextDates, remainingSalesAfterScenario, smartModel, smartActive);
    const nextDaily = nextDates.length ? Number(nextTargets[nextDates[0]] || 0) : 0;
    const todayIsOpen = isDateOpen(todayValue, openWeekdays, dayExceptions);
    const completedSalesByDate = periodSales
      .filter((sale) => sale.date < todayValue && isDateOpen(sale.date, openWeekdays, dayExceptions))
      .reduce<Record<string, number>>((acc, sale) => {
        acc[sale.date] = (acc[sale.date] || 0) + parseMoney(sale.amount);
        return acc;
      }, {});
    const completedOpenDays = Object.keys(completedSalesByDate).length;
    const completedSales = Object.values(completedSalesByDate).reduce((sum, amount) => sum + amount, 0);
    const observedDailySales = completedOpenDays > 0 ? completedSales / completedOpenDays : 0;
    const tomorrowISO = toLocalISO(addDays(fromISO(todayValue), 1));
    const futureOpenDays = tomorrowISO <= period.end ? countOpenDays(period.start, period.end, openWeekdays, tomorrowISO, dayExceptions) : 0;
    const projectedFutureSales = observedDailySales * futureOpenDays;
    const projectedTotalSales = soldSoFar + projectedFutureSales;
    const projectedVariableSpent = variableSpent + projectedFutureSales * variableRate;
    const projectedProfit = projectedTotalSales - recurringTotal - projectedVariableSpent;
    const projectionAvailable = completedOpenDays > 0 && hasTarget;
    const projectedGap = projectionAvailable ? target - projectedProfit : 0;

    const salesByDate = periodSales.reduce<Record<string, number>>((acc, sale) => {
      acc[sale.date] = (acc[sale.date] || 0) + parseMoney(sale.amount);
      return acc;
    }, {});

    return {
      target,
      hasTarget,
      historicalSummaryActive,
      historicalSales,
      historicalExpenses,
      soldSoFar,
      recurringBreakdown,
      recurringConfiguredTotal,
      recurringCoveredTotal,
      recurringTotal,
      recurringActualAdjustment,
      recurringReconciliationGroups: recurringReconciliation.groups,
      variableSpent,
      totalExpenses,
      currentProfit,
      missingProfit,
      goalReached,
      surplusProfit,
      variableRate,
      contributionMargin,
      additionalSalesNeeded,
      salesNeededForGoal,
      goalPathProgress,
      breakEvenSalesTarget,
      breakEvenProgress,
      expectedSalesByToday,
      expectedProgressToday,
      pathVsExpectedSales,
      remainingOpenDays,
      dailyNeeded,
      smartActive,
      smartTargetsByDate,
      remainingOpenDates,
      targetDate,
      profitProgress,
      betterDayScenario,
      nextDaily,
      todayIsOpen,
      completedOpenDays,
      observedDailySales,
      futureOpenDays,
      projectedTotalSales,
      projectedProfit,
      projectionAvailable,
      projectedGap,
      salesByDate,
    };
  }, [profitTarget, historicalSummary, recurringCosts, sales, expenses, period, openWeekdays, dayExceptions, smartDistributionEnabled, smartModel]);

  const recurringPaymentProgressById = useMemo(() => {
    const reconciliation = reconcileRecurringExpenses(expenses, recurringCosts);
    const groupsByRecurring = new Map<number, typeof reconciliation.groups>();
    for (const group of reconciliation.groups) {
      const current = groupsByRecurring.get(group.recurringCostId) || [];
      current.push(group);
      groupsByRecurring.set(group.recurringCostId, current);
    }

    const today = todayISO();
    const progress = new Map<number, {
      occurrenceDate: string;
      expected: number;
      paid: number;
      pending: number;
      overpaid: number;
      status: 'pending' | 'partial' | 'paid' | 'over';
      expenseCount: number;
      priorBalance: boolean;
    }>();

    for (const item of recurringCosts) {
      const currentOccurrenceDate = recurringOccurrenceDateForExpense(item, today);
      const groups = [...(groupsByRecurring.get(Number(item.id)) || [])].sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
      const priorOutstanding = groups.find((group) => group.occurrenceDate < currentOccurrenceDate && group.outstanding > 0);
      const currentGroup = groups.find((group) => group.occurrenceDate === currentOccurrenceDate);
      const selected = priorOutstanding || currentGroup || null;
      const occurrenceDate = selected?.occurrenceDate || currentOccurrenceDate;
      const expected = selected?.expected ?? expectedRecurringAmount(item, occurrenceDate);
      const paid = Math.max(selected?.actual ?? 0, 0);
      const pending = Math.max(expected - paid, 0);
      const overpaid = Math.max(paid - expected, 0);
      const status: 'pending' | 'partial' | 'paid' | 'over' = overpaid > 0
        ? 'over'
        : paid >= expected && expected > 0
          ? 'paid'
          : paid > 0
            ? 'partial'
            : 'pending';
      progress.set(Number(item.id), {
        occurrenceDate,
        expected,
        paid,
        pending,
        overpaid,
        status,
        expenseCount: selected?.expenseCount ?? 0,
        priorBalance: occurrenceDate < currentOccurrenceDate,
      });
    }
    return progress;
  }, [expenses, recurringCosts]);

  const cashGuidance = useMemo(() => buildCashGuidance({
    today: todayISO(),
    availableCash,
    cashUpdatedAt,
    recurringCosts,
    historicalSummary,
    currentPeriod: period,
    periodType,
    openWeekdays,
    dayExceptions,
    sales,
    expenses,
    horizonDays: 45,
  }), [availableCash, cashUpdatedAt, recurringCosts, historicalSummary, period, periodType, openWeekdays, dayExceptions, sales, expenses]);

  const cashReconciliationDifference = cashDraftTouched
    ? parseMoney(settingsDraft.availableCash) - cashGuidance.estimatedCash
    : 0;

  const simulatorResult = useMemo(() => {
    const target = parseMoney(simulatorDraft.profitTarget);
    const hasTarget = target > 0;
    const extraMonthlyCost = parseSignedMoney(simulatorDraft.extraMonthlyCost);
    let extraPeriodCost = 0;
    if (extraMonthlyCost !== 0) {
      if (periodType === 'monthly') {
        // Un ciclo mensual personalizado (ej. 10→9) representa igualmente un mes completo.
        extraPeriodCost = extraMonthlyCost;
      } else {
        for (let date = fromISO(period.start); date <= fromISO(period.end); date = addDays(date, 1)) {
          extraPeriodCost += extraMonthlyCost / daysInMonth(date);
        }
      }
    }
    const recurringTotal = Math.max(result.recurringTotal + extraPeriodCost, 0);
    const totalExpenses = recurringTotal + result.variableSpent;
    const currentProfit = result.soldSoFar - totalExpenses;
    const missingProfit = Math.max(target - currentProfit, 0);
    const contributionMargin = result.contributionMargin;
    const additionalSalesNeeded = missingProfit / contributionMargin;
    const today = todayISO();
    const remainingOpenDates = listOpenDates(period.start, period.end, simulatorDraft.openWeekdays, dayExceptions).filter((date) => date >= today);
    const remainingOpenDays = remainingOpenDates.length;
    const simulatorSmartModel = buildSmartDistributionModel(analysisSales, simulatorDraft.openWeekdays);
    const smartActive = smartDistributionEnabled && simulatorSmartModel.ready;
    const targetsByDate = weightedTargets(remainingOpenDates, additionalSalesNeeded, simulatorSmartModel, smartActive);
    const firstOpenDate = remainingOpenDates[0] || null;
    const dailyNeeded = firstOpenDate ? Number(targetsByDate[firstOpenDate] || 0) : 0;
    const tomorrow = toLocalISO(addDays(fromISO(today), 1));
    const futureOpenDays = tomorrow <= period.end
      ? countOpenDays(period.start, period.end, simulatorDraft.openWeekdays, tomorrow, dayExceptions)
      : 0;
    const projectedFutureSales = result.observedDailySales * futureOpenDays;
    const projectedTotalSales = result.soldSoFar + projectedFutureSales;
    const projectedVariableSpent = result.variableSpent + projectedFutureSales * result.variableRate;
    const projectedProfit = projectedTotalSales - recurringTotal - projectedVariableSpent;
    const projectionAvailable = result.completedOpenDays > 0 && hasTarget;
    const projectedGap = projectionAvailable ? target - projectedProfit : 0;
    const dailyDelta = dailyNeeded - result.dailyNeeded;
    const salesDelta = additionalSalesNeeded - result.additionalSalesNeeded;
    const openDaysDelta = remainingOpenDays - result.remainingOpenDays;
    const goalReached = hasTarget && currentProfit >= target;

    let verdictTitle = 'Mové una variable y mirá qué cambia.';
    let verdictBody = 'Lebu usa tus ventas, gastos y ritmo real como punto de partida. Este escenario no modifica tu plan.';
    let verdictTone: LebuInsight['tone'] = 'neutral';
    if (hasTarget && remainingOpenDays === 0 && !goalReached) {
      verdictTitle = 'Con este calendario no quedan días para vender.';
      verdictBody = `Todavía faltarían ${money.format(additionalSalesNeeded)} de ventas estimadas para alcanzar el objetivo simulado.`;
      verdictTone = 'warning';
    } else if (goalReached) {
      verdictTitle = 'Con este escenario, la meta ya estaría adentro.';
      verdictBody = `La ganancia actual cubriría el objetivo de ${money.format(target)} incluso contemplando el cambio de costos.`;
      verdictTone = 'positive';
    } else if (Math.abs(dailyDelta) >= 1000 && remainingOpenDays > 0) {
      const harder = dailyDelta > 0;
      verdictTitle = harder ? 'Este escenario exige más por día.' : 'Este escenario afloja el objetivo diario.';
      verdictBody = `${harder ? 'Necesitarías' : 'Necesitarías aproximadamente'} ${money.format(Math.abs(dailyDelta))} ${harder ? 'más' : 'menos'} en el próximo día abierto que con tu plan actual.`;
      verdictTone = harder ? 'warning' : 'positive';
    } else if (hasTarget) {
      verdictTitle = 'El esfuerzo diario cambia poco.';
      verdictBody = `El próximo objetivo quedaría cerca de ${money.format(dailyNeeded)} con ${remainingOpenDays} días abiertos restantes.`;
    }

    return {
      target,
      hasTarget,
      extraMonthlyCost,
      extraPeriodCost,
      recurringTotal,
      totalExpenses,
      currentProfit,
      missingProfit,
      additionalSalesNeeded,
      remainingOpenDates,
      remainingOpenDays,
      dailyNeeded,
      targetsByDate,
      smartActive,
      futureOpenDays,
      projectedProfit,
      projectionAvailable,
      projectedGap,
      dailyDelta,
      salesDelta,
      openDaysDelta,
      goalReached,
      verdictTitle,
      verdictBody,
      verdictTone,
    };
  }, [simulatorDraft, period.start, period.end, result.recurringTotal, result.variableSpent, result.soldSoFar, result.contributionMargin, result.observedDailySales, result.variableRate, result.completedOpenDays, result.dailyNeeded, result.additionalSalesNeeded, result.remainingOpenDays, analysisSales, dayExceptions, smartDistributionEnabled]);

  const dailyReferenceModel = useMemo(() => {
    const today = todayISO();
    // Las ventas de hoy no participan del modelo usado para fijar la referencia de hoy.
    // Así un día fuerte no puede mover su propia vara mientras transcurre.
    return buildSmartDistributionModel(analysisSales.filter((sale) => sale.date < today), openWeekdays);
  }, [analysisSales, openWeekdays]);

  const dailyGoal = useMemo(() => {
    const today = todayISO();
    const todaySales = Number(result.salesByDate[today] || 0);
    const existingSnapshot = dailySnapshots.find((item) => item.date === today && item.periodStart === period.start && item.periodEnd === period.end);
    const storedReference = Number(existingSnapshot?.referenceDailyTarget || 0);

    // Reconstruimos la referencia con el negocio sin las ventas de hoy, pero con el plan y
    // los costos que conocemos ahora. Esto la vuelve estable frente a ventas y reclasificaciones,
    // pero permite que un costo realmente nuevo o un cambio real de estrategia la actualice.
    const soldBeforeToday = Math.max(result.soldSoFar - todaySales, 0);
    const profitBeforeToday = soldBeforeToday - result.totalExpenses;
    const missingProfitBeforeToday = Math.max(result.target - profitBeforeToday, 0);

    // Igual que en el cálculo principal, un acumulado mixto no sirve para deducir una tasa
    // variable. Para la vara de hoy usamos solo movimientos detallados previos a hoy.
    // La referencia de hoy usa la misma regla conservadora: no inventar costos variables futuros
    // a partir de gastos históricos sin clasificación explícita.
    const contributionMarginBeforeToday = 1;
    const additionalSalesNeededBeforeToday = missingProfitBeforeToday / contributionMarginBeforeToday;
    const smartActiveBeforeToday = smartDistributionEnabled && dailyReferenceModel.ready;
    const reconstructedTargets = weightedTargets(
      result.remainingOpenDates,
      additionalSalesNeededBeforeToday,
      dailyReferenceModel,
      smartActiveBeforeToday,
    );
    const reconstructedReference = result.todayIsOpen ? Number(reconstructedTargets[today] || 0) : 0;

    // Desde 1.20.2 la reconstrucción es la fuente autoritativa de la referencia diaria.
    // El snapshot queda como historial/fallback. Esto también repara automáticamente una vara
    // incorrecta que 1.20 haya guardado al reorganizar gastos.
    const fallbackReference = storedReference > 0 ? storedReference : Math.max(result.dailyNeeded, 0);
    const referenceTarget = result.hasTarget && result.todayIsOpen
      ? (reconstructedReference > 0 ? reconstructedReference : fallbackReference)
      : 0;
    const reached = referenceTarget > 0 && todaySales >= referenceTarget;
    const delta = referenceTarget > 0 ? todaySales - referenceTarget : 0;

    const futureOpenDates = result.remainingOpenDates.filter((date) => date > today);
    const futureTargets = weightedTargets(futureOpenDates, result.additionalSalesNeeded, smartModel, result.smartActive);
    const nextOpenDate = futureOpenDates[0] || null;
    const nextOpenTarget = nextOpenDate ? Number(futureTargets[nextOpenDate] || 0) : 0;

    return { todaySales, referenceTarget, reached, delta, nextOpenDate, nextOpenTarget };
  }, [result.salesByDate, result.soldSoFar, result.totalExpenses, result.target, result.hasTarget, result.todayIsOpen, result.dailyNeeded, result.remainingOpenDates, result.additionalSalesNeeded, result.smartActive, dailySnapshots, period.start, period.end, analysisExpenses, smartDistributionEnabled, dailyReferenceModel, smartModel]);

  // Desde 1.5 Lebu guarda una foto del último estado de cada día. No intenta inventar
  // objetivos históricos previos: empieza a construir una serie real desde esta versión.
  useEffect(() => {
    if (!hydrated || !result.hasTarget) return;
    if (cloud.user && cloud.role === 'viewer') return;
    const snapshot: DailySnapshot = {
      date: todayISO(),
      periodStart: period.start,
      periodEnd: period.end,
      dailyNeeded: result.dailyNeeded,
      referenceDailyTarget: dailyGoal.referenceTarget,
      currentProfit: result.currentProfit,
      soldSoFar: result.soldSoFar,
      totalExpenses: result.totalExpenses,
      projectedProfit: result.projectedProfit,
      target: result.target,
    };
    setDailySnapshots((list) => {
      const existing = list.find((item) => item.date === snapshot.date && item.periodStart === snapshot.periodStart && item.periodEnd === snapshot.periodEnd);
      const unchanged = existing
        && Math.round(Number(existing.referenceDailyTarget || 0)) === Math.round(Number(snapshot.referenceDailyTarget || 0))
        && Math.round(existing.dailyNeeded) === Math.round(snapshot.dailyNeeded)
        && Math.round(existing.currentProfit) === Math.round(snapshot.currentProfit)
        && Math.round(existing.soldSoFar) === Math.round(snapshot.soldSoFar)
        && Math.round(existing.totalExpenses) === Math.round(snapshot.totalExpenses)
        && Math.round(existing.projectedProfit) === Math.round(snapshot.projectedProfit)
        && Math.round(existing.target) === Math.round(snapshot.target);
      if (unchanged) return list;
      const next = [...list.filter((item) => !(item.date === snapshot.date && item.periodStart === snapshot.periodStart && item.periodEnd === snapshot.periodEnd)), snapshot]
        .sort((a, b) => a.date.localeCompare(b.date));
      return next.slice(-370);
    });
  }, [hydrated, cloud.user, cloud.role, period.start, period.end, result.hasTarget, result.dailyNeeded, result.currentProfit, result.soldSoFar, result.totalExpenses, result.projectedProfit, result.target, dailyGoal.referenceTarget, dailySnapshots]);


  useEffect(() => {
    if (!hydrated) return;

    // Con una cuenta cloud esperamos a que la carga inicial termine. Esto evita que Lebu
    // celebre hitos viejos simplemente por abrir la app o cambiar de comercio.
    if (cloud.user && (!cloud.businessId || cloud.status === 'connecting')) return;

    const key = `${cloud.businessId || 'local'}:${period.start}:${period.end}:${todayISO()}`;
    const current = {
      key,
      breakEven: result.hasTarget && result.currentProfit >= 0,
      goalReached: result.hasTarget && result.goalReached,
      dailyReached: result.hasTarget && result.todayIsOpen && dailyGoal.reached,
    };
    const previous = milestoneStateRef.current;

    // Primera lectura del día/período: solamente fijamos referencia. Nunca suena por algo
    // que ya estaba cumplido cuando abriste Lebu.
    if (!previous || previous.key !== key) {
      if (cloud.user) {
        const timer = window.setTimeout(() => {
          milestoneStateRef.current = current;
          suppressMilestoneSoundRef.current = false;
        }, 180);
        return () => window.clearTimeout(timer);
      }
      milestoneStateRef.current = current;
      suppressMilestoneSoundRef.current = false;
      return;
    }

    if (suppressMilestoneSoundRef.current) {
      milestoneStateRef.current = current;
      suppressMilestoneSoundRef.current = false;
      return;
    }

    const crossedBreakEven = !previous.breakEven && current.breakEven;
    const crossedGoal = !previous.goalReached && current.goalReached;
    const crossedDailyGoal = !previous.dailyReached && current.dailyReached;
    milestoneStateRef.current = current;

    // Una misma venta puede cruzar más de un hito. La firma de Lebu suena una sola vez.
    if (crossedBreakEven || crossedGoal || crossedDailyGoal) playLebuSound();
  }, [hydrated, cloud.user, cloud.businessId, cloud.status, period.start, period.end, result.hasTarget, result.currentProfit, result.goalReached, result.todayIsOpen, dailyGoal.reached, playLebuSound]);

  const history = useMemo(() => {
    const today = todayISO();
    const openDates = listOpenDates(period.start, period.end, openWeekdays, dayExceptions);
    const coveredByAggregate = (date: string) => Boolean(historicalSummary && historicalSummaryCoversSales(historicalSummary) && date >= historicalSummary.startDate && date <= historicalSummary.endDate);
    const completedDates = openDates.filter((date) => date < today && !coveredByAggregate(date));
    const elapsedDates = openDates.filter((date) => date <= today && !coveredByAggregate(date));
    const totalOpenDays = openDates.length;
    const totalSalesRequirement = result.soldSoFar + result.additionalSalesNeeded;
    const referenceTargets = weightedTargets(openDates, totalSalesRequirement, smartModel, result.smartActive);
    const referenceDailySales = totalOpenDays > 0 ? totalSalesRequirement / totalOpenDays : 0;
    const completedSales = analysisSales
      .filter((sale) => completedDates.includes(sale.date))
      .reduce((sum, sale) => sum + parseMoney(sale.amount), 0);
    const expectedSales = completedDates.reduce((sum, date) => sum + Number(referenceTargets[date] || 0), 0);
    const paceDelta = completedSales - expectedSales;
    const pacePercent = expectedSales > 0 ? (paceDelta / expectedSales) * 100 : 0;
    const paceAvailable = result.hasTarget && completedDates.length > 0 && expectedSales > 0;
    const currentSnapshots = dailySnapshots.filter((item) => item.periodStart === period.start && item.periodEnd === period.end);
    const snapshotByDate = new Map(currentSnapshots.map((item) => [item.date, item]));
    const rows = elapsedDates.map((date) => ({
      date,
      actualSales: Number(result.salesByDate[date] || 0),
      referenceDailySales: Number(referenceTargets[date] || referenceDailySales),
      snapshotTarget: snapshotByDate.get(date)?.referenceDailyTarget ?? snapshotByDate.get(date)?.dailyNeeded ?? null,
      currentProfit: snapshotByDate.get(date)?.currentProfit ?? null,
      isToday: date === today,
    }));
    const scaleMax = Math.max(referenceDailySales, ...rows.map((row) => Math.max(row.actualSales, row.snapshotTarget || 0)), 1);
    return { openDates, completedDates, elapsedDates, totalOpenDays, completedSales, expectedSales, paceDelta, pacePercent, paceAvailable, referenceDailySales, rows, scaleMax, currentSnapshots };
  }, [period.start, period.end, openWeekdays, dayExceptions, result.hasTarget, result.soldSoFar, result.additionalSalesNeeded, result.salesByDate, result.smartActive, analysisSales, historicalSummary, dailySnapshots, smartModel]);

  const homeMiradaAnalysis = useMemo(() => buildMiradaAnalysis({
    periodType,
    periodStartDay,
    analysisWindow: 'auto',
    currentPeriod: period,
    today: todayISO(),
    hasTarget: result.hasTarget,
    goalReached: result.goalReached,
    soldSoFar: result.soldSoFar,
    salesNeededForGoal: result.salesNeededForGoal,
    sales,
    expenses,
    recurringCosts,
    historicalSummary,
    openWeekdays,
    dayExceptions,
    smartActive: result.smartActive,
    weightByWeekday: smartModel.weightByWeekday,
    expectedSalesByToday: result.expectedSalesByToday,
    economicExpenses: result.totalExpenses,
    economicResult: result.currentProfit,
    recurringExpected: result.recurringTotal,
    cashGuidance,
  }), [periodType, periodStartDay, period, result.hasTarget, result.goalReached, result.soldSoFar, result.salesNeededForGoal, result.smartActive, result.expectedSalesByToday, result.totalExpenses, result.currentProfit, result.recurringTotal, sales, expenses, recurringCosts, historicalSummary, openWeekdays, dayExceptions, smartModel.weightByWeekday, cashGuidance]);

  const miradaAnalysis = useMemo(() => buildMiradaAnalysis({
    periodType,
    periodStartDay,
    analysisWindow: miradaAnalysisWindow,
    currentPeriod: period,
    today: todayISO(),
    hasTarget: result.hasTarget,
    goalReached: result.goalReached,
    soldSoFar: result.soldSoFar,
    salesNeededForGoal: result.salesNeededForGoal,
    sales,
    expenses,
    recurringCosts,
    historicalSummary,
    openWeekdays,
    dayExceptions,
    smartActive: result.smartActive,
    weightByWeekday: smartModel.weightByWeekday,
    expectedSalesByToday: result.expectedSalesByToday,
    economicExpenses: result.totalExpenses,
    economicResult: result.currentProfit,
    recurringExpected: result.recurringTotal,
    cashGuidance,
  }), [periodType, periodStartDay, miradaAnalysisWindow, period, result.hasTarget, result.goalReached, result.soldSoFar, result.salesNeededForGoal, result.smartActive, result.expectedSalesByToday, result.totalExpenses, result.currentProfit, result.recurringTotal, sales, expenses, recurringCosts, historicalSummary, openWeekdays, dayExceptions, smartModel.weightByWeekday, cashGuidance]);

  useEffect(() => {
    if (!hydrated || pushStatus !== 'enabled' || !isOnline) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const smartEvent = pendingSmartEventRef.current;
        if (smartEvent && undoMovement && smartEvent.id === String(undoMovement.item.id)) return;

        // 1.21.4: si hay Cloud, ningún snapshot que pueda derivar en una notificación sale
        // antes de una reconciliación. Si el sync trae cambios remotos, esperamos el próximo
        // render para no enviar números construidos con la copia anterior del dispositivo.
        if (cloud.user) {
          if (!cloud.businessId) return;
          let currentRenderIsFresh = false;
          for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
            currentRenderIsFresh = await cloud.syncNow();
            if (currentRenderIsFresh) break;
            await new Promise((resolve) => window.setTimeout(resolve, 250));
          }
          if (!currentRenderIsFresh || cancelled) return;
        }

        if (smartEvent) pendingSmartEventRef.current = null;
        const ok = await sendPushSnapshot({
          schemaVersion: 5,
          businessId: cloud.businessId || undefined,
          generatedAt: new Date().toISOString(),
          hasTarget: result.hasTarget,
          goalReached: result.goalReached,
          additionalSalesNeeded: result.additionalSalesNeeded,
          dailyNeeded: result.dailyNeeded,
          remainingOpenDays: result.remainingOpenDays,
          currentProfit: result.currentProfit,
          soldSoFar: result.soldSoFar,
          variableSpent: result.variableSpent,
          totalExpenses: result.totalExpenses,
          target: result.target,
          periodStart: period.start,
          periodEnd: period.end,
          periodType,
          openWeekdays,
          dayExceptions,
          salesByDate: result.salesByDate,
          observedDailySales: result.observedDailySales,
          projectedProfit: result.projectedProfit,
          smartDistributionActive: result.smartActive,
          smartWeightByWeekday: smartModel.weightByWeekday,
          smartTargetsByDate: result.smartTargetsByDate,
        }, smartEvent);
        if (!ok && smartEvent && !pendingSmartEventRef.current) pendingSmartEventRef.current = smartEvent;
      })();
    }, 700);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [hydrated, pushStatus, isOnline, cloud.user?.id, cloud.businessId, result.hasTarget, result.goalReached, result.additionalSalesNeeded, result.dailyNeeded, result.remainingOpenDays, result.currentProfit, result.soldSoFar, result.variableSpent, result.totalExpenses, result.target, period.start, period.end, periodType, openWeekdays, dayExceptions, result.salesByDate, result.observedDailySales, result.projectedProfit, result.smartActive, result.smartTargetsByDate, smartModel.weightByWeekday, undoMovement]);

  async function activateNotifications() {
    setPushBusy(true);
    setPushMessage('');
    try {
      await enablePushNotifications();
      setPushStatus('enabled');
      setPushMessage('Listo. Lebu puede avisarte al empezar cada día abierto.');
        if (typeof window !== 'undefined') localStorage.setItem(NOTIFICATION_PROMPT_KEY, '1');
      setNotificationPromptOpen(false);
    } catch (error) {
      setPushStatus(getPushSupportStatus());
      setPushMessage(error instanceof Error ? error.message : 'No se pudieron activar las notificaciones.');
    } finally {
      setPushBusy(false);
    }
  }

  function dismissNotificationPrompt() {
    if (typeof window !== 'undefined') localStorage.setItem(NOTIFICATION_PROMPT_KEY, '1');
    setNotificationPromptOpen(false);
  }

  function maybeSuggestNotifications() {
    // En 1.17 priorizamos que el usuario vea valor y guarde su negocio antes de sumar otro pedido.
    if (!cloud.user) return;
    if (pushStatus === 'default' && typeof window !== 'undefined' && localStorage.getItem(NOTIFICATION_PROMPT_KEY) !== '1') {
      setNotificationPromptOpen(true);
    }
  }

  useEffect(() => {
    if (!cloud.user || !result.hasTarget || pushStatus !== 'default') return;
    const timer = window.setTimeout(() => maybeSuggestNotifications(), 1400);
    return () => window.clearTimeout(timer);
  }, [cloud.user?.id, result.hasTarget, pushStatus]);

  async function testNotification() {
    setPushBusy(true);
    setPushMessage('');
    try {
      await sendTestPush();
      setPushMessage('Prueba enviada. Puede tardar unos segundos en aparecer.');
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : 'No se pudo enviar la prueba.');
    } finally {
      setPushBusy(false);
    }
  }

  async function togglePushPreference(key: 'morningEnabled' | 'smartChangesEnabled' | 'closingEnabled') {
    if (pushStatus !== 'enabled') return;
    const previous = pushPreferences;
    const next = { ...previous, [key]: !previous[key] };
    setPushPreferences(next);
    setPushMessage('');
    try {
      await savePushPreferences(next);
      setPushMessage(
        key === 'smartChangesEnabled'
          ? (next.smartChangesEnabled ? 'Avisos por cambios importantes activados.' : 'Avisos por cambios importantes pausados.')
          : key === 'closingEnabled'
            ? (next.closingEnabled ? 'Resumen de cierre activado.' : 'Resumen de cierre pausado.')
            : (next.morningEnabled ? 'Aviso de arranque activado.' : 'Aviso de arranque pausado.'),
      );
    } catch (error) {
      setPushPreferences(previous);
      setPushMessage(error instanceof Error ? error.message : 'No se pudo guardar esa preferencia.');
    }
  }

  async function updateMorningTime(morningTime: string) {
    if (pushStatus !== 'enabled' || !/^\d{2}:\d{2}$/.test(morningTime)) return;
    const previous = pushPreferences;
    const next = { ...previous, morningTime };
    setPushPreferences(next);
    setPushMessage('');
    try {
      await savePushPreferences(next);
      setPushMessage(`Listo. El aviso diario queda para las ${morningTime}.`);
      } catch (error) {
      setPushPreferences(previous);
      setPushMessage(error instanceof Error ? error.message : 'No se pudo guardar el horario.');
    }
  }

  async function updateClosingTime(closingTime: string) {
    if (pushStatus !== 'enabled' || !/^\d{2}:\d{2}$/.test(closingTime)) return;
    const previous = pushPreferences;
    const next = { ...previous, closingTime };
    setPushPreferences(next);
    setPushMessage('');
    try {
      await savePushPreferences(next);
      setPushMessage(`Listo. El resumen de cierre queda para las ${closingTime}.`);
      } catch (error) {
      setPushPreferences(previous);
      setPushMessage(error instanceof Error ? error.message : 'No se pudo guardar el horario de cierre.');
    }
  }

  const movements = useMemo<Movement[]>(() => {
    const saleMovements: Movement[] = sales
      .filter((sale) => isWithinPeriod(sale.date, period.start, period.end))
      .map((sale) => ({
        id: sale.id,
        kind: 'sale',
        date: sale.date,
        amount: parseMoney(sale.amount),
        title: sale.source === 'fudo' ? 'Venta FUDO' : 'Venta del día',
        source: sale.source || 'manual',
        createdBy: sale.createdBy,
        createdByEmail: sale.createdByEmail,
        createdAt: sale.createdAt,
        updatedBy: sale.updatedBy,
        updatedByEmail: sale.updatedByEmail,
      }));

    const expenseMovements: Movement[] = expenses
      .filter((expense) => isWithinPeriod(expense.date, period.start, period.end))
      .map((expense) => {
        const linkedRecurring = expense.recurringCostId == null ? null : recurringCosts.find((item) => item.id === expense.recurringCostId) || null;
        const reconciliationLabel = linkedRecurring ? `Concilia ${linkedRecurring.name}` : '';
        return {
          id: expense.id,
          kind: 'expense',
          date: expense.date,
          amount: parseMoney(expense.amount),
          title: expense.category,
          subtitle: [expense.note, reconciliationLabel].filter(Boolean).join(' · ') || undefined,
          createdBy: expense.createdBy,
          createdByEmail: expense.createdByEmail,
          createdAt: expense.createdAt,
          updatedBy: expense.updatedBy,
          updatedByEmail: expense.updatedByEmail,
        };
      });

    return [...saleMovements, ...expenseMovements].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  }, [sales, expenses, recurringCosts, period]);

  const recentCategories = useMemo(() => {
    const available = new Set(categories.map((item) => item.toLocaleLowerCase('es-AR')));
    const used = [...expenses]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .map((item) => item.category)
      .filter((item) => available.has(item.toLocaleLowerCase('es-AR')));

    // Los gastos históricos conservan su categoría aunque se quite de la lista,
    // pero una categoría eliminada no vuelve a aparecer como opción para gastos nuevos.
    return Array.from(
      new Set([expenseDraft.category, ...used, ...categories].filter(Boolean)),
    );
  }, [expenses, categories, expenseDraft.category]);

  const visibleExpenseCategories = showAllExpenseCategories ? recentCategories : recentCategories.slice(0, 5);

  function openRegister(kind: 'sale' | 'expense') {
    if (!canOperateMovements) return;
    setRegisterKind(kind);
    setSaleDraft({ amount: '', date: todayISO() });
    setExpenseDraft((current) => ({ ...current, amount: '', note: '', date: todayISO(), cashPaid: true }));
    setShowAllExpenseCategories(false);
    setShowCustomCategory(false);
    setRegisterOpen(true);
  }

  function saveSale() {
    if (!canOperateMovements) return;
    const amount = parseMoney(saleDraft.amount);
    if (!amount || !saleDraft.date) return;
    const movementId = createEntityId();
    pendingSmartEventRef.current = { id: String(movementId), kind: 'sale_added', amount, occurredAt: new Date().toISOString() };
    const item: Sale = { id: movementId, amount: String(amount), date: saleDraft.date, ...movementAuditForCurrentUser() };

    setSales((list) => [...list, item]);
    // El sonido de hitos se resuelve de forma centralizada al observar el resultado recalculado.
    // Así también funciona para datos que llegan por sincronización, no solo para una venta manual.
    setRegisterOpen(false);
    showSavedToast(`Venta de ${money.format(amount)} registrada.`, { kind: 'sale', item });
  }

  function saveExpense() {
    if (!canOperateMovements) return;
    const amount = parseMoney(expenseDraft.amount);
    if (!amount || !expenseDraft.date || !expenseDraft.category) return;
    const movementId = createEntityId();
    pendingSmartEventRef.current = { id: String(movementId), kind: 'expense_added', amount, category: expenseDraft.category, occurredAt: new Date().toISOString() };
    const cashEffectAt = expenseDraft.cashPaid ? cashEffectTimestampForDate(expenseDraft.date) : '';
    const item: Expense = {
      id: movementId,
      amount: String(amount),
      date: expenseDraft.date,
      category: expenseDraft.category,
      note: expenseDraft.note.trim(),
      cashEffectAmount: expenseDraft.cashPaid ? String(-amount) : undefined,
      cashEffectAt: cashEffectAt || undefined,
      ...movementAuditForCurrentUser(),
    };
    setExpenses((list) => [...list, item]);
    setRegisterOpen(false);
    showSavedToast(`Gasto de ${money.format(amount)} registrado.`, { kind: 'expense', item });
  }

  function importPreparedMovements(kind: ImportKind, rows: PreparedImportRow[]) {
    if (!canImportMovements || !rows.length) return;
    suppressMilestoneSoundOnce();

    if (kind === 'sale') {
      setSales((list) => {
        const byId = new Map(list.map((item) => [item.id, item]));
        let changed = false;

        for (const row of rows) {
          const matchedId = row.matchedExistingId ?? row.id;
          const current = byId.get(matchedId);
          if (current) {
            // Reimportar el mismo ticket con una columna de hora enriquece el dato existente;
            // nunca vuelve a sumar la venta.
            if (row.occurredAt && current.occurredAt !== row.occurredAt) {
              byId.set(matchedId, {
                ...current,
                occurredAt: row.occurredAt,
                sourceMetadata: { ...(current.sourceMetadata || {}), occurredAt: row.occurredAt },
                ...movementAuditForCurrentUser(),
              });
              changed = true;
            }
            continue;
          }
          byId.set(row.id, {
            id: row.id,
            date: row.date,
            amount: String(Math.round(row.amount)),
            source: 'manual',
            occurredAt: row.occurredAt || undefined,
            sourceMetadata: row.occurredAt ? { occurredAt: row.occurredAt } : undefined,
            ...movementAuditForCurrentUser(),
          });
          changed = true;
        }
        return changed ? [...byId.values()] : list;
      });
    } else {
      setExpenses((list) => {
        const byId = new Map(list.map((item) => [item.id, item]));
        let changed = false;
        for (const row of rows) {
          const matchedId = row.matchedExistingId ?? row.id;
          const current = byId.get(matchedId);
          if (current) {
            if (row.reconciliationExplicit) {
              byId.set(matchedId, {
                ...current,
                recurringCostId: row.recurringCostId == null ? undefined : Number(row.recurringCostId),
                recurringOccurrenceDate: row.recurringOccurrenceDate || undefined,
                reconciliationSource: row.recurringCostId == null ? undefined : 'import',
                ...movementAuditForCurrentUser(),
              });
              changed = true;
            }
            continue;
          }
          byId.set(row.id, {
            id: row.id,
            date: row.date,
            amount: String(Math.round(row.amount)),
            category: row.category || 'Otros',
            note: row.note || '',
            recurringCostId: row.recurringCostId == null ? undefined : Number(row.recurringCostId),
            recurringOccurrenceDate: row.recurringOccurrenceDate || undefined,
            reconciliationSource: row.recurringCostId == null ? undefined : 'import' as const,
            ...movementAuditForCurrentUser(),
          });
          changed = true;
        }
        return changed ? [...byId.values()] : list;
      });
      if (canManageBusiness) {
        const importedCategories = rows.map((row) => row.category.trim()).filter(Boolean);
        if (importedCategories.length) {
          setCategories((list) => Array.from(new Set([...list, ...importedCategories])));
        }
      }
    }

    pendingSmartEventRef.current = null;
    if (!startingDataImportPending) setMovementImportOpen(false);
    showSavedToast(`${rows.length} ${kind === 'sale' ? (rows.length === 1 ? 'venta importada' : 'ventas importadas') : (rows.length === 1 ? 'gasto importado' : 'gastos importados')}.${startingDataImportPending ? ' Podés importar otro archivo o terminar la carga.' : ''}`);
  }

  function saveCustomCategory() {
    if (!canManageBusiness) return;
    const value = customCategory.trim();
    if (!value) return;
    if (!categories.some((item) => item.toLowerCase() === value.toLowerCase())) {
      setCategories((list) => [...list, value]);
    }
    setExpenseDraft((current) => ({ ...current, category: value }));
    setCustomCategory('');
    setShowCustomCategory(false);
  }

  function openMovementEditor(movement: Movement) {
    if (!canOperateMovements || !canEditMovement(movement)) return;
    if (movement.kind === 'sale') {
      const item = sales.find((sale) => sale.id === movement.id);
      if (!item) return;
      setEditingMovement({ kind: 'sale', id: item.id, amount: item.amount, date: item.date, category: '', note: '', cashPaid: false, recurringCostId: null, recurringOccurrenceDate: null });
      return;
    }
    const item = expenses.find((expense) => expense.id === movement.id);
    if (!item) return;
    setEditingMovement({ kind: 'expense', id: item.id, amount: item.amount, date: item.date, category: item.category, note: item.note, cashPaid: Boolean(item.cashEffectAmount && item.cashEffectAt), recurringCostId: item.recurringCostId ?? null, recurringOccurrenceDate: item.recurringOccurrenceDate ?? null });
  }

  function saveMovementEdit() {
    if (!canOperateMovements) return;
    if (!editingMovement) return;
    const movement = movements.find((item) => item.id === editingMovement.id && item.kind === editingMovement.kind);
    if (!movement || !canEditMovement(movement)) return;
    const amount = parseMoney(editingMovement.amount);
    if (!amount || !editingMovement.date) return;
    pendingSmartEventRef.current = { id: `edit-${editingMovement.id}-${Date.now()}`, kind: 'movement_edited', amount, category: editingMovement.kind === 'expense' ? editingMovement.category : undefined, occurredAt: new Date().toISOString() };
    if (editingMovement.kind === 'sale') {
      setSales((list) => list.map((item) => item.id === editingMovement.id ? { ...item, amount: String(amount), date: editingMovement.date, ...movementUpdateAuditForCurrentUser() } : item));
    } else {
      if (!editingMovement.category.trim()) return;
      const category = editingMovement.category.trim();
      const knownCategory = categories.some((item) => item.toLowerCase() === category.toLowerCase());
      if (!knownCategory && !canManageBusiness) return;
      if (!knownCategory) setCategories((list) => [...list, category]);
      setExpenses((list) => list.map((item) => {
        if (item.id !== editingMovement.id) return item;
        return {
          ...item,
          amount: String(amount),
          date: editingMovement.date,
          category,
          note: editingMovement.note.trim(),
          cashEffectAmount: editingMovement.cashPaid ? String(-amount) : undefined,
          cashEffectAt: editingMovement.cashPaid
            ? (item.cashEffectAt && item.date === editingMovement.date ? item.cashEffectAt : cashEffectTimestampForDate(editingMovement.date))
            : undefined,
          recurringCostId: editingMovement.recurringCostId ?? undefined,
          recurringOccurrenceDate: editingMovement.recurringCostId != null
            ? (editingMovement.recurringOccurrenceDate || (() => {
                const recurring = recurringCosts.find((candidate) => candidate.id === editingMovement.recurringCostId);
                return recurring ? recurringOccurrenceDateForExpense(recurring, editingMovement.date) : undefined;
              })())
            : undefined,
          reconciliationSource: editingMovement.recurringCostId != null ? (item.reconciliationSource || 'manual') : undefined,
          ...movementUpdateAuditForCurrentUser(),
        };
      }));
    }
    setEditingMovement(null);
    showSavedToast('Movimiento actualizado.');
  }

  function removeMovement(movement: Movement, askConfirmation = false) {
    if (!canOperateMovements || !canEditMovement(movement)) return false;
    if (askConfirmation && !confirm('¿Eliminar este movimiento?')) return false;
    pendingSmartEventRef.current = { id: `remove-${movement.id}-${Date.now()}`, kind: 'movement_removed', amount: movement.amount, occurredAt: new Date().toISOString() };
    if (movement.kind === 'sale') setSales((list) => list.filter((item) => item.id !== movement.id));
    else setExpenses((list) => list.filter((item) => item.id !== movement.id));
    return true;
  }

  function deleteEditingMovement() {
    if (!editingMovement) return;
    const movement = movements.find((item) => item.id === editingMovement.id && item.kind === editingMovement.kind);
    if (!movement || !removeMovement(movement, true)) return;
    setEditingMovement(null);
    showSavedToast('Movimiento eliminado.');
  }

  function showSavedToast(message: string, undo: UndoMovement | null = null) {
    setToast(message);
    setUndoMovement(undo);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => { setToast(''); setUndoMovement(null); }, undo ? 5000 : 2200);
  }

  function undoLastMovement() {
    if (!canOperateMovements) return;
    if (!undoMovement) return;
    const movementId = undoMovement.item.id;
    pendingSmartEventRef.current = { id: `undo-${movementId}-${Date.now()}`, kind: 'movement_removed', amount: parseMoney(undoMovement.item.amount), occurredAt: new Date().toISOString() };
    if (undoMovement.kind === 'sale') setSales((list) => list.filter((item) => item.id !== movementId));
    else setExpenses((list) => list.filter((item) => item.id !== movementId));
    setUndoMovement(null);
    setToast('Movimiento deshecho.');
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(''), 1800);
  }


  function recurringDraftHasEconomicChange(item: RecurringCost) {
    const current = recurringCosts.find((existing) => existing.id === item.id);
    if (!current) return false;
    const normalizedCurrent = {
      ...current,
      amount: String(parseMoney(current.amount)),
      paymentSchedule: normalizeCashPaymentSchedule(current.paymentSchedule, current.frequency),
    };
    const normalizedDraft = {
      ...item,
      amount: String(parseMoney(item.amount)),
      paymentSchedule: normalizeCashPaymentSchedule(item.paymentSchedule, item.frequency),
    };
    return recurringEconomicConfigChanged(normalizedCurrent, normalizedDraft);
  }

  function recurringHistoryCount(item: RecurringCost) {
    const history = normalizeRecurringHistory(item.configHistory);
    return Math.max(history.length - 1, 0);
  }

  function addRecurringCost() {
    if (!canManageBusiness) return;
    const amount = parseMoney(newRecurring.amount);
    const name = newRecurring.name.trim();
    if (!name || !amount) return;
    const id = createEntityId();
    setSettingsDraft((current) => ({
      ...current,
      recurringCosts: [
        ...current.recurringCosts,
        { id, name, amount: String(amount), frequency: newRecurring.frequency, paymentSchedule: normalizeCashPaymentSchedule(newRecurring.paymentSchedule, newRecurring.frequency), amountApproximate: newRecurring.amountApproximate },
      ],
    }));
    if (newRecurring.includedInHistoricalSummary) {
      setSettingsCoveredRecurringIds((current) => Array.from(new Set([...current, id])));
    }
    const currentPeriod = getCurrentPeriod(periodType, periodStartDay);
    const coverageActive = historicalSummaryIsActiveForPeriod(historicalSummary, currentPeriod)
      && historicalSummaryCoversExpenses(historicalSummary)
      && Boolean(historicalSummary?.expensesIncludeRecurring);
    setNewRecurring({ name: '', amount: '', frequency: 'monthly', paymentSchedule: null, amountApproximate: false, includedInHistoricalSummary: coverageActive });
  }

  function toggleDraftOpenDay(day: number) {
    if (!canManageBusiness) return;
    setSettingsDraft((current) => {
      const days = current.openWeekdays;
      if (days.includes(day)) {
        if (days.length === 1) return current;
        return { ...current, openWeekdays: days.filter((item) => item !== day) };
      }
      return { ...current, openWeekdays: [...days, day] };
    });
  }

  function addDayException() {
    if (!canManageBusiness) return;
    if (!exceptionDate || exceptionDate < settingsPeriod.start || exceptionDate > settingsPeriod.end) return;
    const normalOpen = settingsDraft.openWeekdays.includes(fromISO(exceptionDate).getDay());
    const exception: DayException = { date: exceptionDate, open: !normalOpen };
    setSettingsDraft((current) => ({
      ...current,
      dayExceptions: [...current.dayExceptions.filter((item) => item.date !== exceptionDate), exception].sort((a, b) => a.date.localeCompare(b.date)),
    }));
  }

  function removeDayException(date: string) {
    if (!canManageBusiness) return;
    setSettingsDraft((current) => ({ ...current, dayExceptions: current.dayExceptions.filter((item) => item.date !== date) }));
  }

  function defaultHistoricalDraft(range = period, existing = historicalSummary) {
    const endDate = historicalCutoff(range.start, range.end);
    return existing ? {
      startDate: existing.startDate,
      endDate: existing.endDate,
      salesTotal: existing.salesTotal,
      expensesTotal: existing.expensesTotal,
      expensesIncludeRecurring: existing.expensesIncludeRecurring,
    } : {
      startDate: range.start,
      endDate,
      salesTotal: '',
      expensesTotal: '',
      expensesIncludeRecurring: true,
    };
  }

  function openHistoricalSummaryEditor() {
    if (!canManageBusiness) return;
    // Si se abre desde Plan, cerramos primero ese modal para no apilar dos pantallas.
    setSettingsOpen(false);
    setStartingDataPromptNotifications(false);
    setStartingDataMode('totals');
    setHistoricalDraft(defaultHistoricalDraft(period, historicalSummary));
    setStartingDataOpen(true);
  }

  function finishStartingDataSetup() {
    const shouldPrompt = startingDataPromptNotifications;
    setStartingDataOpen(false);
    setStartingDataMode('choices');
    setStartingDataPromptNotifications(false);
    if (shouldPrompt) maybeSuggestNotifications();
  }

  function startImportFromStartingData() {
    const shouldPrompt = startingDataPromptNotifications;
    setStartingDataOpen(false);
    setStartingDataMode('choices');
    setStartingDataPromptNotifications(false);
    setStartingDataImportPending(shouldPrompt);
    setMovementImportOpen(true);
  }

  function saveHistoricalSummary() {
    if (!canManageBusiness) return;
    suppressMilestoneSoundOnce();
    const startDate = historicalDraft.startDate;
    const endDate = historicalDraft.endDate;
    const salesTotal = parseMoney(historicalDraft.salesTotal);
    const expensesTotal = parseMoney(historicalDraft.expensesTotal);
    if (!startDate || !endDate || startDate > endDate) return;
    if (startDate < period.start || endDate > period.end || endDate > historicalCutoff(period.start, period.end)) return;
    if (salesTotal <= 0 && expensesTotal <= 0) return;
    const nextIncludesRecurring = expensesTotal > 0 && historicalDraft.expensesIncludeRecurring;
    const coveredRecurringCostIds = nextIncludesRecurring
      ? (historicalSummary?.expensesIncludeRecurring
        ? coveredRecurringIdsForSummary(historicalSummary, recurringCosts)
        : recurringCosts.map((item) => item.id))
      : [];
    setHistoricalSummary({
      startDate,
      endDate,
      salesTotal: String(salesTotal),
      expensesTotal: String(expensesTotal),
      salesCovered: salesTotal > 0,
      expensesCovered: expensesTotal > 0,
      expensesIncludeRecurring: nextIncludesRecurring,
      coveredRecurringCostIds,
      capturedAt: new Date().toISOString(),
    });
    pendingSmartEventRef.current = { id: `historical-${Date.now()}`, kind: 'settings_changed', occurredAt: new Date().toISOString() };
    showSavedToast('Progreso inicial guardado sin inventar movimientos diarios.');
    finishStartingDataSetup();
  }

  function removeHistoricalSummary() {
    if (!canManageBusiness) return;
    setHistoricalSummary(null);
    pendingSmartEventRef.current = { id: `historical-remove-${Date.now()}`, kind: 'settings_changed', occurredAt: new Date().toISOString() };
    showSavedToast('Progreso inicial eliminado.');
  }

  function confirmCashDraft() {
    if (!canManageBusiness) return;
    const confirmed = parseMoney(settingsDraft.availableCash);
    const confirmedAt = new Date().toISOString();
    const difference = cashGuidance.hasCashSnapshot ? confirmed - cashGuidance.estimatedCash : 0;

    if (cashGuidance.hasCashSnapshot && difference !== 0) {
      setCashAdjustments((current) => [
        ...current,
        {
          id: createEntityId(),
          amount: String(difference),
          adjustedAt: confirmedAt,
          estimatedBefore: String(cashGuidance.estimatedCash),
          confirmedAfter: String(confirmed),
          reason: 'reconciliation' as const,
        },
      ].slice(-100));
    }

    setAvailableCash(String(confirmed));
    setCashUpdatedAt(confirmedAt);
    setCashDraftTouched(false);
    pendingSmartEventRef.current = { id: `cash-confirm-${Date.now()}`, kind: 'settings_changed', occurredAt: confirmedAt };
    showSavedToast(difference === 0
      ? `Caja confirmada en ${money.format(confirmed)}.`
      : `Caja confirmada. Ajuste registrado: ${difference > 0 ? '+' : '-'}${money.format(Math.abs(difference))}.`);
  }

  function saveSettings() {
    if (!canManageBusiness) return;
    const target = parseMoney(settingsDraft.profitTarget);
    if (!target) return;
    const isFirstObjective = parseMoney(profitTarget) <= 0;
    if (isFirstObjective) suppressMilestoneSoundOnce();
    pendingSmartEventRef.current = { id: `settings-${Date.now()}`, kind: 'settings_changed', occurredAt: new Date().toISOString() };
    setProfitTarget(String(target));
    setPeriodType(settingsDraft.periodType);
    setPeriodStartDay(Math.min(Math.max(Math.round(settingsDraft.periodStartDay || 1), 1), 31));
    setOpenWeekdays([...settingsDraft.openWeekdays]);
    setDayExceptions(settingsDraft.dayExceptions.map((item) => ({ ...item })));
    setSmartDistributionEnabled(settingsDraft.smartDistributionEnabled);
    if (cashDraftTouched) {
      const confirmed = parseMoney(settingsDraft.availableCash);
      const confirmedAt = new Date().toISOString();
      const difference = cashGuidance.hasCashSnapshot ? confirmed - cashGuidance.estimatedCash : 0;
      if (cashGuidance.hasCashSnapshot && difference !== 0) {
        setCashAdjustments((current) => [
          ...current,
          { id: createEntityId(), amount: String(difference), adjustedAt: confirmedAt, estimatedBefore: String(cashGuidance.estimatedCash), confirmedAfter: String(confirmed), reason: 'reconciliation' as const },
        ].slice(-100));
      }
      setAvailableCash(String(confirmed));
      setCashUpdatedAt(confirmedAt);
    }
    const normalizedRecurringDraft = settingsDraft.recurringCosts.map((item) => ({
      ...item,
      amount: String(parseMoney(item.amount)),
      name: item.name.trim() || 'Gasto recurrente',
      paymentSchedule: normalizeCashPaymentSchedule(item.paymentSchedule, item.frequency),
      configHistory: normalizeRecurringHistory(item.configHistory),
    })).filter((item) => parseMoney(item.amount) > 0);
    const normalizedRecurringCosts = normalizedRecurringDraft.map((item) => {
      const current = recurringCosts.find((existing) => existing.id === item.id);
      if (!current) return item;
      const normalizedCurrent = {
        ...current,
        amount: String(parseMoney(current.amount)),
        paymentSchedule: normalizeCashPaymentSchedule(current.paymentSchedule, current.frequency),
        configHistory: normalizeRecurringHistory(current.configHistory),
      };
      if (!recurringEconomicConfigChanged(normalizedCurrent, item)) return { ...item, configHistory: normalizedCurrent.configHistory };
      const choice = recurringChangeEffective[item.id] || todayISO();
      return applyRecurringConfigChange(normalizedCurrent, item, choice === 'all' ? null : choice);
    });
    const validRecurringIds = new Set(normalizedRecurringCosts.map((item) => item.id));
    const nextCoveredRecurringIds = settingsCoveredRecurringIds.filter((id) => validRecurringIds.has(id));
    setRecurringCosts(normalizedRecurringCosts);
    if (historicalSummary?.expensesIncludeRecurring) {
      setHistoricalSummary((current) => current ? { ...current, coveredRecurringCostIds: nextCoveredRecurringIds } : current);
    }
    const normalizedCategories: string[] = Array.from(new Map<string, string>(
      settingsDraft.categories
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => [item.toLocaleLowerCase('es-AR'), item] as const),
    ).values());
    if (!normalizedCategories.some((item) => item.toLocaleLowerCase('es-AR') === 'otros')) normalizedCategories.push('Otros');
    setCategories(normalizedCategories);
    setExpenseDraft((current) => normalizedCategories.some((item) => item === current.category)
      ? current
      : { ...current, category: normalizedCategories[0] || 'Otros' });
    // Clasificar mejor un gasto ya incluido no es un cambio de plan: no debe mover la meta de hoy.
    // Solo reseteamos la referencia diaria si cambió algo que realmente modifica el esfuerzo actual.
    const currentCovered = new Set(
      historicalSummaryIsActiveForPeriod(historicalSummary, period) && historicalSummary?.expensesIncludeRecurring
        ? coveredRecurringIdsForSummary(historicalSummary, recurringCosts)
        : [],
    );
    const nextPeriod = getCurrentPeriod(settingsDraft.periodType, settingsDraft.periodStartDay);
    const nextCoverageActive = historicalSummaryIsActiveForPeriod(historicalSummary, nextPeriod) && Boolean(historicalSummary?.expensesIncludeRecurring);
    const nextCovered = new Set(nextCoverageActive ? nextCoveredRecurringIds : []);
    const currentAdditionalRecurring = recurringCosts.reduce((sum, item) => currentCovered.has(item.id) ? sum : sum + prorateRecurringCost(item, period.start, period.end, periodType, period.start, period.end), 0);
    const nextAdditionalRecurring = normalizedRecurringCosts.reduce((sum, item) => nextCovered.has(item.id) ? sum : sum + prorateRecurringCost(item, nextPeriod.start, nextPeriod.end, settingsDraft.periodType, nextPeriod.start, nextPeriod.end), 0);
    const calendarChanged = periodType !== settingsDraft.periodType
      || periodStartDay !== Math.min(Math.max(Math.round(settingsDraft.periodStartDay || 1), 1), 31)
      || JSON.stringify([...openWeekdays].sort()) !== JSON.stringify([...settingsDraft.openWeekdays].sort())
      || JSON.stringify(dayExceptions) !== JSON.stringify(settingsDraft.dayExceptions)
      || smartDistributionEnabled !== settingsDraft.smartDistributionEnabled;
    const economicPlanChanged = target !== parseMoney(profitTarget)
      || calendarChanged
      || Math.round(currentAdditionalRecurring) !== Math.round(nextAdditionalRecurring);
    if (economicPlanChanged) {
      setDailySnapshots((list) => list.map((item) => item.date === todayISO() ? { ...item, referenceDailyTarget: undefined } : item));
    }
    setSettingsOpen(false);
    if (isFirstObjective) {
      const nextPeriod = getCurrentPeriod(settingsDraft.periodType, settingsDraft.periodStartDay);
      setStartingDataPromptNotifications(true);
      setStartingDataMode('choices');
      setHistoricalDraft(defaultHistoricalDraft(nextPeriod, null));
      setStartingDataOpen(true);
    }
    showSavedToast('Cambios guardados. Tu objetivo ya quedó actualizado.');
  }

  function exportBackup() {
    const backup = {
      app: 'Lebu', schemaVersion: 16, exportedAt: new Date().toISOString(),
      profitTarget, periodType, periodStartDay, historicalSummary, openWeekdays, dayExceptions, recurringCosts, sales, expenses, dailySnapshots, categories, soundsEnabled, smartDistributionEnabled, availableCash, cashUpdatedAt, cashAdjustments,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `lebu-respaldo-${todayISO()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function importBackup(file: File) {
    if (!canManageBusiness) return;
    suppressMilestoneSoundOnce();
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object') throw new Error('invalid');
      pendingSmartEventRef.current = { id: `import-${Date.now()}`, kind: 'backup_imported', occurredAt: new Date().toISOString() };
      if (typeof parsed.profitTarget === 'string') setProfitTarget(parsed.profitTarget);
      if (['weekly', 'biweekly', 'monthly'].includes(parsed.periodType)) setPeriodType(parsed.periodType);
      if (Number.isFinite(Number(parsed.periodStartDay))) setPeriodStartDay(Math.min(Math.max(Number(parsed.periodStartDay), 1), 31));
      if (parsed.historicalSummary && typeof parsed.historicalSummary === 'object') setHistoricalSummary(parsed.historicalSummary as HistoricalSummary);
      else setHistoricalSummary(null);
      if (Array.isArray(parsed.openWeekdays) && parsed.openWeekdays.length) setOpenWeekdays(parsed.openWeekdays);
      if (Array.isArray(parsed.dayExceptions)) setDayExceptions(parsed.dayExceptions.filter((item: DayException) => typeof item?.date === 'string' && typeof item?.open === 'boolean'));
      if (Array.isArray(parsed.recurringCosts)) setRecurringCosts(parsed.recurringCosts);
      if (Array.isArray(parsed.sales)) setSales(parsed.sales);
      if (Array.isArray(parsed.expenses)) setExpenses(parsed.expenses);
      if (Array.isArray(parsed.dailySnapshots)) setDailySnapshots(parsed.dailySnapshots);
      if (Array.isArray(parsed.categories)) setCategories(parsed.categories);
      if (typeof parsed.soundsEnabled === 'boolean') setSoundsEnabled(parsed.soundsEnabled);
      if (typeof parsed.smartDistributionEnabled === 'boolean') setSmartDistributionEnabled(parsed.smartDistributionEnabled);
      if (typeof parsed.availableCash === 'string' || typeof parsed.availableCash === 'number') setAvailableCash(String(parsed.availableCash));
      if (typeof parsed.cashUpdatedAt === 'string') setCashUpdatedAt(parsed.cashUpdatedAt);
      if (Array.isArray(parsed.cashAdjustments)) setCashAdjustments((parsed.cashAdjustments as CashAdjustment[]).slice(-100));
      const importedState = { schemaVersion: 16, profitTarget: typeof parsed.profitTarget === 'string' ? parsed.profitTarget : profitTarget, periodType: ['weekly', 'biweekly', 'monthly'].includes(String(parsed.periodType)) ? parsed.periodType as PeriodType : periodType, periodStartDay: Number.isFinite(Number(parsed.periodStartDay)) ? Math.min(Math.max(Number(parsed.periodStartDay), 1), 31) : periodStartDay, historicalSummary: parsed.historicalSummary && typeof parsed.historicalSummary === 'object' ? parsed.historicalSummary : historicalSummary, openWeekdays: Array.isArray(parsed.openWeekdays) && parsed.openWeekdays.length ? parsed.openWeekdays : openWeekdays, dayExceptions: Array.isArray(parsed.dayExceptions) ? parsed.dayExceptions : dayExceptions, recurringCosts: Array.isArray(parsed.recurringCosts) ? parsed.recurringCosts : recurringCosts, sales: Array.isArray(parsed.sales) ? parsed.sales : sales, expenses: Array.isArray(parsed.expenses) ? parsed.expenses : expenses, dailySnapshots: Array.isArray(parsed.dailySnapshots) ? parsed.dailySnapshots : dailySnapshots, categories: Array.isArray(parsed.categories) ? parsed.categories : categories, soundsEnabled: typeof parsed.soundsEnabled === 'boolean' ? parsed.soundsEnabled : soundsEnabled, smartDistributionEnabled: typeof parsed.smartDistributionEnabled === 'boolean' ? parsed.smartDistributionEnabled : smartDistributionEnabled, availableCash: typeof parsed.availableCash === 'string' || typeof parsed.availableCash === 'number' ? String(parsed.availableCash) : availableCash, cashUpdatedAt: typeof parsed.cashUpdatedAt === 'string' ? parsed.cashUpdatedAt : cashUpdatedAt, cashAdjustments: Array.isArray(parsed.cashAdjustments) ? parsed.cashAdjustments.slice(-100) : cashAdjustments };
      await writeLocalState(importedState).catch(() => undefined);
      alert('Respaldo importado. Lebu ya quedó actualizado.');
    } catch {
      alert('No pudimos leer ese respaldo de Lebu.');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  async function clearAllData() {
    if (!canManageBusiness) return;
    suppressMilestoneSoundOnce();
    if (!confirm(cloud.user ? '¿Borrar todos los datos de Lebu? Como tenés la nube activa, este borrado también se sincronizará con tu cuenta. Esta acción no se puede deshacer.' : '¿Borrar todos los datos guardados en este dispositivo? Esta acción no se puede deshacer.')) return;
    setProfitTarget(''); setPeriodType('monthly'); setPeriodStartDay(1); setHistoricalSummary(null); setOpenWeekdays([0, 1, 2, 3, 4, 5, 6]); setDayExceptions([]);
    setRecurringCosts([]); setSales([]); setExpenses([]); setDailySnapshots([]); setCategories(initialCategories); setSoundsEnabled(true); setSmartDistributionEnabled(true); setAvailableCash(''); setCashUpdatedAt(''); setCashAdjustments([]);
    await clearLocalState().catch(() => undefined);
    localStorage.removeItem(STORAGE_KEY); LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem(ONBOARDING_KEY);
    setSettingsOpen(false);
    setSettingsSection('plan');
    setActivationDraft({ profitTarget: '', periodType: 'monthly', openWeekdays: [0, 1, 2, 3, 4, 5, 6], monthlyRecurringTotal: '' });
    setActivationDataSource(null); setActivationDaysSuggestedFromFudo(false);
    setOnboardingStep(0);
    setOnboardingOpen(true);
  }

  const visibleMovements = activeView === 'movements' || showAllMovements ? movements : movements.slice(0, 6);
  const periodInfo = periodType === 'monthly' && periodStartDay !== 1 ? { ...periodCopy.monthly, phrase: 'este período', targetLabel: 'Quiero ganar en este período' } : periodCopy[periodType];
  const heroLabel = !result.hasTarget ? 'PRIMER OBJETIVO' : result.goalReached ? 'OBJETIVO CUMPLIDO' : dailyGoal.reached ? 'OBJETIVO DE HOY CUMPLIDO' : result.remainingOpenDays === 0 ? 'PERÍODO CERRADO' : result.todayIsOpen ? 'HOY APUNTÁ A' : 'EN TU PRÓXIMO DÍA ABIERTO';
  const currentPeriodExceptions = settingsDraft.dayExceptions.filter((item) => item.date >= settingsPeriod.start && item.date <= settingsPeriod.end);
  const selectedExceptionNormalOpen = exceptionDate ? settingsDraft.openWeekdays.includes(fromISO(exceptionDate).getDay()) : false;
  const cloudStatusLabel = cloud.status === 'synced' ? 'Sincronizado' : cloud.status === 'pending' ? 'Cambios pendientes' : cloud.status === 'connecting' ? 'Sincronizando…' : cloud.status === 'offline' ? 'Sin conexión' : cloud.status === 'error' ? 'Error de sincronización' : 'Sin cuenta';

  const activeBusinessName = cloud.activeBusiness?.name || (cloud.user ? 'Mi negocio' : 'Negocio local');
  const settingsSectionCopy: Record<SettingsSection, { eyebrow: string; title: string; description: string }> = {
    plan: { eyebrow: 'ESTRATEGIA', title: result.hasTarget ? 'Tu estrategia' : 'Configurá tu primer objetivo', description: 'Lo esencial para que Lebu entienda qué querés lograr y cómo funciona tu negocio.' },
    preferences: { eyebrow: 'PREFERENCIAS', title: 'Cómo se siente Lebu', description: 'Apariencia, notificaciones, sonidos y respaldo. Acá no cambiás los números del negocio.' },
    account: { eyebrow: 'CUENTA Y NEGOCIO', title: cloud.user ? activeBusinessName : result.hasTarget ? 'Guardá tu negocio' : 'Ingresá a Lebu', description: cloud.user ? 'Cuenta, comercio activo y equipo en un solo lugar.' : result.hasTarget ? 'Tu estrategia ya funciona en este dispositivo. Creá una cuenta para respaldarla, sincronizarla y compartirla.' : 'Sincronizá tus datos y accedé al mismo negocio desde todos tus dispositivos.' },
  };
  const currentSettingsCopy = settingsSectionCopy[settingsSection];

  return (
    <main className="min-h-screen mobile-nav-page md:pb-12">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 md:px-8 md:py-8">
        <header className="brand-header app-header">
          <div className="app-header-left">
            <div className="brand-lockup compact-brand-lockup">
              <img src="/lebu-logo.png" alt="Lebu" className="brand-logo h-auto" />
              <div className="brand-tagline">Vigila, entiende, te guía.</div>
            </div>
            <button type="button" onClick={() => openSettingsSection('account')} className="business-context-button" aria-label={`Negocio activo: ${activeBusinessName}`}>
              <span className="business-context-label">NEGOCIO</span>
              <span className="business-context-name"><Building2 size={16} /> {activeBusinessName}{cloud.businesses.length > 1 && <ChevronDown size={15} />}</span>
            </button>
          </div>
          <div className="app-header-actions">
            {cloud.user && (
              <span className={`sync-dot sync-dot-${cloud.status}`} title={cloudStatusLabel} aria-label={`Nube: ${cloudStatusLabel}`} />
            )}
            <button type="button" onClick={() => openSettingsSection('account')} className={`account-header-button ${cloud.user ? 'account-header-button-signed' : ''}`} aria-label={cloud.user ? `Cuenta ${cloud.user.email}` : 'Ingresar a Lebu'}>
              {cloud.user ? <span>{(cloud.user.email || 'U').slice(0, 1).toUpperCase()}</span> : <UserRound size={18} />}
              {!cloud.user && <strong className="hidden sm:inline">Ingresar</strong>}
            </button>
            <button type="button" onClick={() => openSettingsSection('preferences')} className="icon-button header-settings-button" aria-label="Preferencias de Lebu">
              <Settings2 size={19} />
            </button>
          </div>
        </header>

        <nav className="desktop-primary-nav mt-5" aria-label="Navegación principal">
          <button type="button" onClick={() => { setQuickActionOpen(false); setSettingsOpen(false); setActiveView('home'); }} className={activeView === 'home' && !(settingsOpen && settingsSection === 'plan') ? 'primary-nav-item primary-nav-item-active' : 'primary-nav-item'}><House size={16} /> Inicio</button>
          <button type="button" onClick={() => { setQuickActionOpen(false); setSettingsOpen(false); setActiveView('movements'); }} className={activeView === 'movements' && !(settingsOpen && settingsSection === 'plan') ? 'primary-nav-item primary-nav-item-active' : 'primary-nav-item'}><ListChecks size={16} /> Movimientos</button>
          <button type="button" onClick={() => { setQuickActionOpen(false); setSettingsOpen(false); setActiveView('production'); }} className={activeView === 'production' && !(settingsOpen && settingsSection === 'plan') ? 'primary-nav-item primary-nav-item-active' : 'primary-nav-item'}><PackageOpen size={16} /> Producción</button>
          <button type="button" onClick={() => { setQuickActionOpen(false); setSettingsOpen(false); setActiveView('insights'); }} className={(activeView === 'insights' || activeView === 'simulator') && !(settingsOpen && settingsSection === 'plan') ? 'primary-nav-item primary-nav-item-active' : 'primary-nav-item'}><Eye size={16} /> Mirada</button>
          <button type="button" onClick={() => openSettingsSection('plan')} className={settingsOpen && settingsSection === 'plan' ? 'primary-nav-item primary-nav-item-active' : 'primary-nav-item'}><Target size={16} /> Estrategia</button>
        </nav>

        {!isOnline && (
          <div className="offline-banner mt-4" role="status">
            <span className="offline-dot" />
            <div>
              <strong>Estás sin conexión.</strong> Podés seguir usando Lebu; los cambios quedan guardados en este dispositivo.
            </div>
          </div>
        )}

        <div className="dashboard-grid mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[1.18fr_.82fr] lg:items-start">
          {activeView === 'simulator' && (
            <section className="simulator-view min-w-0 lg:col-span-2">
              <button type="button" onClick={() => setActiveView('insights')} className="simulator-back">← Volver a Mirada</button>
              <div className="simulator-heading mt-3">
                <div>
                  <div className="eyebrow">SIMULADOR · NO CAMBIA TUS DATOS</div>
                  <h1 className="mt-1 text-3xl font-black tracking-[-0.035em] text-[var(--ink)] sm:text-4xl">¿Qué pasa si…?</h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Probá decisiones sobre tu negocio usando los números que Lebu ya conoce. Nada de lo que hagas acá modifica ventas, gastos ni tu Estrategia.</p>
                </div>
                <button type="button" onClick={resetSimulator} className="secondary-button simulator-reset"><Repeat2 size={16} /> Reiniciar escenario</button>
              </div>

              <div className="simulator-layout mt-5">
                <div className="panel-card simulator-controls">
                  <div className="eyebrow">ARMÁ EL ESCENARIO</div>
                  <h2 className="mt-1 text-xl font-black tracking-tight text-[var(--ink)]">Mové las piezas</h2>

                  <div className="simulator-field mt-5">
                    <div className="flex items-center gap-2">
                      <label>Objetivo de ganancia</label>
                      <HelpTip text="Es la ganancia que querés alcanzar en el período actual dentro de este escenario. Cambiarla acá no cambia tu Estrategia real." />
                    </div>
                    <MoneyInput value={simulatorDraft.profitTarget} onChange={(value) => setSimulatorDraft((current) => ({ ...current, profitTarget: value }))} />
                    <small>Tu plan actual: <strong>{money.format(result.target)}</strong>.</small>
                  </div>

                  <div className="simulator-field mt-4">
                    <div className="flex items-center gap-2">
                      <label>Cambio en gastos mensuales</label>
                      <HelpTip text="Poné un valor positivo para sumar costos o uno negativo para probar un ahorro/reducción. Lebu lo prorratea al período que estás mirando." />
                    </div>
                    <MoneyInput allowNegative value={simulatorDraft.extraMonthlyCost} onChange={(value) => setSimulatorDraft((current) => ({ ...current, extraMonthlyCost: value }))} />
                    <small>Ejemplo: +$200.000 por un costo nuevo o -$200.000 si conseguís ahorrar ese importe.</small>
                  </div>

                  <div className="simulator-field mt-5">
                    <div className="flex items-center gap-2">
                      <label>Días que abrirías</label>
                      <HelpTip text="Probá abrir o cerrar días habituales. Las excepciones puntuales que ya cargaste en el calendario se siguen respetando." />
                    </div>
                    <div className="weekday-picker simulator-weekdays mt-2">
                      {weekdayOptions.map((day) => {
                        const active = simulatorDraft.openWeekdays.includes(day.value);
                        return (
                          <button key={day.value} type="button" onClick={() => toggleSimulatorOpenDay(day.value)} className={active ? 'weekday-button weekday-button-active' : 'weekday-button'} aria-pressed={active} title={day.label}>
                            {day.short}
                          </button>
                        );
                      })}
                    </div>
                    <small>{simulatorDraft.openWeekdays.length} días habituales por semana · quedan <strong>{simulatorResult.remainingOpenDays}</strong> días abiertos en este período.</small>
                  </div>

                  <div className="simulator-safety-note mt-5">
                    <ShieldCheck size={17} />
                    <span><strong>Es solo una simulación.</strong> Para hacer un cambio real, después lo editás y guardás desde Estrategia.</span>
                  </div>
                </div>

                <div className="simulator-results min-w-0">
                  <div className={`simulator-result-hero simulator-tone-${simulatorResult.verdictTone}`}>
                    <div className="eyebrow">CON ESTE ESCENARIO</div>
                    {!simulatorResult.hasTarget ? (
                      <>
                        <div className="mt-2 text-2xl font-black text-[var(--ink)]">Definí una ganancia objetivo</div>
                        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Con un objetivo, Lebu puede calcular cuánto esfuerzo de venta requiere este escenario.</p>
                      </>
                    ) : simulatorResult.goalReached ? (
                      <>
                        <div className="mt-2 text-3xl font-black tracking-tight text-[var(--ink)]">Objetivo cubierto</div>
                        <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">La ganancia acumulada ya alcanza la meta simulada contemplando los costos del escenario.</p>
                      </>
                    ) : simulatorResult.remainingOpenDays === 0 ? (
                      <>
                        <div className="mt-2 text-3xl font-black tracking-tight text-[var(--ink)]">Sin días disponibles</div>
                        <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">Quedarían {money.format(simulatorResult.additionalSalesNeeded)} de ventas estimadas por generar.</p>
                      </>
                    ) : (
                      <>
                        <div className="mt-2 text-sm font-extrabold text-[var(--muted)]">Próximo día abierto</div>
                        <div className="mt-1 text-4xl font-black tracking-[-0.04em] text-[var(--brand)]">{money.format(simulatorResult.dailyNeeded)}</div>
                        <p className="mt-2 text-sm leading-6 text-[var(--ink-soft)]">
                          {Math.abs(simulatorResult.dailyDelta) < 1000
                            ? 'Prácticamente igual a tu plan actual.'
                            : simulatorResult.dailyDelta > 0
                              ? `${money.format(Math.abs(simulatorResult.dailyDelta))} más que el objetivo dinámico de tu plan actual.`
                              : `${money.format(Math.abs(simulatorResult.dailyDelta))} menos que el objetivo dinámico de tu plan actual.`}
                        </p>
                      </>
                    )}
                  </div>

                  <div className="simulator-metrics mt-4">
                    <div className="simulator-metric">
                      <span>Ventas adicionales</span>
                      <strong>{money.format(simulatorResult.additionalSalesNeeded)}</strong>
                      <small>{Math.abs(simulatorResult.salesDelta) < 1000 ? 'Casi sin cambio' : `${simulatorResult.salesDelta > 0 ? '+' : '−'} ${money.format(Math.abs(simulatorResult.salesDelta))} vs. plan actual`}</small>
                    </div>
                    <div className="simulator-metric">
                      <span>Días abiertos restantes</span>
                      <strong>{simulatorResult.remainingOpenDays}</strong>
                      <small>{simulatorResult.openDaysDelta === 0 ? 'Misma cantidad' : `${simulatorResult.openDaysDelta > 0 ? '+' : '−'} ${Math.abs(simulatorResult.openDaysDelta)} vs. plan actual`}</small>
                    </div>
                    <div className="simulator-metric">
                      <span>Costo extra en el período</span>
                      <strong>{money.format(simulatorResult.extraPeriodCost)}</strong>
                      <small>{simulatorResult.extraMonthlyCost === 0 ? 'Sin cambios' : simulatorResult.extraMonthlyCost > 0 ? `${money.format(simulatorResult.extraMonthlyCost)} más por mes` : `${money.format(Math.abs(simulatorResult.extraMonthlyCost))} menos por mes`}</small>
                    </div>
                    <div className="simulator-metric">
                      <span>Proyección de ganancia</span>
                      <strong>{simulatorResult.projectionAvailable ? money.format(simulatorResult.projectedProfit) : 'Aprendiendo'}</strong>
                      <small>{!simulatorResult.projectionAvailable ? 'Hace falta un día completo' : simulatorResult.projectedGap > 0 ? `${money.format(simulatorResult.projectedGap)} debajo de la meta` : `${money.format(Math.abs(simulatorResult.projectedGap))} arriba de la meta`}</small>
                    </div>
                  </div>

                  <div className={`simulator-verdict mt-4 simulator-tone-${simulatorResult.verdictTone}`}>
                    <div className="projection-icon"><CircleDollarSign size={19} /></div>
                    <div>
                      <div className="eyebrow">LEBU VE ESTO</div>
                      <strong>{simulatorResult.verdictTitle}</strong>
                      <p>{simulatorResult.verdictBody}</p>
                    </div>
                  </div>

                  {simulatorResult.remainingOpenDates.length > 0 && simulatorResult.hasTarget && !simulatorResult.goalReached && (
                    <div className="panel-card mt-4 simulator-next-days">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="eyebrow">PRÓXIMOS DÍAS</div>
                          <h3 className="mt-1 text-base font-black text-[var(--ink)]">Cómo se repartiría</h3>
                        </div>
                        {simulatorResult.smartActive && <span className="simulator-smart-pill">Ritmo inteligente</span>}
                      </div>
                      <div className="mt-3 grid gap-2">
                        {simulatorResult.remainingOpenDates.slice(0, 5).map((date) => (
                          <div key={date} className="simulator-day-row">
                            <span>{formatLongDate(date)}{date === todayISO() ? ' · hoy' : ''}</span>
                            <strong>{money.format(Number(simulatorResult.targetsByDate[date] || 0))}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          <section className={`dashboard-main min-w-0 lg:col-span-2 ${activeView === 'home' ? 'block' : 'hidden'}`}>
            <div className="home-focus-shell mx-auto max-w-4xl">
              <div className="mb-5 flex items-end justify-between gap-4">
                <div>
                  <div className="eyebrow">HOY · {periodInfo.label.toUpperCase()}</div>
                  <h1 className="mt-1 text-3xl font-black tracking-[-0.035em] text-[var(--ink)] sm:text-4xl">Tu número de hoy.</h1>
                  <div className="mt-2 flex items-center gap-2 text-sm text-[var(--muted)]">
                    <CalendarDays size={15} />
                    <span>{formatPeriodRange(period.start, period.end)} · quedan {result.remainingOpenDays} días abiertos</span>
                  </div>
                </div>
                <button type="button" onClick={() => openSettingsSection('plan')} className="hidden text-sm font-bold text-[var(--brand)] sm:block">Editar plan</button>
              </div>

            <div className={`hero-card ${(result.goalReached || dailyGoal.reached) ? 'hero-card-complete' : ''}`}>
              <div className="hero-orbit hero-orbit-one" />
              <div className="hero-orbit hero-orbit-two" />
              <div className="relative z-10">
                <div className="flex flex-wrap items-center gap-2">
                  {(result.goalReached || dailyGoal.reached) && <CheckCircle2 size={17} className="text-[var(--mint)]" />}
                  <div className="text-xs font-extrabold tracking-[0.14em] text-white/65">{heroLabel}</div>
                  <span className="hero-period-pill">{periodInfo.label}</span>
                </div>

                {!result.hasTarget ? (
                  <>
                    <div className="mt-4 text-[clamp(2.65rem,8vw,5rem)] font-black leading-[.95] tracking-[-0.055em] text-white">Empecemos.</div>
                    <p className="mt-4 max-w-xl text-sm leading-6 text-white/78 sm:text-base">Definí cuánto querés ganar y qué días abrís. Lebu se ocupa de convertirlo en un objetivo diario.</p>
                    <button type="button" onClick={() => openSettingsSection('plan')} className="goal-setup-button mt-5">Configurar mi objetivo</button>
                  </>
                ) : result.goalReached ? (
                  <>
                    <div className="mt-4 text-[clamp(2.65rem,8vw,5rem)] font-black leading-[.95] tracking-[-0.055em] text-white">
                      Ya llegaste.
                    </div>
                    <p className="mt-4 max-w-xl text-sm leading-6 text-white/78 sm:text-base">
                      Alcanzaste tu objetivo de <strong className="font-extrabold text-white">{money.format(result.target)} de ganancia</strong> {periodInfo.phrase}. Con lo registrado hasta ahora, no necesitás correr atrás de ningún número diario.
                    </p>
                    {result.surplusProfit > 0 && (
                      <div className="goal-surplus-pill mt-5">+ {money.format(result.surplusProfit)} por encima de tu meta</div>
                    )}
                  </>
                ) : dailyGoal.reached ? (
                  <>
                    <div className="mt-4 text-[clamp(2.55rem,8vw,5rem)] font-black leading-[.95] tracking-[-0.055em] text-white">
                      Objetivo de hoy cumplido 🦉
                    </div>
                    <p className="mt-4 max-w-xl text-sm leading-6 text-white/78 sm:text-base">
                      Vendiste <strong className="font-extrabold text-white">{money.format(dailyGoal.todaySales)}</strong> hoy. {dailyGoal.delta > 0
                        ? <>Son <strong className="font-extrabold text-white">{money.format(dailyGoal.delta)} por encima</strong> de lo que necesitabas vender hoy.</>
                        : <>Cumpliste justo el ritmo que necesitabas hoy.</>}
                    </p>
                    {dailyGoal.nextOpenDate && dailyGoal.nextOpenTarget > 0 && (
                      <div className="goal-surplus-pill mt-5">Próximo día abierto · {money.format(dailyGoal.nextOpenTarget)}</div>
                    )}
                  </>
                ) : result.remainingOpenDays === 0 ? (
                  <>
                    <div className="mt-4 text-[clamp(2.4rem,7vw,4.7rem)] font-black leading-[.95] tracking-[-0.05em] text-white">Período cerrado.</div>
                    <p className="mt-4 max-w-xl text-sm leading-6 text-white/78 sm:text-base">Ya no quedan días abiertos en este período. Tu ganancia estimada quedó en <strong className="font-extrabold text-white">{money.format(result.currentProfit)}</strong>.</p>
                  </>
                ) : (
                  <>
                    <div className="mt-3 text-[clamp(2.6rem,8vw,5.15rem)] font-black leading-none tracking-[-0.06em] text-white">
                      {money.format(result.todayIsOpen && dailyGoal.referenceTarget > 0 ? dailyGoal.referenceTarget : result.dailyNeeded)}
                    </div>
                    <p className="mt-4 max-w-xl text-sm leading-6 text-white/72 sm:text-base">
                      {result.todayIsOpen && dailyGoal.referenceTarget > 0
                        ? <>Llevás <strong className="font-extrabold text-white">{money.format(dailyGoal.todaySales)}</strong> · te faltan <strong className="font-extrabold text-white">{money.format(Math.max(dailyGoal.referenceTarget - dailyGoal.todaySales, 0))}</strong> para cumplir el ritmo de hoy.</>
                        : <>para llegar a <strong className="font-extrabold text-white">{money.format(result.target)} de ganancia</strong> {periodInfo.phrase}.</>}
                    </p>
                  </>
                )}

                <div className="goal-path mt-7 border-t border-white/12 pt-5">
                  <div className="flex items-start justify-between gap-4 text-xs font-bold text-white/70">
                    <div>
                      <span className="block text-white/82">Tu camino al objetivo</span>
                      <span className="mt-1 block text-[10px] font-semibold text-white/48">Ventas realizadas sobre las estimaciones que Lebu cree necesarias.</span>
                    </div>
                    <span className="shrink-0 text-right">
                      {result.hasTarget ? `${money.format(result.soldSoFar)} / ${money.format(result.salesNeededForGoal)}` : 'Sin configurar'}
                    </span>
                  </div>

                  <div className="goal-path-track mt-4" role="progressbar" aria-label="Camino al objetivo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(result.goalPathProgress)}>
                    <div className="goal-path-fill" style={{ width: `${result.goalPathProgress}%` }} />
                    {result.hasTarget && result.breakEvenProgress > 0 && result.breakEvenProgress < 100 && (
                      <span
                        className="goal-path-marker goal-path-marker-break-even"
                        style={{ left: `${result.breakEvenProgress}%` }}
                        title={`Cubrir gastos · ${number.format(result.breakEvenProgress)}% del camino`}
                      />
                    )}
                    {result.hasTarget && result.expectedProgressToday > 0 && result.expectedProgressToday < 100 && (
                      <span
                        className="goal-path-marker goal-path-marker-expected"
                        style={{ left: `${result.expectedProgressToday}%` }}
                        title={`Ritmo esperado al cierre de hoy · ${number.format(result.expectedProgressToday)}%`}
                      />
                    )}
                  </div>

                  <div className="goal-path-meta mt-3">
                    <strong>{number.format(result.goalPathProgress)}% recorrido</strong>
                    {result.hasTarget && result.expectedProgressToday > 0 && (
                      <span>Ritmo al cierre de hoy · {number.format(result.expectedProgressToday)}%</span>
                    )}
                  </div>

                  {result.hasTarget && (
                    <div className="goal-path-checkpoints mt-2">
                      {result.breakEvenProgress > 0 && result.breakEvenProgress < 100 && (
                        <span><i className="goal-path-key goal-path-key-break-even" />Cubrir gastos · {number.format(result.breakEvenProgress)}%</span>
                      )}
                      {result.expectedProgressToday > 0 && result.expectedProgressToday < 100 && (
                        <span><i className="goal-path-key goal-path-key-expected" />Ritmo esperado</span>
                      )}
                    </div>
                  )}

                  <div className="goal-path-message mt-3">
                    {!result.hasTarget
                      ? 'Configurá tu objetivo para empezar.'
                      : result.goalReached
                        ? 'Objetivo alcanzado. Todo lo que sumes desde acá queda por encima de tu meta.'
                        : result.currentProfit >= 0
                          ? 'Ya cubriste los gastos. Ahora estás construyendo tu ganancia objetivo.'
                          : result.soldSoFar <= 0
                            ? 'Estás al comienzo. La primera venta ya mueve esta barra.'
                            : result.expectedSalesByToday > 0 && result.pathVsExpectedSales >= 0
                              ? `Vas ${money.format(result.pathVsExpectedSales)} por delante del ritmo esperado.`
                              : result.expectedSalesByToday > 0
                                ? `Te separan ${money.format(Math.abs(result.pathVsExpectedSales))} del ritmo esperado. Cada venta te acerca.`
                                : `Ya recorriste ${number.format(result.goalPathProgress)}% del camino. Seguí sumando.`}
                  </div>
                </div>
              </div>
            </div>


              <div className="home-pulse-grid mt-4">
                <div className="home-pulse-card">
                  <span>Vendiste en el período</span>
                  <strong>{money.format(result.soldSoFar)}</strong>
                  <small>{result.todayIsOpen ? `Hoy llevás ${money.format(dailyGoal.todaySales)}` : `Próximo día abierto: ${money.format(result.dailyNeeded)}`}</small>
                </div>
                <div className="home-pulse-card">
                  <span>Ganancia estimada</span>
                  <strong className={result.currentProfit < 0 ? 'text-[var(--danger)]' : ''}>{money.format(result.currentProfit)}</strong>
                  <small>{!result.hasTarget ? 'Configurá tu objetivo' : result.goalReached ? 'Objetivo cumplido' : `Te faltan ${money.format(result.missingProfit)}`}</small>
                </div>
              </div>

              {canManageBusiness && (
                <div className={`cash-guidance-card mt-4 ${cashGuidance.next?.status === 'gap' ? 'cash-guidance-warning' : cashGuidance.next?.status === 'covered' ? 'cash-guidance-positive' : ''}`}>
                  <div className="cash-guidance-head">
                    <div className="cash-guidance-icon"><Wallet size={19} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="eyebrow">CAJA & PRÓXIMOS COMPROMISOS</div>
                      {!cashGuidance.hasCashSnapshot ? (
                        <>
                          <strong>Confirmá tu caja una vez para arrancar.</strong>
                          <p>Lebu la va a mover solo con importes netos que conoce. No suma ventas brutas ni inventa comisiones.</p>
                        </>
                      ) : !cashGuidance.groups.length ? (
                        <>
                          <strong>Tenés {money.format(cashGuidance.estimatedCash)} de caja estimada.</strong>
                          <p>Configurá fechas de pago en tus gastos recurrentes para que Lebu también te diga qué compromiso viene primero.</p>
                        </>
                      ) : cashGuidance.next ? (
                        <>
                          <div className="cash-guidance-title-row">
                            <strong>
                              {cashGuidance.next.status === 'covered'
                                ? cashGuidance.next.daysAway === 0 ? 'El compromiso de hoy ya está cubierto.' : 'El próximo compromiso ya está cubierto.'
                                : cashGuidance.next.daysAway === 0 ? 'Hoy todavía falta caja para cubrirlo.' : `Todavía falta caja para ${formatLongDate(cashGuidance.next.date)}.`}
                            </strong>
                            <span className={`cash-confidence cash-confidence-${cashConfidenceCopy[cashGuidance.confidence].tone}`}>{cashConfidenceCopy[cashGuidance.confidence].label}</span>
                          </div>
                          <p>
                            Caja que Lebu puede seguir hoy: <b>{money.format(cashGuidance.estimatedCash)}</b>. {cashGuidance.next.items.map((item) => item.name).join(' + ')} · pendiente <b>{money.format(cashGuidance.next.total)}</b>.
                            {cashGuidance.next.status === 'covered' && cashGuidance.next.projectedCashAfter != null
                              ? <> Si no saliera otro dinero antes, después de pagarlo quedarían <b>{money.format(Math.max(cashGuidance.next.projectedCashAfter, 0))}</b>.</>
                              : cashGuidance.next.gap != null
                                ? <> Hoy faltan <b>{money.format(cashGuidance.next.gap)}</b>{cashGuidance.next.extraCashPerOpenDay != null && cashGuidance.next.extraCashPerOpenDay > 0 && cashGuidance.next.daysAway > 0 ? <>. Tenés {cashGuidance.next.openDaysUntil} día{cashGuidance.next.openDaysUntil === 1 ? '' : 's'} abierto{cashGuidance.next.openDaysUntil === 1 ? '' : 's'} para sumar aprox. <b>{money.format(cashGuidance.next.extraCashPerOpenDay)}</b> netos de caja por día.</> : '.'}</>
                                : null}
                          </p>
                        </>
                      ) : null}
                    </div>
                    <button type="button" onClick={cashGuidance.groups.length ? openCashSettings : cashGuidance.hasCashSnapshot ? openRecurringSettings : openCashSettings} className="cash-guidance-action">
                      {!cashGuidance.hasCashSnapshot ? 'Confirmar caja' : cashGuidance.groups.length ? 'Conciliar' : 'Configurar vencimientos'}
                    </button>
                  </div>

                  {cashGuidance.hasCashSnapshot && (
                    <div className="cash-estimate-strip">
                      <div><span>Confirmada</span><strong>{money.format(cashGuidance.confirmedCash)}</strong></div>
                      <div><span>Movimientos netos conocidos</span><strong className={cashGuidance.knownCashDelta < 0 ? 'text-[var(--danger)]' : ''}>{cashGuidance.knownCashDelta === 0 ? 'Sin cambios' : `${cashGuidance.knownCashDelta > 0 ? '+' : ''}${money.format(cashGuidance.knownCashDelta)}`}</strong></div>
                      <div><span>Estimada ahora</span><strong>{money.format(cashGuidance.estimatedCash)}</strong></div>
                    </div>
                  )}

                  {cashGuidance.groups.length > 0 && (
                    <div className="cash-commitment-list">
                      {cashGuidance.groups.slice(0, 3).map((commitment) => (
                        <div key={commitment.date} className="cash-commitment-row">
                          <span><CalendarClock size={14} /> {formatLongDate(commitment.date)}{commitment.daysAway === 0 ? ' · hoy' : ''}</span>
                          <div className="min-w-0">
                            <strong>{commitment.items.map((item) => item.name).join(' + ')}</strong>
                            <small>
                              Pendiente {money.format(commitment.total)}
                              {commitment.items.length === 1 && commitment.items[0].paid > 0
                                ? ` · pagado ${money.format(commitment.items[0].paid)} de ${money.format(commitment.items[0].expected)}`
                                : commitment.items.some((item) => item.paid > 0)
                                  ? ` · ${commitment.items.filter((item) => item.paid > 0).length} compromiso${commitment.items.filter((item) => item.paid > 0).length === 1 ? '' : 's'} con pago parcial`
                                  : ''}
                            </small>
                          </div>
                          {cashGuidance.hasCashSnapshot && <i className={`cash-status-dot cash-status-${commitment.status}`} aria-label={commitment.status === 'covered' ? 'Cubierto' : commitment.status === 'gap' ? 'Falta caja' : 'Sin estimar'} />}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="cash-guidance-foot">
                    {!cashGuidance.hasCashSnapshot
                      ? 'Caja separada de ganancia: confirmar este saldo no cambia tu meta.'
                      : cashGuidance.untrackedSalesCount > 0 || cashGuidance.untrackedExpenseCount > 0
                        ? `Lebu no sumó automáticamente ${cashGuidance.untrackedSalesCount} venta${cashGuidance.untrackedSalesCount === 1 ? '' : 's'} sin neto conocido${cashGuidance.untrackedExpenseCount ? ` ni ${cashGuidance.untrackedExpenseCount} gasto${cashGuidance.untrackedExpenseCount === 1 ? '' : 's'} sin impacto de caja confirmado` : ''}. Confirmá la caja cuando quieras recalibrar.`
                        : `Última confirmación ${cashGuidance.cashUpdatedToday ? 'hoy' : `hace ${cashGuidance.daysSinceConfirmation} día${cashGuidance.daysSinceConfirmation === 1 ? '' : 's'}`}. Lebu solo aplica movimientos de caja con monto neto conocido.`}
                  </div>
                </div>
              )}

              {productionHomeAlert && (
                <button
                  type="button"
                  onClick={() => { setActiveView('production'); window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' })); }}
                  className={`home-production-alert mt-4 home-production-${productionHomeAlert.tone}`}
                >
                  <div className="home-production-alert-icon"><PackageOpen size={18} /></div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="eyebrow">PRODUCCIÓN HOY</div>
                    <strong>{productionHomeAlert.title}</strong>
                    <p>{productionHomeAlert.body}</p>
                    <span>Ver producción</span>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-[var(--muted)]" />
                </button>
              )}

              {result.hasTarget && homeMiradaAnalysis.primary && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveView('insights');
                    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
                  }}
                  className="home-insight-card mt-4"
                >
                  <div className={`home-insight-icon home-insight-${homeMiradaAnalysis.primary.tone === 'attention' ? 'warning' : homeMiradaAnalysis.primary.tone}`}>
                    {homeMiradaAnalysis.primary.tone === 'positive' ? <TrendingUp size={18} /> : homeMiradaAnalysis.primary.tone === 'attention' ? <TrendingDown size={18} /> : <Eye size={18} />}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="eyebrow">LEBU VIO ESTO</div>
                    <strong>{homeMiradaAnalysis.primary.title}</strong>
                    <p>{homeMiradaAnalysis.primary.body}</p>
                    <span className="home-insight-link">Ver en Mirada</span>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-[var(--muted)]" />
                </button>
              )}

              {result.historicalSummaryActive && historicalSummary && (
                <div className="home-data-note mt-3">
                  <strong>Tu progreso inicial ya está contemplado.</strong>
                  <span>Los totales de {formatPeriodRange(historicalSummary.startDate, historicalSummary.endDate)} cuentan para el objetivo; los patrones diarios se aprenden solo con movimientos fechados.</span>
                </div>
              )}

              {!cloud.user && result.hasTarget && (
                <div className="save-business-card mt-4">
                  <div className="save-business-mark"><Cloud size={20} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="eyebrow">GUARDÁ TU NEGOCIO</div>
                    <strong>Este plan ya vive en tu dispositivo.</strong>
                    <p>Creá tu cuenta para no perderlo, usar Lebu desde otros dispositivos y sumar a tu equipo.</p>
                  </div>
                  <button type="button" onClick={() => openSettingsSection('account')} className="primary-button save-business-button">Guardar mi negocio</button>
                </div>
              )}


            {notificationPromptOpen && pushStatus === 'default' && (
              <div className="panel-card mt-4 p-5 sm:p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]"><BellRing size={21} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="eyebrow">LEBU TE PUEDE ACOMPAÑAR</div>
                    <h2 className="mt-1 text-lg font-black tracking-tight text-[var(--ink)]">¿Querés que Lebu te avise cómo arrancás el día? 🦉</h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Recibí tu objetivo diario y avisos cuando un cambio importante modifique lo que necesitás vender. El permiso del sistema se pide recién si elegís activarlas.</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={() => void activateNotifications()} disabled={pushBusy} className="primary-button justify-center disabled:opacity-50"><BellRing size={16} /> {pushBusy ? 'Activando…' : 'Activar notificaciones'}</button>
                      <button type="button" onClick={dismissNotificationPrompt} disabled={pushBusy} className="secondary-button justify-center disabled:opacity-50">Ahora no</button>
                    </div>
                    {pushMessage && <p className="mt-3 text-xs font-bold text-[var(--muted)]">{pushMessage}</p>}
                  </div>
                </div>
              </div>
            )}



            {canOperateMovements && <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => openRegister('sale')} className="primary-button flex-1">
                <ArrowUpRight size={18} /> Registrar venta
              </button>
              <button type="button" onClick={() => openRegister('expense')} className="secondary-button flex-1">
                <ArrowDownRight size={18} /> Registrar gasto
              </button>
            </div>}
            </div>
          </section>

          <section className={`production-view-shell min-w-0 lg:col-span-2 ${activeView === 'production' ? 'block' : 'hidden'}`}>
            <ProductionView
              businessId={cloud.activeBusiness?.businessId || null}
              canOperate={canOperateMovements}
              products={production.products}
              events={production.events}
              days={production.days}
              sales={sales}
              loading={production.loading}
              error={production.error}
              onRefresh={production.refresh}
              onSaveProduct={production.saveProduct}
              onDeactivateProduct={production.deactivateProduct}
              onStartDay={production.startDay}
              onAddEvents={production.addEvents}
              onCloseDay={production.closeDay}
              onReopenDay={production.reopenDay}
            />
          </section>

          <section className={`insights-view min-w-0 lg:col-span-2 ${activeView === 'insights' ? 'block' : 'hidden'}`}>
            <div className="mx-auto max-w-5xl">
              <MiradaView
                analysis={miradaAnalysis}
                theme={resolvedTheme}
                analysisWindow={miradaAnalysisWindow}
                onAnalysisWindowChange={changeMiradaAnalysisWindow}
                onOpenSimulator={openSimulator}
                onOpenStrategy={() => openSettingsSection('plan')}
                onOpenMovements={() => { setActiveView('movements'); window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' })); }}
                production={productionAnalysis}
                onOpenProduction={() => { setActiveView('production'); window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' })); }}
              />

              <details className="mirada-deep-dive mt-4">
                <summary>
                  <div className="min-w-0">
                    <div className="eyebrow">PROFUNDIZAR</div>
                    <strong>Ver proyección, cálculo y detalle del ritmo</strong>
                    <p>Todo lo avanzado sigue acá, sin ocupar la primera mirada.</p>
                  </div>
                  <ChevronRight size={18} className="mirada-deep-chevron" />
                </summary>
                <div className="mirada-deep-dive-body">
            <div className={`projection-card mt-4 ${result.projectionAvailable && result.projectedGap <= 0 ? 'projection-card-positive' : ''}`}>
              <div className="projection-icon"><ArrowUpRight size={19} /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><div className="eyebrow">PROYECCIÓN DEL PERÍODO</div><HelpTip text="Es una estimación de cómo terminarías el período si mantuvieras un ritmo parecido al observado hasta ahora. No es una promesa ni cambia tu objetivo." /></div>
                {!result.hasTarget ? (
                  <p className="mt-1 text-sm leading-6 text-[var(--muted)]">Configurá una meta y Lebu también te muestra hacia dónde vas, no solo cuánto necesitás hoy.</p>
                ) : !result.projectionAvailable ? (
                  <>
                    <div className="mt-1 text-lg font-black text-[var(--ink)]">Todavía es temprano para proyectar.</div>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Lebu necesita al menos un día abierto completo con ventas cargadas para aprender tu ritmo sin usar un día que todavía está en curso.</p>
                  </>
                ) : (
                  <>
                    <div className="mt-1 text-2xl font-black tracking-tight text-[var(--ink)]">{money.format(result.projectedProfit)} de ganancia</div>
                    <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                      Si mantenés un promedio cercano a <strong>{money.format(result.observedDailySales)}</strong> por día abierto completo,
                      {result.projectedGap > 0
                        ? <> cerrarías aproximadamente <strong>{money.format(result.projectedGap)} debajo</strong> de tu objetivo.</>
                        : <> cerrarías aproximadamente <strong>{money.format(Math.abs(result.projectedGap))} arriba</strong> de tu objetivo.</>}
                    </p>
                  </>
                )}
              </div>
            </div>

            {result.hasTarget && smartDistributionEnabled && (
              <div className={`smart-target-card mt-4 ${result.smartActive ? 'smart-target-card-active' : ''}`}>
                <div className="projection-icon"><TrendingUp size={19} /></div>
                <div className="min-w-0 flex-1">
                  <div className="eyebrow">RITMO INTELIGENTE</div>
                  {!smartModel.ready ? (
                    <>
                      <div className="mt-1 text-lg font-black text-[var(--ink)]">Lebu está aprendiendo qué días pesan más.</div>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Con {smartModel.totalSamples} días útiles de historial, todavía mantenemos el reparto parejo. La distribución se activa sola cuando hay suficiente evidencia.</p>
                      <div className="smart-learning-track mt-3"><span style={{ width: `${smartModel.progress}%` }} /></div>
                      <div className="mt-2 text-[11px] font-bold text-[var(--muted)]">Aprendizaje {smartModel.progress}% · necesitamos variedad de días, no solo volumen.</div>
                    </>
                  ) : (
                    <>
                      <div className="mt-1 text-lg font-black text-[var(--ink)]">El objetivo ya se adapta a tu semana.</div>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">El total que necesitás vender no cambia: Lebu reparte más carga en tus días históricamente fuertes y menos en los flojos.</p>
                      <div className="smart-target-grid mt-3">
                        {result.remainingOpenDates.slice(0, 4).map((date) => (
                          <div key={date} className="smart-target-day">
                            <span>{formatLongDate(date)}{date === todayISO() ? ' · hoy' : ''}</span>
                            <strong>{money.format(Number(result.smartTargetsByDate[date] || 0))}</strong>
                          </div>
                        ))}
                      </div>
                      {(() => {
                        const learned = smartModel.stats.filter((item) => item.samples >= 2).sort((a, b) => b.weight - a.weight);
                        const strongest = learned[0];
                        const weakest = learned[learned.length - 1];
                        if (!strongest || !weakest || strongest.weekday === weakest.weekday) return null;
                        return <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">Hasta ahora, <strong>{weekdayLabel(strongest.weekday)}</strong> aparece como tu día más fuerte y <strong>{weekdayLabel(weakest.weekday)}</strong> como el más liviano. Lebu seguirá ajustando esto con cada semana nueva.</p>;
                      })()}
                    </>
                  )}
                </div>
              </div>
            )}

            <details className="calculation-card mt-4">
              <summary>
                <span>Cómo se calcula</span>
                <span className="calculation-summary-value">{money.format(result.additionalSalesNeeded)} por vender</span>
              </summary>
              <div className="calculation-body">
                <CalculationRow label="Ganancia objetivo" value={result.target} />
                <CalculationRow label="Gastos recurrentes pendientes" value={result.recurringTotal} positive />
                {result.recurringCoveredTotal > 0 && <CalculationRow label="Recurrentes cubiertos por el acumulado" value={result.recurringCoveredTotal} positive />}
                <CalculationRow label={result.historicalSummaryActive ? 'Gastos acumulados y registrados' : 'Otros gastos registrados'} value={result.variableSpent} positive />
                <CalculationRow label="Ventas realizadas" value={result.soldSoFar} negative />
                <div className="calculation-divider" />
                <CalculationRow label="Ganancia que todavía falta" value={result.missingProfit} strong />
                {result.smartActive && (
                  <div className="calculation-note">
                    El reparto diario usa tu historial reciente por día de la semana. <strong>La meta total no cambia</strong>; solo cambia cuánto peso recibe cada día abierto.
                  </div>
                )}
                {result.variableRate > 0 && (
                  <div className="calculation-note">
                    Para proyectar las ventas que faltan, Lebu contempla un costo variable observado del <strong>{Math.round(result.variableRate * 100)}%</strong>.
                  </div>
                )}
                <div className="calculation-total">
                  <span>Ventas adicionales estimadas</span>
                  <strong>{money.format(result.additionalSalesNeeded)}</strong>
                </div>
                <p className="calculation-footnote">Los recurrentes se distribuyen por día calendario. Un día cerrado sigue teniendo costo; simplemente no cuenta como día disponible para vender.</p>
              </div>
            </details>

            {result.hasTarget && (
              <details className="history-card mt-4">
                <summary>
                  <div className="min-w-0">
                    <div className="eyebrow">EVOLUCIÓN DEL PERÍODO</div>
                    <div className="mt-1 text-base font-black text-[var(--ink)]">
                      {!history.paceAvailable
                        ? 'Todavía estamos construyendo el ritmo.'
                        : history.paceDelta >= 0
                          ? `${money.format(Math.abs(history.paceDelta))} arriba del ritmo`
                          : `${money.format(Math.abs(history.paceDelta))} debajo del ritmo`}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">La comparación usa solo días abiertos ya terminados para no castigarte por un día que todavía está en curso.</p>
                  </div>
                  <ChevronRight size={18} className="history-chevron" />
                </summary>
                <div className="history-body">
                  {history.paceAvailable && (
                    <div className={`pace-summary ${history.paceDelta >= 0 ? 'pace-summary-positive' : 'pace-summary-warning'}`}>
                      <div>
                        <span>Ventas en días completos</span>
                        <strong>{money.format(history.completedSales)}</strong>
                      </div>
                      <div>
                        <span>Ritmo de referencia</span>
                        <strong>{money.format(history.expectedSales)}</strong>
                      </div>
                    </div>
                  )}
                  <div className="history-legend">
                    <span><i className="history-legend-sale" /> Venta real</span>
                    <span><i className="history-legend-reference" /> Referencia actual</span>
                  </div>
                  <div className="history-days">
                    {history.rows.length ? history.rows.map((row) => (
                      <div className="history-day" key={row.date}>
                        <div className="history-day-head">
                          <span className="font-extrabold text-[var(--ink)]">{formatLongDate(row.date)}{row.isToday ? ' · hoy' : ''}</span>
                          <strong>{money.format(row.actualSales)}</strong>
                        </div>
                        <div className="history-track">
                          <div className="history-reference" style={{ left: `${Math.min((row.referenceDailySales / history.scaleMax) * 100, 100)}%` }} />
                          <div className="history-bar" style={{ width: `${Math.min((row.actualSales / history.scaleMax) * 100, 100)}%` }} />
                        </div>
                        <div className="history-day-foot">
                          <span>Referencia: {money.format(row.referenceDailySales)}</span>
                          {row.snapshotTarget !== null && <span>Meta que mostraba Lebu: {money.format(row.snapshotTarget)}</span>}
                        </div>
                      </div>
                    )) : (
                      <p className="py-3 text-xs leading-5 text-[var(--muted)]">Todavía no hay días abiertos transcurridos en este período.</p>
                    )}
                  </div>
                  <p className="history-note">La serie de “Meta que mostraba Lebu” empieza a guardarse desde la versión 1.5. No rellenamos días anteriores con números inventados.</p>
                </div>
              </details>
            )}
                </div>
              </details>
            </div>
          </section>

          <aside className={`dashboard-aside panel-card min-w-0 ${activeView === 'movements' ? 'block lg:col-span-2 lg:mt-0' : 'hidden'}`}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="eyebrow">MOVIMIENTOS</div>
                <h2 className="mt-1 text-xl font-black tracking-tight">Ventas y gastos</h2>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="soft-pill">{movements.length}</span>
                {canOperateMovements && <>
                  {canImportMovements && <button type="button" onClick={() => setMovementImportOpen(true)} className="small-button movements-add-button"><Upload size={16} /> Importar</button>}
                  <button type="button" onClick={() => openRegister('sale')} className="small-button movements-add-button"><Plus size={16} /> Registrar</button>
                </>}
              </div>
            </div>

            <div className="mt-5 divide-y divide-[var(--line)]">
              {visibleMovements.length ? visibleMovements.map((movement) => (
                <MovementRow key={`${movement.kind}-${movement.id}`} movement={movement} canEdit={canEditMovement(movement)} onEdit={() => openMovementEditor(movement)} />
              )) : (
                <div className="py-8 text-center text-sm text-[var(--muted)]">Todavía no hay movimientos en este período.</div>
              )}
            </div>



            <div className="mt-5 rounded-2xl bg-[var(--surface-soft)] p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-[var(--muted)]">Proyección de costos futuros</span>
                <strong className="text-[var(--brand)]">Conservadora</strong>
              </div>
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                Lebu no supone que un gasto importado crece con tus ventas. Hasta poder clasificar costos variables de forma explícita, solo usa gastos ya conocidos y recurrentes configurados.
              </p>
            </div>
          </aside>
        </div>
      </div>

      {canOperateMovements && !settingsOpen && !registerOpen && !movementImportOpen && (activeView === 'home' || activeView === 'movements') && (
        <>
          {quickActionOpen && (
            <div className="mobile-quick-menu md:hidden" role="menu" aria-label="Agregar movimiento">
              <button type="button" onClick={() => { setQuickActionOpen(false); openRegister('sale'); }} className="mobile-quick-menu-item"><ArrowUpRight size={17} /> Venta</button>
              <button type="button" onClick={() => { setQuickActionOpen(false); openRegister('expense'); }} className="mobile-quick-menu-item"><ArrowDownRight size={17} /> Gasto</button>
            </div>
          )}
          <button type="button" onClick={() => setQuickActionOpen((value) => !value)} className={`mobile-quick-add md:hidden ${quickActionOpen ? 'mobile-quick-add-open' : ''}`} aria-label={quickActionOpen ? 'Cerrar acciones rápidas' : 'Agregar venta o gasto'} aria-expanded={quickActionOpen}>
            <Plus size={24} />
          </button>
        </>
      )}

      <nav className={`mobile-primary-nav md:hidden ${settingsOpen && settingsSection === 'plan' ? 'mobile-primary-nav-strategy' : ''}`} aria-label="Navegación principal">
        <button type="button" onClick={() => { setQuickActionOpen(false); setSettingsOpen(false); setActiveView('home'); }} className={activeView === 'home' && !(settingsOpen && settingsSection === 'plan') ? 'mobile-nav-item mobile-nav-item-active' : 'mobile-nav-item'}><House size={19} /><span>Inicio</span></button>
        <button type="button" onClick={() => { setQuickActionOpen(false); setSettingsOpen(false); setActiveView('movements'); }} className={activeView === 'movements' && !(settingsOpen && settingsSection === 'plan') ? 'mobile-nav-item mobile-nav-item-active' : 'mobile-nav-item'}><ListChecks size={19} /><span>Movimientos</span></button>
        <button type="button" onClick={() => { setQuickActionOpen(false); setSettingsOpen(false); setActiveView('production'); }} className={activeView === 'production' && !(settingsOpen && settingsSection === 'plan') ? 'mobile-nav-item mobile-nav-item-active' : 'mobile-nav-item'}><PackageOpen size={19} /><span>Producción</span></button>
        <button type="button" onClick={() => { setQuickActionOpen(false); setSettingsOpen(false); setActiveView('insights'); }} className={(activeView === 'insights' || activeView === 'simulator') && !(settingsOpen && settingsSection === 'plan') ? 'mobile-nav-item mobile-nav-item-active' : 'mobile-nav-item'}><Eye size={19} /><span>Mirada</span></button>
        <button type="button" onClick={() => { setQuickActionOpen(false); openSettingsSection('plan'); }} className={settingsOpen && settingsSection === 'plan' ? 'mobile-nav-item mobile-nav-item-active' : 'mobile-nav-item'}><Target size={19} /><span>Estrategia</span></button>
      </nav>

      {startingDataOpen && canManageBusiness && (
        <Modal onClose={finishStartingDataSetup} wide>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="eyebrow">ARRANCÁ CON LO QUE YA SABÉS</div>
              <h2 className="mt-1 text-2xl font-black tracking-tight">¿Con qué información querés empezar?</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">No necesitás reconstruir todo tu historial. Lebu puede importar movimientos, tomar un acumulado real o empezar desde hoy.</p>
            </div>
            <button type="button" onClick={finishStartingDataSetup} className="icon-button shrink-0"><X size={20} /></button>
          </div>

          {startingDataMode === 'choices' ? (
            <div className="mt-6 grid gap-3 lg:grid-cols-3">
              <button type="button" onClick={startImportFromStartingData} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 text-left transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]">
                <Upload size={22} className="text-[var(--brand)]" />
                <strong className="mt-4 block text-base text-[var(--ink)]">Tengo Excel o CSV</strong>
                <span className="mt-2 block text-xs leading-5 text-[var(--muted)]">Importá ventas o gastos con fechas reales. Podés repetirlo para cada tipo de movimiento.</span>
              </button>
              <button type="button" onClick={() => { setHistoricalDraft(defaultHistoricalDraft()); setStartingDataMode('totals'); }} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 text-left transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]">
                <CircleDollarSign size={22} className="text-[var(--brand)]" />
                <strong className="mt-4 block text-base text-[var(--ink)]">Sé mis totales</strong>
                <span className="mt-2 block text-xs leading-5 text-[var(--muted)]">Cargá cuánto vendiste y gastaste hasta una fecha, sin fingir que ocurrió todo en un solo día.</span>
              </button>
              <button type="button" onClick={finishStartingDataSetup} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 text-left transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]">
                <PlayCircle size={22} className="text-[var(--brand)]" />
                <strong className="mt-4 block text-base text-[var(--ink)]">Empiezo desde cero</strong>
                <span className="mt-2 block text-xs leading-5 text-[var(--muted)]">No cargamos historial. Desde hoy, cada venta y gasto nuevo irá formando tu Mirada.</span>
              </button>
            </div>
          ) : (
            <div className="mt-6">
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
                <strong className="text-sm text-[var(--ink)]">Resumen acumulado, no movimientos ficticios</strong>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Estos importes cuentan para tu progreso y tu ganancia estimada, pero quedan fuera del análisis por día. Cada total funciona por separado: si dejás Ventas vacío, podés importar ventas con fecha dentro del mismo rango; y lo mismo con Gastos.</p>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="field-label">Desde</span>
                  <input type="date" min={period.start} max={historicalDraft.endDate || period.end} value={historicalDraft.startDate} onChange={(event) => setHistoricalDraft((current) => ({ ...current, startDate: event.target.value }))} className="field-input mt-2 w-full" />
                </label>
                <label className="block">
                  <span className="field-label">Hasta</span>
                  <input type="date" min={historicalDraft.startDate || period.start} max={historicalCutoff(period.start, period.end)} value={historicalDraft.endDate} onChange={(event) => setHistoricalDraft((current) => ({ ...current, endDate: event.target.value }))} className="field-input mt-2 w-full" />
                </label>
                <label className="block">
                  <span className="field-label">Ventas acumuladas <em className="font-normal not-italic text-[var(--muted)]">(opcional)</em></span>
                  <MoneyInput value={historicalDraft.salesTotal} onChange={(value) => setHistoricalDraft((current) => ({ ...current, salesTotal: value }))} />
                </label>
                <label className="block">
                  <span className="field-label">Gastos acumulados <em className="font-normal not-italic text-[var(--muted)]">(opcional)</em></span>
                  <MoneyInput value={historicalDraft.expensesTotal} onChange={(value) => setHistoricalDraft((current) => ({ ...current, expensesTotal: value }))} />
                </label>
              </div>

              {parseMoney(historicalDraft.expensesTotal) > 0 && (
                <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
                  <input type="checkbox" checked={historicalDraft.expensesIncludeRecurring} onChange={(event) => setHistoricalDraft((current) => ({ ...current, expensesIncludeRecurring: event.target.checked }))} className="mt-0.5 h-4 w-4 accent-[var(--brand)]" />
                  <span className="text-xs leading-5 text-[var(--muted)]"><strong className="text-[var(--ink)]">El total de gastos ya incluye gastos que se repiten</strong><br />Marcá esto si dentro del acumulado ya están alquiler, sueldos, servicios u otros recurrentes. Lebu no duplica lo ya contemplado y, si vuelven a ocurrir después de la fecha del acumulado, suma solamente esa parte futura.</span>
                </label>
              )}

              <p className="mt-4 text-xs leading-5 text-[var(--muted)]">Lebu aplica el rango únicamente al tipo de dato cuyo total cargaste. Si, por ejemplo, cargaste solo Gastos, tus ventas importadas o registradas con fecha siguen contando normalmente.</p>

              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setStartingDataMode('choices')} className="secondary-button">Atrás</button>
                <button type="button" onClick={saveHistoricalSummary} disabled={!historicalDraft.startDate || !historicalDraft.endDate || historicalDraft.startDate > historicalDraft.endDate || historicalDraft.startDate < period.start || historicalDraft.endDate > period.end || historicalDraft.endDate > historicalCutoff(period.start, period.end) || (parseMoney(historicalDraft.salesTotal) <= 0 && parseMoney(historicalDraft.expensesTotal) <= 0)} className="primary-button disabled:cursor-not-allowed disabled:opacity-45">Guardar progreso</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {movementImportOpen && canImportMovements && (
        <MovementImportModal
          categories={categories}
          existingSales={sales}
          existingExpenses={expenses}
          recurringCosts={recurringCosts}
          businessKey={cloud.businessId || 'local'}
          sessionMode={startingDataImportPending}
          onClose={() => { setMovementImportOpen(false); if (startingDataImportPending) { setStartingDataImportPending(false); maybeSuggestNotifications(); } }}
          onImport={importPreparedMovements}
        />
      )}

      {registerOpen && (
        <Modal onClose={() => setRegisterOpen(false)}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="eyebrow">MOVIMIENTO RÁPIDO</div>
              <h2 className="mt-1 text-2xl font-black tracking-tight">Registrar</h2>
            </div>
            <button type="button" onClick={() => setRegisterOpen(false)} className="icon-button"><X size={20} /></button>
          </div>

          <div className="mt-6 grid grid-cols-2 rounded-2xl bg-[var(--surface-soft)] p-1">
            <button type="button" onClick={() => setRegisterKind('sale')} className={`segment-button ${registerKind === 'sale' ? 'segment-button-active' : ''}`}>
              Venta
            </button>
            <button type="button" onClick={() => setRegisterKind('expense')} className={`segment-button ${registerKind === 'expense' ? 'segment-button-active' : ''}`}>
              Gasto
            </button>
          </div>

          {registerKind === 'sale' ? (
            <div className="mt-7">
              <label className="field-label">¿Cuánto vendiste?</label>
              <MoneyInput value={saleDraft.amount} onChange={(value) => setSaleDraft((current) => ({ ...current, amount: value }))} autoFocus />
              <label className="mt-5 block">
                <span className="field-label">Fecha</span>
                <input type="date" value={saleDraft.date} onChange={(event) => setSaleDraft((current) => ({ ...current, date: event.target.value }))} className="field-input" />
              </label>
              <button type="button" onClick={saveSale} className="primary-button mt-7 w-full justify-center">Guardar venta</button>
            </div>
          ) : (
            <div className="mt-7">
              <label className="field-label">¿Cuánto gastaste?</label>
              <MoneyInput value={expenseDraft.amount} onChange={(value) => setExpenseDraft((current) => ({ ...current, amount: value }))} autoFocus />

              <div className="mt-5">
                <div className="field-label">Categoría</div>
                <div className="flex flex-wrap gap-2">
                  {visibleExpenseCategories.map((category) => (
                    <button
                      type="button"
                      key={category}
                      onClick={() => setExpenseDraft((current) => ({ ...current, category }))}
                      className={`category-chip ${expenseDraft.category === category ? 'category-chip-active' : ''}`}
                    >
                      {category}
                    </button>
                  ))}
                  {recentCategories.length > 5 && (
                    <button type="button" onClick={() => setShowAllExpenseCategories((value) => !value)} className="category-chip">
                      {showAllExpenseCategories ? 'Ver menos' : `Ver todas (${recentCategories.length})`}
                    </button>
                  )}
                  {canManageBusiness && <button type="button" onClick={() => setShowCustomCategory(true)} className="category-chip">+ Otra</button>}
                </div>
                {showCustomCategory && (
                  <div className="mt-3 flex gap-2">
                    <input value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} placeholder="Nueva categoría" className="field-input flex-1" />
                    <button type="button" onClick={saveCustomCategory} className="small-button">Usar</button>
                  </div>
                )}
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="field-label">Fecha</span>
                  <input type="date" value={expenseDraft.date} onChange={(event) => setExpenseDraft((current) => ({ ...current, date: event.target.value }))} className="field-input" />
                </label>
                <label className="block">
                  <span className="field-label">Nota <span className="font-medium text-[var(--muted)]">(opcional)</span></span>
                  <input value={expenseDraft.note} onChange={(event) => setExpenseDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Ej.: compra semanal" className="field-input" />
                </label>
              </div>

              <label className="cash-paid-toggle mt-5">
                <input
                  type="checkbox"
                  checked={expenseDraft.cashPaid}
                  onChange={(event) => setExpenseDraft((current) => ({ ...current, cashPaid: event.target.checked }))}
                />
                <span>
                  <strong>Ya salió de caja</strong>
                  <small>Lebu puede descontarlo de la caja estimada porque conoce el monto exacto. Desmarcalo si solo estás registrando el gasto para analizarlo.</small>
                </span>
              </label>

              <div className="recurring-warning mt-5">
                <Repeat2 size={16} />
                <span>Si este gasto ya está configurado como recurrente (por ejemplo alquiler o sueldo), no lo cargues otra vez: Lebu ya lo contempla automáticamente.</span>
              </div>

              <button type="button" onClick={saveExpense} className="primary-button mt-5 w-full justify-center">Guardar gasto</button>
            </div>
          )}
        </Modal>
      )}

      {editingMovement && (
        <Modal onClose={() => setEditingMovement(null)}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="eyebrow">EDITAR MOVIMIENTO</div>
              <h2 className="mt-1 text-2xl font-black tracking-tight">{editingMovement.kind === 'sale' ? 'Venta' : 'Gasto'}</h2>
            </div>
            <button type="button" onClick={() => setEditingMovement(null)} className="icon-button"><X size={20} /></button>
          </div>

          <div className="mt-7">
            <label className="field-label">Importe</label>
            <MoneyInput value={editingMovement.amount} onChange={(value) => setEditingMovement((current) => current ? { ...current, amount: value } : current)} autoFocus />
            <label className="mt-5 block">
              <span className="field-label">Fecha</span>
              <input type="date" value={editingMovement.date} onChange={(event) => setEditingMovement((current) => current ? { ...current, date: event.target.value } : current)} className="field-input" />
            </label>

            {editingMovement.kind === 'expense' && (
              <>
                <label className="mt-5 block">
                  <span className="field-label">Categoría</span>
                  <select value={editingMovement.category} onChange={(event) => setEditingMovement((current) => current ? { ...current, category: event.target.value } : current)} className="field-input">
                    {Array.from(new Set([editingMovement.category, ...categories])).filter(Boolean).map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </label>
                <label className="mt-5 block">
                  <span className="field-label">Nota <span className="font-medium text-[var(--muted)]">(opcional)</span></span>
                  <input value={editingMovement.note} onChange={(event) => setEditingMovement((current) => current ? { ...current, note: event.target.value } : current)} className="field-input" placeholder="Ej.: compra semanal" />
                </label>
                {recurringCosts.length > 0 && (
                  <div className="mt-5 grid gap-3">
                    <label className="block">
                      <span className="field-label">¿Corresponde a un gasto recurrente?</span>
                      <select
                        value={editingMovement.recurringCostId == null ? '' : String(editingMovement.recurringCostId)}
                        onChange={(event) => {
                          const recurringCostId = event.target.value ? Number(event.target.value) : null;
                          setEditingMovement((current) => {
                            if (!current) return current;
                            const recurring = recurringCostId == null ? null : recurringCosts.find((item) => item.id === recurringCostId) || null;
                            return {
                              ...current,
                              recurringCostId,
                              recurringOccurrenceDate: recurring ? recurringOccurrenceDateForExpense(recurring, current.date) : null,
                            };
                          });
                        }}
                        className="field-input"
                      >
                        <option value="">No, es un gasto aparte</option>
                        {recurringCosts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </label>
                    {editingMovement.recurringCostId != null && (() => {
                      const recurring = recurringCosts.find((item) => item.id === editingMovement.recurringCostId);
                      if (!recurring) return null;
                      const occurrenceDates = Array.from(new Set([
                        ...recurringOccurrenceCandidates(recurring, editingMovement.date),
                        editingMovement.recurringOccurrenceDate || recurringOccurrenceDateForExpense(recurring, editingMovement.date),
                      ].filter(Boolean))).sort();
                      return (
                        <label className="block">
                          <span className="field-label">¿A qué ocurrencia corresponde este pago?</span>
                          <select
                            value={editingMovement.recurringOccurrenceDate || recurringOccurrenceDateForExpense(recurring, editingMovement.date)}
                            onChange={(event) => setEditingMovement((current) => current ? { ...current, recurringOccurrenceDate: event.target.value } : current)}
                            className="field-input"
                          >
                            {occurrenceDates.map((date) => <option key={date} value={date}>{recurringOccurrenceLabel(recurring, date)}</option>)}
                          </select>
                          <span className="mt-1 block text-[10px] leading-4 text-[var(--muted)]">Elegí el mes, semana o quincena que realmente estás pagando. Esto es clave para pagos parciales o atrasados.</span>
                        </label>
                      );
                    })()}
                    <span className="block text-[10px] leading-4 text-[var(--muted)]">Los pagos vinculados se acumulan contra esa misma obligación. Mientras quede saldo, Lebu mantiene la parte pendiente.</span>
                  </div>
                )}
                <label className="cash-paid-toggle mt-5">
                  <input
                    type="checkbox"
                    checked={editingMovement.cashPaid}
                    onChange={(event) => setEditingMovement((current) => current ? { ...current, cashPaid: event.target.checked } : current)}
                  />
                  <span><strong>Ya salió de caja</strong><small>Si está marcado, Lebu usa este egreso exacto para actualizar la caja estimada.</small></span>
                </label>
              </>
            )}

            <div className="mt-7 grid gap-2 sm:grid-cols-[1fr_auto]">
              <button type="button" onClick={saveMovementEdit} className="primary-button justify-center">Guardar cambios</button>
              <button type="button" onClick={deleteEditingMovement} className="danger-button justify-center"><Trash2 size={16} /> Eliminar</button>
            </div>
          </div>
        </Modal>
      )}

      {toast && (
        <div className="lebu-toast" role="status" aria-live="polite">
          <CheckCircle2 size={18} />
          <span className="min-w-0 flex-1">{toast}</span>
          {undoMovement && (
            <button type="button" onClick={undoLastMovement} className="toast-action"><Undo2 size={15} /> Deshacer</button>
          )}
        </div>
      )}

      {onboardingOpen && (
        <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-label="Configurar Lebu">
          <div className="onboarding-card onboarding-card-activation">
            <button type="button" onClick={() => closeOnboarding(true)} className="icon-button onboarding-close" aria-label="Cerrar configuración"><X size={19} /></button>
            <div className="onboarding-brand"><img src="/lebu-mark.png" alt="" /><span>Lebu</span></div>
            <div className="onboarding-progress">{[0,1,2,3].map((step) => <span key={step} className={step <= onboardingStep ? 'active' : ''} />)}</div>

            {onboardingStep === 0 && (
              <div className="onboarding-content activation-content">
                <div className="onboarding-icon"><RefreshCw size={26} /></div>
                <div className="eyebrow">CONECTÁ TU OPERACIÓN</div>
                <h2>¿Usás FUDO?</h2>
                <p>Si lo conectás, Lebu trae la actividad real del negocio y vos no tenés que volver a cargar las mismas ventas en dos lugares.</p>

                {!cloud.user ? (
                  <div className="cloud-account-card mt-5 text-left">
                    <div className="text-sm font-black text-[var(--ink)]">Para conectar FUDO, primero guardemos tu negocio</div>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Las credenciales de FUDO se guardan cifradas en el servidor, por eso la integración necesita una cuenta Lebu.</p>
                    <div className="mt-3 grid gap-2">
                      <input type="email" autoComplete="email" value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} placeholder="tu@email.com" className="field-input" />
                      <input type="password" autoComplete="current-password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} placeholder="Contraseña (mínimo 6 caracteres)" className="field-input" />
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <button type="button" onClick={() => void handleCloudAuth('signup')} disabled={accountBusy || !accountEmail.trim() || accountPassword.length < 6 || !isOnline} className="primary-button justify-center disabled:opacity-45">{accountBusy ? 'Preparando…' : 'Crear cuenta'}</button>
                      <button type="button" onClick={() => void handleCloudAuth('signin')} disabled={accountBusy || !accountEmail.trim() || accountPassword.length < 6 || !isOnline} className="secondary-button justify-center disabled:opacity-45">Ya tengo cuenta</button>
                    </div>
                    {cloud.message && <p className="mt-3 text-xs font-bold text-[var(--danger)]">{cloud.message}</p>}
                  </div>
                ) : fudoStatus.connected ? (
                  <div className="cloud-account-card mt-5 text-left">
                    <div className="flex items-center gap-2 text-sm font-black text-[var(--ink)]"><CheckCircle2 size={17} /> FUDO ya está conectado</div>
                    <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Lebu va a usar FUDO como fuente de ventas. Encontramos {number.format(sales.filter((sale) => sale.source === 'fudo').length)} ventas FUDO en Cloud.</p>
                    {fudoStatus.lastSyncAt && <p className="mt-2 text-[10px] font-bold text-[var(--muted)]">Última sincronización {new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(fudoStatus.lastSyncAt))}</p>}
                  </div>
                ) : (
                  <div className="cloud-account-card mt-5 text-left">
                    <div className="text-sm font-black text-[var(--ink)]">Conectar FUDO</div>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">La API pública de FUDO está disponible en Plan Pro. Pegá las credenciales del usuario API: Lebu las prueba antes de guardarlas y después trae 90 días de ventas para no arrancar ciego.</p>
                    <div className="mt-3 grid gap-2">
                      <input type="password" autoComplete="off" value={fudoApiKey} onChange={(event) => setFudoApiKey(event.target.value)} placeholder="API Key" className="field-input" />
                      <input type="password" autoComplete="off" value={fudoApiSecret} onChange={(event) => setFudoApiSecret(event.target.value)} placeholder="API Secret" className="field-input" />
                    </div>
                    <button type="button" onClick={() => void handleConnectFudo()} disabled={fudoBusy || !isOnline || !fudoApiKey.trim() || !fudoApiSecret.trim()} className="primary-button mt-3 w-full justify-center disabled:opacity-45">{fudoBusy ? <><RefreshCw size={15} className="animate-spin" /> Conectando…</> : 'Conectar FUDO'}</button>
                    {fudoMessage && <p className="mt-3 text-xs font-bold text-[var(--danger)]">{fudoMessage}</p>}
                  </div>
                )}

                <button type="button" onClick={() => setActivationDataSource('manual')} className={`activation-option mt-4 w-full ${activationDataSource === 'manual' ? 'activation-option-selected' : ''}`}>
                  <PlayCircle size={21} /><span><strong>No uso FUDO</strong><small>Podés seguir con Excel, totales o carga manual.</small></span><ChevronRight size={17} />
                </button>
              </div>
            )}

            {onboardingStep === 1 && (
              <div className="onboarding-content activation-content">
                <div className="onboarding-icon"><Target size={26} /></div>
                <div className="eyebrow">LO QUE FUDO NO SABE</div>
                <h2>¿Cuánto querés ganar?</h2>
                <p>FUDO nos dice qué pasó. Este número le dice a Lebu hacia dónde querés llevar el negocio.</p>
                <div className="activation-form mt-5">
                  <div className="period-selector">
                    {(['weekly', 'biweekly', 'monthly'] as PeriodType[]).map((type) => (
                      <button key={type} type="button" onClick={() => setActivationDraft((current) => ({ ...current, periodType: type }))} className={`period-option ${activationDraft.periodType === type ? 'period-option-active' : ''}`}>
                        {periodCopy[type].label}
                      </button>
                    ))}
                  </div>
                  <label className="mt-4 block text-left">
                    <span className="field-label">Quiero ganar {periodCopy[activationDraft.periodType].phrase}</span>
                    <MoneyInput value={activationDraft.profitTarget} onChange={(value) => setActivationDraft((current) => ({ ...current, profitTarget: value }))} />
                  </label>
                </div>
              </div>
            )}

            {onboardingStep === 2 && (
              <div className="onboarding-content activation-content">
                <div className="onboarding-icon"><CalendarDays size={26} /></div>
                <div className="eyebrow">TU SEMANA REAL</div>
                <h2>¿Qué días vas a abrir?</h2>
                <p>{fudoStatus.connected && activationDaysSuggestedFromFudo ? 'Te sugerimos estos días según la actividad que encontramos en FUDO. Confirmalos o corregilos pensando en cómo vas a operar de ahora en adelante.' : 'Lebu reparte el esfuerzo solo entre los días en los que realmente podés vender.'}</p>
                <div className="weekday-grid mt-5">
                  {weekdayOptions.map((day) => (
                    <button key={day.value} type="button" onClick={() => toggleActivationOpenDay(day.value)} className={`weekday-button ${activationDraft.openWeekdays.includes(day.value) ? 'weekday-button-active' : ''}`} title={day.label}>
                      {day.short}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {onboardingStep === 3 && (
              <div className="onboarding-content activation-content">
                <div className="onboarding-icon onboarding-owl"><img src="/lebu-mark.png" alt="Lechuza de Lebu" /></div>
                {fudoStatus.connected && activationDataSource !== 'manual' ? (<>
                  <div className="eyebrow">LISTO PARA MIRAR</div>
                  <h2>Lebu ya puede empezar</h2>
                  <p>Las ventas vienen de FUDO. Vos mantenés en Lebu el objetivo, los días abiertos, los recurrentes futuros y las decisiones que FUDO no conoce.</p>
                  <div className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--brand-soft)]/60 p-4 text-left text-xs leading-5 text-[var(--ink-soft)]">
                    <strong>{number.format(sales.filter((sale) => sale.source === 'fudo').length)} ventas FUDO disponibles.</strong><br />Las ventas en efectivo tienen impacto de caja conocido; los demás medios quedan conservadores hasta conocer su neto real.
                  </div>
                  <button type="button" onClick={finishActivationWithFudo} disabled={parseMoney(activationDraft.profitTarget) <= 0} className="primary-button mt-5 w-full justify-center disabled:opacity-45">Entrar a Lebu</button>
                </>) : (<>
                  <div className="eyebrow">ÚLTIMO PASO</div>
                  <h2>¿Con qué información arrancamos?</h2>
                  <p>Sin FUDO, mantenemos las alternativas actuales para que Lebu pueda empezar igual.</p>
                  <div className="activation-data-options mt-5">
                    <button type="button" onClick={() => finishActivationWith('import')} className="activation-option"><Upload size={21} /><span><strong>Tengo Excel o CSV</strong><small>Importamos movimientos con sus fechas reales.</small></span><ChevronRight size={17} /></button>
                    <button type="button" onClick={() => finishActivationWith('totals')} className="activation-option"><CircleDollarSign size={21} /><span><strong>Sé mis totales</strong><small>Cargás ventas y gastos acumulados sin inventar días.</small></span><ChevronRight size={17} /></button>
                    <button type="button" onClick={() => finishActivationWith('zero')} className="activation-option"><PlayCircle size={21} /><span><strong>Empiezo desde hoy</strong><small>Lebu aprende con cada movimiento nuevo.</small></span><ChevronRight size={17} /></button>
                  </div>
                </>)}
              </div>
            )}

            <div className="onboarding-actions">
              <button type="button" onClick={() => closeOnboarding(true)} className="onboarding-skip">Explorar sin configurar</button>
              <div className="flex gap-2">
                {onboardingStep > 0 && <button type="button" onClick={() => setOnboardingStep((step) => Math.max(0, step - 1))} className="secondary-button">Atrás</button>}
                {onboardingStep < 3 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onboardingStep === 0 && fudoStatus.connected && activationDataSource !== 'manual') setActivationDataSource('fudo');
                      setOnboardingStep((step) => Math.min(3, step + 1));
                    }}
                    disabled={(onboardingStep === 0 && !(activationDataSource === 'manual' || fudoStatus.connected)) || (onboardingStep === 1 && parseMoney(activationDraft.profitTarget) <= 0)}
                    className="primary-button disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    Continuar <ChevronRight size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <Modal onClose={() => setSettingsOpen(false)} wide sheetClassName={settingsSection === 'plan' ? 'strategy-modal-sheet' : ''}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="eyebrow">{currentSettingsCopy.eyebrow}</div>
              <h2 className="mt-1 text-2xl font-black tracking-tight">{currentSettingsCopy.title}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{currentSettingsCopy.description}</p>
            </div>
            <button type="button" onClick={() => setSettingsOpen(false)} className="icon-button"><X size={20} /></button>
          </div>

          {settingsSection === 'plan' && (<>
          {cloud.user && cloud.role && !canManageBusiness && (
            <div className="team-permission-banner mt-5">
              <ShieldCheck size={17} />
              <div><strong>{teamRoleCopy[cloud.role].label}</strong><span>{cloud.role === 'operator' ? 'Podés cargar ventas y gastos, y corregir solo lo que cargaste vos. La estrategia y la configuración quedan protegidas.' : 'Tenés acceso de lectura. La configuración y los movimientos están protegidos.'}</span></div>
            </div>
          )}

          <div className={`mt-7 ${!canManageBusiness ? 'settings-readonly-block' : ''}`}>
            <div className="flex items-center gap-2"><span className="field-label">¿Cada cuánto querés medir tu objetivo?</span><HelpTip text="Elegí el período en el que querés medir tu ganancia: semana, quincena o mes. Lebu reparte el esfuerzo únicamente dentro de ese período." /></div>
            <div className="period-selector">
              {(['weekly', 'biweekly', 'monthly'] as PeriodType[]).map((type) => (
                <button
                  type="button"
                  key={type}
                  onClick={() => setSettingsDraft((current) => ({ ...current, periodType: type }))}
                  className={`period-option ${settingsDraft.periodType === type ? 'period-option-active' : ''}`}
                >
                  {periodCopy[type].label}
                </button>
              ))}
            </div>
            {settingsDraft.periodType === 'monthly' && (
              <div className="mt-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-black text-[var(--ink)]">¿Qué día empieza tu mes de trabajo?</div>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Si para vos el mes va del 10 al 9 del mes siguiente, elegí 10. Lebu lo va a mover automáticamente cada mes.</p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={settingsDraft.periodStartDay}
                    onChange={(event) => setSettingsDraft((current) => ({ ...current, periodStartDay: Math.min(Math.max(Number(event.target.value) || 1, 1), 31) }))}
                    className="field-input w-24 text-center font-black"
                    aria-label="Día de inicio del período mensual"
                  />
                </div>
              </div>
            )}
            <div className="period-preview mt-3">
              <CalendarDays size={16} />
              <span>Tu período actual: <strong>{formatPeriodRange(settingsPeriod.start, settingsPeriod.end)}</strong></span>
              <span className="period-dot">·</span>
              <strong>{settingsRemainingOpenDays} días abiertos restantes</strong>
            </div>
          </div>

          <div className={`mt-6 ${!canManageBusiness ? 'settings-readonly-block' : ''}`}>
            <label className="block">
              <div className="flex items-center gap-2"><span className="field-label">{settingsDraft.periodType === 'monthly' && settingsDraft.periodStartDay !== 1 ? 'Quiero ganar en este período' : periodCopy[settingsDraft.periodType].targetLabel}</span><HelpTip text="Es la ganancia que querés que te quede después de contemplar los gastos. No es facturación: Lebu calcula cuánto necesitás vender para llegar a esa ganancia." /></div>
              <MoneyInput value={settingsDraft.profitTarget} onChange={(value) => setSettingsDraft((current) => ({ ...current, profitTarget: value }))} />
              <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Podés probar otro número tranquilo: Lebu no cambia tu objetivo real hasta que toques <strong>Guardar cambios</strong>.</p>
            </label>
          </div>

          <div className={`mt-7 ${!canManageBusiness ? 'settings-readonly-block' : ''}`}>
            <div>
              <div className="field-label">¿Qué días abrís normalmente?</div>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Tocá los días que trabajás. Lebu reparte el objetivo solo entre esos días.</p>
            </div>
            <div className="mt-3 grid grid-cols-7 gap-2">
              {weekdayOptions.map((day) => {
                const active = settingsDraft.openWeekdays.includes(day.value);
                return (
                  <button
                    type="button"
                    key={`strategy-${day.value}`}
                    title={day.label}
                    aria-label={day.label}
                    aria-pressed={active}
                    onClick={() => toggleDraftOpenDay(day.value)}
                    className={`weekday-button ${active ? 'weekday-button-active' : ''}`}
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`mt-6 ${!canManageBusiness ? 'settings-readonly-block' : ''}`}>
            <button
              type="button"
              onClick={() => {
                setShowAdvancedStrategy(true);
                window.setTimeout(() => document.getElementById('plan-recurring-costs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
              }}
              className="w-full rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4 text-left transition hover:border-[var(--brand)]/35"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2"><Repeat2 size={17} className="text-[var(--brand)]" /><strong className="text-sm">Gastos que se repiten</strong></div>
                <ChevronRight size={16} className="text-[var(--muted)]" />
              </div>
              <div className="mt-2 text-lg font-black text-[var(--ink)]">{money.format(settingsRecurringTotal)}</div>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{settingsDraft.recurringCosts.length ? `${settingsDraft.recurringCosts.length} configurado${settingsDraft.recurringCosts.length === 1 ? '' : 's'} · tocar para gestionar` : 'Alquiler, sueldos, impuestos y otros costos que se repiten.'}</p>
            </button>
          </div>

          <button type="button" onClick={() => setShowAdvancedStrategy((value) => !value)} className="secondary-button mt-5 w-full justify-between">
            <span>{showAdvancedStrategy ? 'Ocultar opciones avanzadas' : 'Afinar mi estrategia'}</span>
            <ChevronDown size={16} className={showAdvancedStrategy ? 'rotate-180 transition' : 'transition'} />
          </button>

          {showAdvancedStrategy && (<>

          <div className={`mt-5 rounded-2xl border border-[var(--line)] bg-[var(--card-translucent)] p-4 ${!canManageBusiness ? 'settings-readonly-block' : ''}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black">Categorías de gastos</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Usalas para ordenar tus gastos. Podés cambiar nombres o sacar las que ya no necesitás; tus gastos anteriores no se modifican.</p>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {settingsDraft.categories.map((category, index) => {
                const protectedCategory = category.trim().toLocaleLowerCase('es-AR') === 'otros';
                return (
                  <div key={`category-${index}`} className="flex min-w-0 items-center gap-2">
                    <input
                      value={category}
                      onChange={(event) => setSettingsDraft((draft) => ({ ...draft, categories: draft.categories.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))}
                      className="field-input min-w-0 flex-1"
                      aria-label={`Editar categoría ${category}`}
                    />
                    <button
                      type="button"
                      disabled={protectedCategory}
                      onClick={() => { if (window.confirm(`¿Eliminar la categoría \"${category}\"? Los gastos que ya cargaste no se van a modificar.`)) setSettingsDraft((draft) => ({ ...draft, categories: draft.categories.filter((_, itemIndex) => itemIndex !== index) })); }}
                      className="icon-button shrink-0 disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label={protectedCategory ? 'La categoría Otros no se puede eliminar' : `Eliminar categoría ${category}`}
                      title={protectedCategory ? 'Otros queda como categoría de respaldo' : 'Eliminar categoría'}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setSettingsDraft((draft) => ({ ...draft, categories: [...draft.categories, `Nueva categoría ${draft.categories.length + 1}`] }))}
              className="small-button mt-3"
            >
              <Plus size={15} /> Agregar categoría
            </button>
          </div>

          <div className={`mt-7 border-t border-[var(--line)] pt-6 ${!canManageBusiness ? 'settings-readonly-block' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black">Totales con los que arrancaste</h3>
                <p className="mt-1 text-sm text-[var(--muted)]">Si empezaste sabiendo solo cuánto habías vendido y gastado hasta ese momento, podés revisar esos números acá.</p>
              </div>
              {canManageBusiness && <button type="button" onClick={openHistoricalSummaryEditor} className="small-button">{historicalSummary ? 'Editar' : 'Cargar totales'}</button>}
            </div>
            {historicalSummary ? (
              <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-black text-[var(--ink)]">Acumulado {formatPeriodRange(historicalSummary.startDate, historicalSummary.endDate)}</div>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{historicalSummaryCoversSales(historicalSummary) ? `Ventas ${money.format(parseMoney(historicalSummary.salesTotal))}` : 'Ventas con detalle'} · {historicalSummaryCoversExpenses(historicalSummary) ? `Gastos ${money.format(parseMoney(historicalSummary.expensesTotal))}` : 'Gastos con detalle'}</p>
                  </div>
                  {canManageBusiness && <button type="button" onClick={removeHistoricalSummary} className="text-xs font-black text-[var(--muted)] hover:text-[var(--danger)]">Eliminar</button>}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs leading-5 text-[var(--muted)]">No hay un acumulado inicial cargado. Lebu está trabajando únicamente con movimientos detallados.</p>
            )}
          </div>

          <div className={`mt-7 border-t border-[var(--line)] pt-6 ${!canManageBusiness ? 'settings-readonly-block' : ''}`}>
            <div>
              <h3 className="text-lg font-black">Días especiales</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">Solo si necesitás cambiar un feriado, vacaciones o una apertura excepcional.</p>
            </div>

            <div className="calendar-exception-card mt-4">
              <div>
                <div className="text-sm font-black text-[var(--ink)]">Cambiar solo un día</div>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Feriado, vacaciones o una apertura especial. Lebu redistribuye el objetivo sin tocar tu semana habitual.</p>
              </div>
              <div className="calendar-exception-controls mt-3">
                <input
                  type="date"
                  min={settingsPeriod.start}
                  max={settingsPeriod.end}
                  value={exceptionDate}
                  onChange={(event) => setExceptionDate(event.target.value)}
                  className="field-input min-w-0"
                  aria-label="Fecha excepcional"
                />
                <button type="button" onClick={addDayException} className="small-button justify-center">
                  {selectedExceptionNormalOpen ? 'Cerrar este día' : 'Abrir este día'}
                </button>
              </div>

              {currentPeriodExceptions.length > 0 && (
                <div className="mt-3 space-y-2">
                  {currentPeriodExceptions.map((item) => (
                    <div key={item.date} className="calendar-exception-row">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-black text-[var(--ink)]">{formatLongDate(item.date)}</div>
                        <div className={`mt-0.5 text-xs font-bold ${item.open ? 'text-[var(--brand)]' : 'text-[var(--muted)]'}`}>{item.open ? 'Abierto excepcionalmente' : 'Cerrado excepcionalmente'}</div>
                      </div>
                      <button type="button" onClick={() => removeDayException(item.date)} className="text-xs font-black text-[var(--brand)]">Volver a lo habitual</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="smart-setting-row mt-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><div className="text-sm font-black text-[var(--ink)]">Ajustar el esfuerzo según tus días</div><HelpTip text="Con suficiente historial, Lebu aprende qué días suelen ser más fuertes y reparte más objetivo allí. La meta total no cambia." /></div>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Cuando Lebu tenga suficiente información, puede pedirte un poco más en tus días fuertes y menos en los tranquilos. Tu objetivo total no cambia.</p>
              </div>
              <button type="button" role="switch" aria-checked={settingsDraft.smartDistributionEnabled} onClick={() => setSettingsDraft((current) => ({ ...current, smartDistributionEnabled: !current.smartDistributionEnabled }))} className={`sound-toggle ${settingsDraft.smartDistributionEnabled ? 'sound-toggle-active' : ''}`}>
                <span />
              </button>
            </div>
          </div>

          <div id="plan-cash" className={`cash-setting-card mt-8 scroll-mt-4 ${!canManageBusiness ? 'settings-readonly-block' : ''}`}>
            <div className="cash-setting-copy">
              <div className="cash-setting-icon"><Wallet size={18} /></div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-black text-[var(--ink)]">Caja asistida</h3>
                  <HelpTip text="Confirmás un saldo real y Lebu lo actualiza solo con movimientos cuyo efecto neto conoce. Las ventas comunes no se suman porque las comisiones y acreditaciones pueden variar." />
                  {cashGuidance.hasCashSnapshot && <span className={`cash-confidence cash-confidence-${cashConfidenceCopy[cashGuidance.confidence].tone}`}>{cashConfidenceCopy[cashGuidance.confidence].label}</span>}
                </div>
                <p>Confirmá cuánto dinero tenés realmente disponible. Después Lebu descuenta egresos conocidos y te avisa cuándo conviene volver a conciliar.</p>
                {cashGuidance.hasCashSnapshot && !cashDraftTouched && (
                  <small>Última confirmación: {new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(cashUpdatedAt))}</small>
                )}
                {cashDraftTouched && <small>Al guardar, este número pasa a ser la nueva caja confirmada.</small>}
              </div>
            </div>

            <div className="cash-setting-body">
              {cashGuidance.hasCashSnapshot && (
                <div className="cash-setting-estimate">
                  <span>Lebu estima ahora</span>
                  <strong>{money.format(cashGuidance.estimatedCash)}</strong>
                  <small>
                    {cashGuidance.knownEffectCount > 0
                      ? `${cashGuidance.knownEffectCount} movimiento${cashGuidance.knownEffectCount === 1 ? '' : 's'} con impacto neto conocido desde la última confirmación.`
                      : 'Sin movimientos netos conocidos desde la última confirmación.'}
                  </small>
                </div>
              )}

              <div className="cash-setting-input">
                <span className="recurring-field-label">Caja real ahora</span>
                <MoneyInput
                  value={settingsDraft.availableCash}
                  onChange={(value) => { setSettingsDraft((current) => ({ ...current, availableCash: value })); setCashDraftTouched(true); }}
                />
                {cashDraftTouched && cashGuidance.hasCashSnapshot && (
                  <small className={`cash-reconcile-diff ${cashReconciliationDifference < 0 ? 'cash-reconcile-negative' : cashReconciliationDifference > 0 ? 'cash-reconcile-positive' : ''}`}>
                    {cashReconciliationDifference === 0
                      ? 'Coincide con la estimación de Lebu.'
                      : `${cashReconciliationDifference > 0 ? 'Hay ' : 'Faltan '}${money.format(Math.abs(cashReconciliationDifference))} respecto de la estimación. Lebu registra esa diferencia como ajuste de caja, sin asumir que sea una comisión, y vuelve a empezar desde el saldo real.`}
                  </small>
                )}
                {cashDraftTouched && (
                  <button type="button" onClick={confirmCashDraft} className="small-button cash-confirm-button">Confirmar caja ahora</button>
                )}
              </div>

              {(cashGuidance.untrackedSalesCount > 0 || cashGuidance.untrackedExpenseCount > 0) && (
                <div className="cash-setting-warning">
                  <strong>Lebu está siendo conservador.</strong>
                  <span>
                    {cashGuidance.untrackedSalesCount > 0 ? `${cashGuidance.untrackedSalesCount} venta${cashGuidance.untrackedSalesCount === 1 ? '' : 's'} posterior${cashGuidance.untrackedSalesCount === 1 ? '' : 'es'} no se sumaron porque no conocemos el neto acreditado.` : ''}
                    {cashGuidance.untrackedExpenseCount > 0 ? ` ${cashGuidance.untrackedExpenseCount} gasto${cashGuidance.untrackedExpenseCount === 1 ? '' : 's'} tampoco tienen impacto de caja confirmado.` : ''}
                  </span>
                </div>
              )}

              {cashAdjustments.length > 0 && (() => {
                const lastAdjustment = cashAdjustments[cashAdjustments.length - 1];
                const amount = Number(lastAdjustment.amount) || 0;
                return (
                  <div className="cash-setting-warning">
                    <strong>Último ajuste de conciliación</strong>
                    <span>{amount > 0 ? '+' : amount < 0 ? '-' : ''}{money.format(Math.abs(amount))} · {new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(lastAdjustment.adjustedAt))}. Se guarda como diferencia de caja, no como venta, gasto ni comisión.</span>
                  </div>
                );
              })()}
            </div>
          </div>

          <div id="plan-recurring-costs" className={`mt-8 scroll-mt-4 border-t border-[var(--line)] pt-7 ${!canManageBusiness ? 'settings-readonly-block' : ''}`}>
            <div className="recurring-section-header">
              <div className="recurring-section-copy">
                <div className="flex items-center gap-2">
                  <Repeat2 size={18} className="text-[var(--brand)]" />
                  <h3 className="text-lg font-black">Gastos que se repiten</h3>
                </div>
                <p className="recurring-section-description">Alquiler, sueldos, servicios e impuestos. Cargalos una vez; los cambios se aplican al guardar.</p>
                {result.historicalSummaryActive && historicalSummary?.expensesIncludeRecurring && (
                  <p className="recurring-section-note"><strong>Importante:</strong> si ya estaba dentro de tus gastos acumulados, marcalo abajo. Lebu no duplica lo ya incluido; si vuelve a ocurrir después de la fecha del acumulado, esa parte futura sí cuenta.</p>
                )}
                {!result.historicalSummaryActive && expenses.some((expense) => isWithinPeriod(expense.date, settingsPeriod.start, settingsPeriod.end)) && (
                  <p className="recurring-section-note"><strong>Gastos ya cargados:</strong> Lebu concilia automáticamente una ocurrencia cuando encuentra una coincidencia inequívoca por nombre, importe y fecha. Si hay duda, no la vincula en silencio y podés hacerlo desde Movimientos.</p>
                )}
                {result.recurringReconciliationGroups.length > 0 && (
                  <p className="recurring-section-note"><strong>{result.recurringReconciliationGroups.length} ocurrencia{result.recurringReconciliationGroups.length === 1 ? '' : 's'} conciliada{result.recurringReconciliationGroups.length === 1 ? '' : 's'}:</strong> los pagos reales se acumulan contra cada obligación. Un pago parcial no reduce el gasto previsto; Lebu mantiene el saldo pendiente hasta cubrirlo.</p>
                )}
              </div>
              <div className="soft-pill recurring-total-pill"><span>Configurado</span><strong>{money.format(settingsRecurringTotal)}</strong></div>
            </div>

            <div className="mt-5 space-y-3">
              {settingsDraft.recurringCosts.map((item) => {
                const paymentProgress = recurringPaymentProgressById.get(Number(item.id));
                return (
                <div key={item.id} className="recurring-row">
                  <div className="recurring-main">
                    <input
                      value={item.name}
                      onChange={(event) => setSettingsDraft((draft) => ({ ...draft, recurringCosts: draft.recurringCosts.map((current) => current.id === item.id ? { ...current, name: event.target.value } : current) }))}
                      className="field-input"
                    />
                    <div className="recurring-helper">≈ {money.format(recurringDailyLabel(item))} por día calendario</div>
                  </div>
                  <div className="recurring-amount-field">
                    <span className="recurring-field-label">Monto</span>
                    <MoneyInput
                      value={item.amount}
                      onChange={(value) => setSettingsDraft((draft) => ({ ...draft, recurringCosts: draft.recurringCosts.map((current) => current.id === item.id ? { ...current, amount: value } : current) }))}
                      compact
                    />
                  </div>
                  <label className="recurring-covered-toggle">
                    <input type="checkbox" checked={Boolean(item.amountApproximate)} onChange={(event) => setSettingsDraft((draft) => ({ ...draft, recurringCosts: draft.recurringCosts.map((current) => current.id === item.id ? { ...current, amountApproximate: event.target.checked } : current) }))} className="recurring-covered-checkbox accent-[var(--brand)]" />
                    <span className="recurring-covered-copy"><strong>Monto aproximado</strong><small>Lebu lo usa para proyectar. Los pagos vinculados se acumulan y, mientras quede saldo, mantiene la previsión pendiente.</small></span>
                  </label>
                  <div className="recurring-frequency-field">
                    <span className="recurring-field-label">Frecuencia</span>
                    <select
                      value={item.frequency}
                      onChange={(event) => setSettingsDraft((draft) => ({ ...draft, recurringCosts: draft.recurringCosts.map((current) => current.id === item.id ? { ...current, frequency: event.target.value as RecurringFrequency, paymentSchedule: null } : current) }))}
                      className="field-input recurring-select"
                      aria-label={`Frecuencia de ${item.name}`}
                    >
                      {(Object.keys(recurringFrequencyCopy) as RecurringFrequency[]).map((frequency) => (
                        <option key={frequency} value={frequency}>{recurringFrequencyCopy[frequency].label}</option>
                      ))}
                    </select>
                  </div>
                  <button type="button" onClick={() => { setSettingsDraft((draft) => ({ ...draft, recurringCosts: draft.recurringCosts.filter((current) => current.id !== item.id) })); setSettingsCoveredRecurringIds((ids) => ids.filter((id) => id !== item.id)); }} className="icon-button recurring-delete-button" aria-label={`Eliminar ${item.name}`}>
                    <Trash2 size={17} />
                  </button>
                  <div className="recurring-payment-row">
                    <div className="recurring-payment-heading">
                      <CalendarClock size={15} />
                      <div>
                        <strong>Cuándo lo pagás</strong>
                        <small>{recurringPaymentLabel(item)} · sirve para anticipar caja, no cambia el costo total.</small>
                      </div>
                    </div>
                    <PaymentScheduleEditor
                      frequency={item.frequency}
                      schedule={item.paymentSchedule}
                      onChange={(paymentSchedule) => setSettingsDraft((draft) => ({ ...draft, recurringCosts: draft.recurringCosts.map((current) => current.id === item.id ? { ...current, paymentSchedule } : current) }))}
                    />
                  </div>
                  {paymentProgress && paymentProgress.expected > 0 && (
                    <div className={`recurring-progress-row recurring-progress-${paymentProgress.status}`}>
                      <div className="recurring-progress-heading">
                        <div className="recurring-progress-title">
                          <strong>{paymentProgress.priorBalance ? 'Saldo pendiente anterior' : recurringOccurrenceLabel(item, paymentProgress.occurrenceDate)}</strong>
                          <span className={`recurring-progress-badge recurring-progress-badge-${paymentProgress.status}`}>{recurringPaymentStatusLabel(paymentProgress.status, Boolean(item.amountApproximate))}</span>
                        </div>
                        <small>
                          {paymentProgress.priorBalance ? `${recurringOccurrenceLabel(item, paymentProgress.occurrenceDate)} · ` : ''}
                          {paymentProgress.expenseCount > 0 ? `${paymentProgress.expenseCount} pago${paymentProgress.expenseCount === 1 ? '' : 's'} asociado${paymentProgress.expenseCount === 1 ? '' : 's'}.` : 'Todavía no hay pagos asociados.'}
                        </small>
                      </div>
                      <div className="recurring-progress-metrics">
                        <div><span>{item.amountApproximate ? 'Previsto aprox.' : 'Previsto'}</span><strong>{money.format(paymentProgress.expected)}</strong></div>
                        <div><span>Pagado</span><strong>{money.format(paymentProgress.paid)}</strong></div>
                        <div><span>Pendiente</span><strong className={paymentProgress.pending > 0 ? 'recurring-progress-pending-value' : ''}>{money.format(paymentProgress.pending)}</strong></div>
                      </div>
                      {paymentProgress.overpaid > 0 && (
                        <div className="recurring-progress-overage">El total real supera lo previsto en <strong>{money.format(paymentProgress.overpaid)}</strong>. Lebu usa el real para esta ocurrencia.</div>
                      )}
                    </div>
                  )}
                  {(recurringDraftHasEconomicChange(item) || recurringHistoryCount(item) > 0) && (
                    <div className={`recurring-history-row ${recurringDraftHasEconomicChange(item) ? 'recurring-history-row-active' : ''}`}>
                      {recurringDraftHasEconomicChange(item) ? (
                        <>
                          <div className="recurring-history-copy">
                            <strong>Cambio detectado</strong>
                            <small>El valor anterior se conserva para los análisis previos. Elegí desde cuándo aplica el nuevo.</small>
                          </div>
                          <div className="recurring-history-controls">
                            {recurringChangeEffective[item.id] === 'all' ? (
                              <button type="button" className="small-button recurring-history-mode" onClick={() => setRecurringChangeEffective((current) => ({ ...current, [item.id]: todayISO() }))}>Aplicar desde hoy</button>
                            ) : (
                              <label className="recurring-history-date">
                                <span>Aplicar desde</span>
                                <input
                                  type="date"
                                  value={recurringChangeEffective[item.id] || todayISO()}
                                  onChange={(event) => setRecurringChangeEffective((current) => ({ ...current, [item.id]: event.target.value || todayISO() }))}
                                  className="field-input"
                                />
                              </label>
                            )}
                            <button
                              type="button"
                              className={`recurring-history-all ${recurringChangeEffective[item.id] === 'all' ? 'recurring-history-all-active' : ''}`}
                              onClick={() => setRecurringChangeEffective((current) => ({ ...current, [item.id]: 'all' }))}
                            >
                              Corregir todo el historial
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="recurring-history-copy recurring-history-saved">
                          <strong>Historial preservado</strong>
                          <small>{recurringHistoryCount(item)} cambio{recurringHistoryCount(item) === 1 ? '' : 's'} de valor con fecha de vigencia. Mirada usa el monto que correspondía en cada momento.</small>
                        </div>
                      )}
                    </div>
                  )}
                  {result.historicalSummaryActive && historicalSummary?.expensesIncludeRecurring && (
                    <label className="recurring-covered-toggle">
                      <input type="checkbox" checked={settingsCoveredRecurringIds.includes(item.id)} onChange={(event) => setSettingsCoveredRecurringIds((ids) => event.target.checked ? Array.from(new Set([...ids, item.id])) : ids.filter((id) => id !== item.id))} className="recurring-covered-checkbox accent-[var(--brand)]" />
                      <span className="recurring-covered-copy"><strong>Ya estaba incluido en mis gastos acumulados</strong><small>No duplica lo ya cargado. Lo que vuelva a ocurrir después del acumulado sí cuenta.</small></span>
                    </label>
                  )}
                </div>
                );
              })}
            </div>

            <div className="new-recurring-card mt-4">
              <div className="text-sm font-extrabold text-[var(--ink)]">Agregar gasto que se repite</div>
              <div className="new-recurring-grid mt-3">
                <label className="new-recurring-name-field">
                  <span className="recurring-field-label">Nombre</span>
                  <input
                    value={newRecurring.name}
                    onChange={(event) => setNewRecurring((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Ej.: Contador"
                    className="field-input"
                  />
                </label>
                <label className="new-recurring-amount-field">
                  <span className="recurring-field-label">Monto</span>
                  <MoneyInput value={newRecurring.amount} onChange={(value) => setNewRecurring((current) => ({ ...current, amount: value }))} compact />
                </label>
                <label className="recurring-covered-toggle">
                  <input type="checkbox" checked={newRecurring.amountApproximate} onChange={(event) => setNewRecurring((current) => ({ ...current, amountApproximate: event.target.checked }))} className="recurring-covered-checkbox accent-[var(--brand)]" />
                  <span className="recurring-covered-copy"><strong>Es un monto aproximado</strong><small>Útil para servicios, impuestos u otros gastos que existen pero varían. El gasto real reemplaza esta estimación al conciliarse.</small></span>
                </label>
                <label className="new-recurring-frequency-field">
                  <span className="recurring-field-label">Frecuencia</span>
                  <select
                    value={newRecurring.frequency}
                    onChange={(event) => setNewRecurring((current) => ({ ...current, frequency: event.target.value as RecurringFrequency, paymentSchedule: null }))}
                    className="field-input recurring-select"
                  >
                    {(Object.keys(recurringFrequencyCopy) as RecurringFrequency[]).map((frequency) => (
                      <option key={frequency} value={frequency}>{recurringFrequencyCopy[frequency].label}</option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={addRecurringCost} className="small-button new-recurring-add">Agregar</button>
              </div>
              <div className="new-recurring-payment mt-3">
                <div className="recurring-payment-heading">
                  <CalendarClock size={15} />
                  <div><strong>Fecha de pago</strong><small>Opcional. Lebu la usa para avisarte cuándo necesitás tener el dinero.</small></div>
                </div>
                <PaymentScheduleEditor
                  frequency={newRecurring.frequency}
                  schedule={newRecurring.paymentSchedule}
                  onChange={(paymentSchedule) => setNewRecurring((current) => ({ ...current, paymentSchedule }))}
                />
              </div>
              {result.historicalSummaryActive && historicalSummary?.expensesIncludeRecurring && (
                <label className="recurring-covered-toggle recurring-covered-toggle-new">
                  <input type="checkbox" checked={newRecurring.includedInHistoricalSummary} onChange={(event) => setNewRecurring((current) => ({ ...current, includedInHistoricalSummary: event.target.checked }))} className="recurring-covered-checkbox accent-[var(--brand)]" />
                  <span className="recurring-covered-copy"><strong>Ya estaba incluido en mis gastos acumulados</strong><small>No lo suma otra vez en este período.</small></span>
                </label>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--brand-soft)]/55 p-4">
              <div className="text-xs font-extrabold text-[var(--brand)]">¿POR QUÉ PRORRATEAMOS?</div>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">Porque el alquiler, los sueldos y otros compromisos existen aunque todavía no haya llegado el día del pago. Así una semana "tranquila" no te hace creer que venís mejor de lo que realmente venís.</p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl bg-[var(--surface-soft)] p-4 text-xs leading-5 text-[var(--muted)]">
            Las ventas y los gastos puntuales entran según su fecha. Los gastos que se repiten se distribuyen a lo largo del período para que Lebu no pierda de vista costos como alquiler o sueldos.
          </div>

          </>)}

          </>)}

          {settingsSection === 'preferences' && (<>
          <div className="mt-8 border-t border-[var(--line)] pt-6">
            <div className="flex items-start gap-3">
              <div className="sound-setting-icon">{themePreference === 'dark' ? <Moon size={19} /> : themePreference === 'light' ? <Sun size={19} /> : <Monitor size={19} />}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black text-[var(--ink)]">Apariencia</div>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Elegí cómo querés ver Lebu. Automático sigue el modo claro u oscuro de este dispositivo.</p>
                <div className="appearance-selector mt-4" role="group" aria-label="Apariencia de Lebu">
                  {([
                    { value: 'system' as ThemePreference, label: 'Automático', icon: Monitor },
                    { value: 'light' as ThemePreference, label: 'Claro', icon: Sun },
                    { value: 'dark' as ThemePreference, label: 'Oscuro', icon: Moon },
                  ]).map(({ value, label, icon: Icon }) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => chooseTheme(value)}
                      className={`appearance-option ${themePreference === value ? 'appearance-option-active' : ''}`}
                      aria-pressed={themePreference === value}
                    >
                      <Icon size={16} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 border-t border-[var(--line)] pt-6">
            <div className="sound-setting-row">
              <div className="flex items-start gap-3">
                <div className="sound-setting-icon">{pushStatus === 'enabled' ? <BellRing size={19} /> : <Bell size={19} />}</div>
                <div>
                  <div className="text-sm font-black text-[var(--ink)]">Notificaciones de Lebu</div>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Lebu puede avisarte al arrancar, resumir cómo cerraste y detectar cuando un movimiento cambia de verdad el panorama.</p>
                  {pushStatus === 'unsupported' && <p className="mt-2 text-xs font-bold text-[var(--danger)]">En iPhone funciona desde la app instalada en la pantalla de inicio.</p>}
                  {pushStatus === 'denied' && <p className="mt-2 text-xs font-bold text-[var(--danger)]">Las notificaciones están bloqueadas. Podés habilitarlas desde Ajustes de iOS → Notificaciones → Lebu.</p>}
                  {pushMessage && <p className="mt-2 text-xs font-semibold text-[var(--brand)]">{pushMessage}</p>}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                {pushStatus !== 'enabled' ? (
                  <button type="button" onClick={() => void activateNotifications()} disabled={pushBusy || pushStatus === 'unsupported' || pushStatus === 'denied'} className="small-button disabled:opacity-45">
                    {pushBusy ? 'Activando…' : 'Activar'}
                  </button>
                ) : (
                  <button type="button" onClick={() => void testNotification()} disabled={pushBusy} className="small-button disabled:opacity-45">
                    {pushBusy ? 'Enviando…' : 'Probar'}
                  </button>
                )}
              </div>
            </div>

            {pushStatus === 'enabled' && (
              <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card-translucent)]">
                <div className="notification-pref-row notification-time-row">
                  <div>
                    <div className="text-xs font-black text-[var(--ink)]">Arranque del día</div>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Elegí cuándo empieza tu día. Lebu usa tu zona horaria y compara el ritmo con el aviso anterior.</p>
                  </div>
                  <div className="notification-time-controls">
                    <input
                      type="time"
                      aria-label="Horario del aviso diario"
                      value={pushPreferences.morningTime}
                      disabled={!pushPreferences.morningEnabled}
                      onChange={(event) => void updateMorningTime(event.target.value)}
                      className="notification-time-input"
                    />
                    <button type="button" role="switch" aria-checked={pushPreferences.morningEnabled} onClick={() => void togglePushPreference('morningEnabled')} className={`sound-toggle ${pushPreferences.morningEnabled ? 'sound-toggle-active' : ''}`}>
                      <span />
                    </button>
                  </div>
                </div>
                <div className="notification-pref-row notification-time-row border-t border-[var(--line)]">
                  <div>
                    <div className="text-xs font-black text-[var(--ink)]">Cierre del día</div>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Resumen opcional de ventas, objetivo de hoy y ritmo para el próximo día abierto. Si no cargaste ventas, Lebu no interrumpe.</p>
                  </div>
                  <div className="notification-time-controls">
                    <input
                      type="time"
                      aria-label="Horario del resumen de cierre"
                      value={pushPreferences.closingTime}
                      disabled={!pushPreferences.closingEnabled}
                      onChange={(event) => void updateClosingTime(event.target.value)}
                      className="notification-time-input"
                    />
                    <button type="button" role="switch" aria-checked={pushPreferences.closingEnabled} onClick={() => void togglePushPreference('closingEnabled')} className={`sound-toggle ${pushPreferences.closingEnabled ? 'sound-toggle-active' : ''}`}>
                      <span />
                    </button>
                  </div>
                </div>
                <div className="notification-pref-row border-t border-[var(--line)]">
                  <div>
                    <div className="text-xs font-black text-[var(--ink)]">Cambios importantes</div>
                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Un gasto que suba fuerte el objetivo o alcanzar la meta puede disparar un aviso. Hay un límite para evitar spam.</p>
                  </div>
                  <button type="button" role="switch" aria-checked={pushPreferences.smartChangesEnabled} onClick={() => void togglePushPreference('smartChangesEnabled')} className={`sound-toggle ${pushPreferences.smartChangesEnabled ? 'sound-toggle-active' : ''}`}>
                    <span />
                  </button>
                </div>
              </div>
            )}

            <div className="mt-3 rounded-2xl bg-[var(--brand-soft)]/60 p-3 text-xs leading-5 text-[var(--ink-soft)]">
              <strong>Inteligentes, no ruidosas:</strong> las ventas normales no generan un push cada vez. Lebu las usa para recalcular; reserva los avisos inmediatos para cambios grandes. Los avisos programados pueden llegar hasta unos minutos después del horario elegido.
            </div>
          </div>

          <div className="mt-8 border-t border-[var(--line)] pt-6">
            <div className="sound-setting-row">
              <div className="flex items-start gap-3">
                <div className="sound-setting-icon">{soundsEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}</div>
                <div>
                  <div className="text-sm font-black text-[var(--ink)]">Sonidos de Lebu</div>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Una firma corta de Lebu cuando alcanzás un hito importante.</p>
                  <button type="button" onClick={previewLebuSound} className="sound-preview-button mt-3">Probar sonido</button>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={soundsEnabled}
                aria-label="Activar o desactivar sonidos de Lebu"
                onClick={() => { if (canManageBusiness) setSoundsEnabled((value) => !value); }}
                disabled={!canManageBusiness}
                className={`sound-toggle ${soundsEnabled ? 'sound-toggle-active' : ''}`}
              >
                <span />
              </button>
            </div>
          </div>

          </>)}

          {settingsSection === 'account' && (<>
          <div className="mt-8 border-t border-[var(--line)] pt-6">
            <div className="flex items-start gap-3">
              <div className="sound-setting-icon">{cloud.user ? <Cloud size={19} /> : <CloudOff size={19} />}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black text-[var(--ink)]">Cuenta y nube</div>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Con una cuenta, Lebu sincroniza cada movimiento por separado entre tus dispositivos. Offline sigue funcionando igual y los cambios pendientes se suben al volver la conexión.</p>
              </div>
            </div>

            {cloud.user ? (
              <div className="cloud-account-card mt-4">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-[var(--ink)]">{cloud.user.email}</div>
                    <div className={`cloud-status-text cloud-status-${cloud.status}`}>
                      {cloud.status === 'synced' && <CheckCircle2 size={13} />}
                      {cloud.status === 'offline' ? <CloudOff size={13} /> : cloud.status !== 'synced' ? <RefreshCw size={13} className={cloud.status === 'connecting' ? 'animate-spin' : ''} /> : null}
                      <span>{cloudStatusLabel}</span>
                    </div>
                  </div>
                  <button type="button" onClick={() => void cloud.syncNow()} disabled={!isOnline || cloud.status === 'connecting'} className="small-button shrink-0 disabled:opacity-45">
                    <RefreshCw size={15} className={cloud.status === 'connecting' ? 'animate-spin' : ''} /> Sincronizar
                  </button>
                </div>
                <div className="mt-3 rounded-xl bg-[var(--brand-soft)]/60 p-3 text-xs leading-5 text-[var(--ink-soft)]">
                  {cloud.status === 'offline'
                    ? 'Podés seguir cargando ventas y gastos. Lebu los sube cuando vuelva la conexión.'
                    : 'Cloud v2 activo: ventas, gastos, recurrentes y calendario se sincronizan por registro. Un cambio en un movimiento ya no obliga a reemplazar el estado completo del negocio.'}
                </div>
                {cloud.message && <p className="mt-3 text-xs font-bold text-[var(--danger)]">{cloud.message}</p>}
                <div className="mt-3 text-[10px] font-bold text-[var(--muted)]">Lebu {APP_VERSION}</div>
                <button type="button" onClick={() => void cloud.signOut()} className="mt-2 inline-flex items-center gap-1.5 text-xs font-black text-[var(--muted)] hover:text-[var(--danger)]"><LogOut size={14} /> Cerrar sesión</button>
              </div>
            ) : (
              <div className="cloud-account-card mt-4">
                <div className="grid gap-2">
                  <input type="email" autoComplete="email" value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} placeholder="tu@email.com" className="field-input" />
                  <input type="password" autoComplete={result.hasTarget ? 'new-password' : 'current-password'} value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} placeholder="Contraseña (mínimo 6 caracteres)" className="field-input" />
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {result.hasTarget ? (<>
                    <button type="button" onClick={() => void handleCloudAuth('signup')} disabled={accountBusy || !accountEmail.trim() || accountPassword.length < 6 || !isOnline} className="primary-button justify-center disabled:opacity-45">{accountBusy ? 'Guardando…' : 'Crear cuenta y guardar'}</button>
                    <button type="button" onClick={() => void handleCloudAuth('signin')} disabled={accountBusy || !accountEmail.trim() || accountPassword.length < 6 || !isOnline} className="secondary-button justify-center disabled:opacity-45">Ya tengo cuenta</button>
                  </>) : (<>
                    <button type="button" onClick={() => void handleCloudAuth('signin')} disabled={accountBusy || !accountEmail.trim() || accountPassword.length < 6 || !isOnline} className="primary-button justify-center disabled:opacity-45">{accountBusy ? 'Conectando…' : 'Ingresar'}</button>
                    <button type="button" onClick={() => void handleCloudAuth('signup')} disabled={accountBusy || !accountEmail.trim() || accountPassword.length < 6 || !isOnline} className="secondary-button justify-center disabled:opacity-45">Crear cuenta</button>
                  </>)}
                </div>
                {cloud.message && <p className={`mt-3 text-xs font-bold ${cloud.status === 'error' ? 'text-[var(--danger)]' : 'text-[var(--brand)]'}`}>{cloud.message}</p>}
                <p className="mt-3 text-[10px] leading-4 text-[var(--muted)]">La primera vez, si ya tenés datos locales, Lebu los sube a tu cuenta. En un dispositivo nuevo, descarga automáticamente lo que ya tenías guardado.</p>
              </div>
            )}
          </div>

          {cloud.user && cloud.businessId && (
            <div className="mt-8 border-t border-[var(--line)] pt-6">
              <div className="flex items-start gap-3">
                <div className="sound-setting-icon">{fudoStatus.connected ? <CheckCircle2 size={19} /> : <RefreshCw size={19} />}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black text-[var(--ink)]">FUDO</div>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">FUDO puede ser la fuente operativa de ventas de Lebu. Las credenciales se cifran del lado servidor y nunca se guardan en este navegador.</p>
                </div>
              </div>

              {fudoStatus.connected ? (
                <div className="cloud-account-card mt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-black text-[var(--ink)]"><CheckCircle2 size={16} /> FUDO conectado</div>
                      <div className="mt-1 text-xs text-[var(--muted)]">{fudoStatus.lastSyncAt ? `Última sincronización: ${new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(fudoStatus.lastSyncAt))}` : 'Todavía no se completó la primera sincronización.'}</div>
                    </div>
                    <button type="button" onClick={() => void handleFudoSync()} disabled={fudoBusy || !isOnline} className="small-button shrink-0 disabled:opacity-45"><RefreshCw size={15} className={fudoBusy ? 'animate-spin' : ''} /> Actualizar</button>
                  </div>
                  <div className="mt-3 rounded-xl bg-[var(--brand-soft)]/60 p-3 text-xs leading-5 text-[var(--ink-soft)]">
                    Las ventas FUDO conservan su ID externo para evitar duplicados. Cuando el medio de pago es efectivo, Lebu registra ese importe como impacto de caja conocido sin estimar comisiones.
                  </div>
                  {fudoLastResult && <p className="mt-3 text-xs font-bold text-[var(--brand)]">{number.format(fudoLastResult.imported)} ventas revisadas · efectivo conocido {money.format(fudoLastResult.cashKnown)}</p>}
                  {fudoMessage && <p className={`mt-3 text-xs font-bold ${fudoStatus.status === 'error' ? 'text-[var(--danger)]' : 'text-[var(--brand)]'}`}>{fudoMessage}</p>}
                  {canManageBusiness && <button type="button" onClick={() => void handleDisconnectFudo()} disabled={fudoBusy} className="mt-3 text-xs font-black text-[var(--muted)] hover:text-[var(--danger)] disabled:opacity-45">Desconectar FUDO</button>}
                </div>
              ) : canManageBusiness ? (
                <div className="cloud-account-card mt-4">
                  <div className="grid gap-2">
                    <input type="password" autoComplete="off" value={fudoApiKey} onChange={(event) => setFudoApiKey(event.target.value)} placeholder="API Key de FUDO" className="field-input" />
                    <input type="password" autoComplete="off" value={fudoApiSecret} onChange={(event) => setFudoApiSecret(event.target.value)} placeholder="API Secret de FUDO" className="field-input" />
                  </div>
                  <button type="button" onClick={() => void handleConnectFudo()} disabled={fudoBusy || !isOnline || !fudoApiKey.trim() || !fudoApiSecret.trim()} className="primary-button mt-3 justify-center disabled:opacity-45">{fudoBusy ? <><RefreshCw size={15} className="animate-spin" /> Conectando…</> : 'Conectar y traer 90 días'}</button>
                  <p className="mt-3 text-[10px] leading-4 text-[var(--muted)]">Necesitás FUDO Plan Pro con la API pública habilitada. Recomendamos un usuario API con solo los permisos que Lebu necesita; Lebu prueba las credenciales antes de guardarlas.</p>
                  {fudoMessage && <p className="mt-3 text-xs font-bold text-[var(--danger)]">{fudoMessage}</p>}
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-[var(--line)] p-4 text-xs leading-5 text-[var(--muted)]">Solo Dueño o Administrador puede conectar FUDO. Una vez conectado, el resto del equipo ve las ventas sincronizadas normalmente.</div>
              )}
            </div>
          )}

          {cloud.user && cloud.businessId && (
            <div className="mt-8 border-t border-[var(--line)] pt-6">
              <div className="flex items-start gap-3">
                <div className="sound-setting-icon"><Users size={19} /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black text-[var(--ink)]">Equipo</div>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Compartí el comercio sin compartir contraseñas. Cada persona entra con su propia cuenta y Lebu registra quién modificó cada movimiento.</p>
                </div>
              </div>

              {cloud.businesses.length > 1 && (
                <label className="mt-4 block">
                  <span className="field-label">Comercio activo</span>
                  <div className="relative">
                    <Building2 size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                    <select value={cloud.businessId} onChange={(event) => void handleSwitchBusiness(event.target.value)} disabled={teamBusy || !isOnline} className="field-input pl-10">
                      {cloud.businesses.map((business) => <option key={business.businessId} value={business.businessId}>{business.name} · {teamRoleCopy[business.role].label}</option>)}
                    </select>
                  </div>
                </label>
              )}

              <div className="team-current-role mt-4">
                <ShieldCheck size={17} />
                <div><strong>{cloud.role ? teamRoleCopy[cloud.role].label : 'Cargando rol…'}</strong><span>{cloud.role ? teamRoleCopy[cloud.role].description : 'Verificando permisos del comercio.'}</span></div>
              </div>

              {canManageBusiness && (
                <div className="team-invite-card mt-4">
                  <div className="text-sm font-black">Nombre del comercio</div>
                  <div className="mt-2 flex gap-2">
                    <input value={businessNameDraft} onChange={(event) => setBusinessNameDraft(event.target.value)} maxLength={60} className="field-input flex-1" placeholder="Ej.: Gurí" />
                    <button type="button" onClick={() => void handleRenameBusiness()} disabled={teamBusy || !isOnline || businessNameDraft.trim().length < 2 || businessNameDraft.trim() === cloud.activeBusiness?.name} className="small-button disabled:opacity-45">Guardar</button>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">Este nombre aparece en el selector cuando tu cuenta participa en más de un comercio.</p>
                </div>
              )}

              {canManageTeam && (
                <div className="team-invite-card mt-4">
                  <div className="flex items-center gap-2 text-sm font-black"><UserPlus size={17} /> Invitar a alguien</div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_170px_auto]">
                    <input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="socio@negocio.com" className="field-input" />
                    <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as InvitabledTeamRole)} className="field-input">
                      {cloud.role === 'owner' && <option value="admin">Administrador</option>}
                      <option value="operator">Carga</option>
                      <option value="viewer">Solo lectura</option>
                    </select>
                    <button type="button" onClick={() => void handleInviteMember()} disabled={teamBusy || !inviteEmail.trim() || !isOnline} className="small-button justify-center disabled:opacity-45">{teamBusy ? 'Enviando…' : 'Invitar'}</button>
                  </div>
                  <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">Carga registra ventas y gastos, pero solo puede corregir lo que cargó. Solo lectura no puede modificar datos. Si el mail ya tiene cuenta Lebu, recibe un acceso para aceptar.</p>
                </div>
              )}

              <div className="mt-4 space-y-2">
                {teamOverview.members.map((member) => {
                  const isMe = member.userId === cloud.user?.id;
                  const canEditMember = !isMe && member.role !== 'owner' && (cloud.role === 'owner' || (cloud.role === 'admin' && member.role !== 'admin'));
                  return (
                    <div key={member.userId} className="team-member-row">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-black text-[var(--ink)]">{member.email}{isMe ? ' · vos' : ''}</div>
                        <div className="mt-0.5 text-[10px] font-bold text-[var(--muted)]">{teamRoleCopy[member.role].label}</div>
                      </div>
                      {canEditMember ? (
                        <>
                          <select value={member.role} disabled={teamBusy} onChange={(event) => void handleMemberRole(member.userId, event.target.value as InvitabledTeamRole)} className="team-role-select">
                            {cloud.role === 'owner' && <option value="admin">Administrador</option>}
                            <option value="operator">Carga</option>
                            <option value="viewer">Solo lectura</option>
                          </select>
                          <button type="button" onClick={() => void handleRemoveMember(member.userId)} disabled={teamBusy} className="icon-button shrink-0" aria-label={`Quitar a ${member.email}`}><Trash2 size={15} /></button>
                        </>
                      ) : <span className="soft-pill">{teamRoleCopy[member.role].label}</span>}
                    </div>
                  );
                })}
              </div>

              {canManageTeam && teamOverview.invitations.length > 0 && (
                <div className="mt-4">
                  <div className="field-label">Invitaciones pendientes</div>
                  <div className="mt-2 space-y-2">
                    {teamOverview.invitations.map((invitation) => (
                      <div key={invitation.id} className="team-member-row">
                        <div className="min-w-0 flex-1"><div className="truncate text-xs font-black">{invitation.email}</div><div className="mt-0.5 text-[10px] font-bold text-[var(--muted)]">{teamRoleCopy[invitation.role].label} · pendiente</div></div>
                        <button type="button" onClick={() => void handleCancelInvitation(invitation.id)} disabled={teamBusy} className="text-xs font-black text-[var(--muted)] hover:text-[var(--danger)]">Cancelar</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {invitePasswordMode && (
                <div className="team-password-card mt-4">
                  <div className="flex items-center gap-2 text-sm font-black"><KeyRound size={17} /> Completá tu acceso</div>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Llegaste desde una invitación. Elegí una contraseña para poder volver a entrar normalmente después.</p>
                  <div className="mt-3 flex gap-2">
                    <input type="password" value={invitePassword} onChange={(event) => setInvitePassword(event.target.value)} placeholder="Mínimo 8 caracteres" className="field-input flex-1" />
                    <button type="button" onClick={() => void handleInvitePassword()} disabled={teamBusy || invitePassword.length < 8} className="small-button disabled:opacity-45">Guardar</button>
                  </div>
                </div>
              )}

              {teamMessage && <p className="mt-3 text-xs font-bold text-[var(--brand)]">{teamMessage}</p>}
            </div>
          )}

          </>)}

          {settingsSection === 'preferences' && (<>
          <div className="mt-8 border-t border-[var(--line)] pt-6">
            <div className="text-sm font-black text-[var(--ink)]">Tus datos en este dispositivo</div>
            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Lebu guarda tus datos en una base local más robusta y funciona sin conexión. El respaldo te permite además guardarlos afuera del iPhone o pasarlos a otro dispositivo.</p>
            <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); }} />
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={exportBackup} className="secondary-button justify-center"><Download size={17} /> Exportar respaldo</button>
              <button type="button" onClick={() => importInputRef.current?.click()} disabled={!canManageBusiness} className="secondary-button justify-center disabled:opacity-45"><Upload size={17} /> Importar respaldo</button>
            </div>
          </div>

          </>)}

          <div className="mt-8 flex flex-col-reverse gap-3 border-t border-[var(--line)] pt-6 sm:flex-row sm:items-center sm:justify-between">
            {settingsSection === 'preferences' && canManageBusiness ? <button type="button" onClick={clearAllData} className="text-sm font-bold text-[var(--muted)] hover:text-[var(--danger)]">Borrar datos de Lebu</button> : <span />}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => setSettingsOpen(false)} className="secondary-button justify-center">{settingsSection === 'plan' && canManageBusiness ? 'Cancelar' : 'Cerrar'}</button>
              {settingsSection === 'plan' && canManageBusiness && <button type="button" onClick={saveSettings} disabled={parseMoney(settingsDraft.profitTarget) <= 0} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-45">Guardar plan</button>}
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

function HelpTip({ text }: { text: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const openHelp = () => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
  };

  const closeHelp = () => dialogRef.current?.close();

  return (
    <>
      <button type="button" className="help-tip-button" aria-label="Más información" onClick={openHelp}>
        <HelpCircle size={14} />
      </button>
      <dialog
        ref={dialogRef}
        className="help-tip-dialog"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeHelp();
        }}
        onCancel={closeHelp}
      >
        <div className="help-tip-sheet">
          <div className="help-tip-sheet-header">
            <div className="help-tip-sheet-title"><HelpCircle size={17} /> Para entenderlo mejor</div>
            <button type="button" className="help-tip-close" aria-label="Cerrar ayuda" onClick={closeHelp}><X size={18} /></button>
          </div>
          <p>{text}</p>
          <button type="button" className="secondary-button help-tip-ok" onClick={closeHelp}>Entendido</button>
        </div>
      </dialog>
    </>
  );
}

function CalculationRow({ label, value, positive = false, negative = false, strong = false }: { label: string; value: number; positive?: boolean; negative?: boolean; strong?: boolean }) {
  const prefix = positive ? '+ ' : negative ? '- ' : '';
  return (
    <div className={`calculation-row ${strong ? 'calculation-row-strong' : ''}`}>
      <span>{label}</span>
      <strong>{prefix}{money.format(value)}</strong>
    </div>
  );
}

function SummaryMetric({ label, value, negative = false }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="summary-card">
      <div className="text-[11px] font-bold leading-4 text-[var(--muted)]">{label}</div>
      <div className={`mt-2 text-[15px] font-black tracking-tight sm:text-base ${negative ? 'text-[var(--danger)]' : 'text-[var(--ink)]'}`}>{value}</div>
    </div>
  );
}

function MovementRow({ movement, onEdit, canEdit = true }: { movement: Movement; onEdit: () => void; canEdit?: boolean }) {
  const isSale = movement.kind === 'sale';
  const auditParts: string[] = [];
  if (movement.createdByEmail) auditParts.push(`Cargado por ${movement.createdByEmail}`);
  if (movement.updatedByEmail && movement.updatedByEmail !== movement.createdByEmail) auditParts.push(`editado por ${movement.updatedByEmail}`);
  return (
    <button type="button" onClick={onEdit} disabled={!canEdit} className="movement-row group w-full text-left disabled:cursor-default">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${isSale ? 'bg-[var(--mint-soft)] text-[var(--brand)]' : 'bg-[var(--surface-soft)] text-[var(--muted)]'}`}>
        {isSale ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-extrabold text-[var(--ink)]">{movement.title}</div>
        <div className="mt-0.5 truncate text-xs text-[var(--muted)]">{movement.kind === 'expense' && movement.subtitle ? `${movement.subtitle} · ` : ''}{formatShortDate(movement.date)}{auditParts.length ? ` · ${auditParts.join(' · ')}` : ''}</div>
      </div>
      <div className="text-right">
        <div className={`text-sm font-black ${isSale ? 'text-[var(--brand)]' : 'text-[var(--ink)]'}`}>{isSale ? '+' : '-'} {money.format(movement.amount)}</div>
        {canEdit && <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] font-bold text-[var(--muted)]"><Pencil size={11} /> Editar</div>}
      </div>
      {canEdit && <ChevronRight size={16} className="shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5" />}
    </button>
  );
}

function MoneyInput({ value, onChange, autoFocus = false, compact = false, allowNegative = false }: { value: string; onChange: (value: string) => void; autoFocus?: boolean; compact?: boolean; allowNegative?: boolean }) {
  return (
    <div className={`money-input ${compact ? 'money-input-compact' : ''}`}>
      <span>$</span>
      <input
        autoFocus={autoFocus}
        inputMode={allowNegative ? 'text' : 'numeric'}
        value={formatMoneyInput(value, allowNegative)}
        onChange={(event) => {
          const raw = event.target.value;
          const digits = raw.replace(/[^0-9]/g, '');
          const negative = allowNegative && raw.trimStart().startsWith('-');
          onChange(`${negative ? '-' : ''}${digits}`);
        }}
        placeholder="0"
      />
    </div>
  );
}

function Modal({ children, onClose, wide = false, sheetClassName = '' }: { children: React.ReactNode; onClose: () => void; wide?: boolean; sheetClassName?: string }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`modal-sheet ${wide ? 'modal-sheet-wide' : ''} ${sheetClassName}`.trim()}>{children}</div>
    </div>
  );
}
