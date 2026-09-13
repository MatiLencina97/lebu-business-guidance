-- Lebu 1.21.1 — caja disponible y calendario de vencimientos.
-- Cambios aditivos: no modifica ni borra información existente.

alter table public.business_settings
  add column if not exists available_cash numeric not null default 0,
  add column if not exists cash_updated_at timestamptz;

alter table public.business_recurring_costs
  add column if not exists payment_schedule jsonb;

comment on column public.business_settings.available_cash is
  'Saldo de caja informado manualmente para proyectar vencimientos. No modifica la ganancia contable.';
comment on column public.business_settings.cash_updated_at is
  'Momento en que el usuario confirmó el saldo de caja disponible.';
comment on column public.business_recurring_costs.payment_schedule is
  'Regla opcional de pago: {type: weekday, weekday: 0..6} o {type: month_days, days: [1..31]}.';
