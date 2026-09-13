-- Lebu 1.21.2 — historial liviano de ajustes de conciliación de caja.
-- No son ventas, gastos ni comisiones: documentan la diferencia entre la estimación
-- de Lebu y el saldo real confirmado por dueño/admin.

alter table public.business_settings
  add column if not exists cash_adjustments jsonb not null default '[]'::jsonb;

alter table public.business_settings
  drop constraint if exists business_settings_cash_adjustments_array,
  add constraint business_settings_cash_adjustments_array check (jsonb_typeof(cash_adjustments) = 'array');

comment on column public.business_settings.cash_adjustments is
  'Últimos ajustes de conciliación de caja. Cada ajuste registra diferencia firmada, estimación previa y saldo real confirmado; no clasifica automáticamente la causa.';
