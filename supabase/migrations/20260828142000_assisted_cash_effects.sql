-- Lebu 1.21.2 — Caja asistida
-- Guarda únicamente impactos netos de caja conocidos. NULL significa "Lebu no sabe el neto".

alter table public.business_sales
  add column if not exists cash_effect_amount numeric null,
  add column if not exists cash_effect_at timestamptz null;

alter table public.business_expenses
  add column if not exists cash_effect_amount numeric null,
  add column if not exists cash_effect_at timestamptz null;

comment on column public.business_sales.cash_effect_amount is
  'Impacto neto conocido sobre caja. NULL cuando una venta no tiene acreditación neta confirmada.';
comment on column public.business_sales.cash_effect_at is
  'Momento efectivo del impacto neto conocido sobre caja.';
comment on column public.business_expenses.cash_effect_amount is
  'Impacto neto conocido sobre caja. Los egresos se guardan con signo negativo.';
comment on column public.business_expenses.cash_effect_at is
  'Momento efectivo del impacto neto conocido sobre caja.';
