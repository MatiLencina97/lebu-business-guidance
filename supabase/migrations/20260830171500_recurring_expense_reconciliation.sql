-- Lebu 1.21.7 — conciliación entre gastos reales/importados y recurrentes.
-- Un gasto vinculado reemplaza la ocurrencia prevista; no se contabiliza por duplicado.

alter table public.business_expenses
  add column if not exists recurring_cost_id bigint,
  add column if not exists recurring_occurrence_date date,
  add column if not exists reconciliation_source text;

alter table public.business_expenses
  drop constraint if exists business_expenses_reconciliation_source_check;

alter table public.business_expenses
  add constraint business_expenses_reconciliation_source_check
  check (reconciliation_source is null or reconciliation_source in ('import', 'manual', 'fudo'));

create index if not exists business_expenses_recurring_occurrence_idx
  on public.business_expenses (business_id, recurring_cost_id, recurring_occurrence_date)
  where deleted_at is null and recurring_cost_id is not null;

comment on column public.business_expenses.recurring_cost_id is
  'Gasto recurrente de Lebu al que este gasto real concilia, si corresponde.';
comment on column public.business_expenses.recurring_occurrence_date is
  'Fecha canónica de la ocurrencia recurrente reemplazada por este gasto real.';
comment on column public.business_expenses.reconciliation_source is
  'Origen del vínculo de conciliación: import, manual o fudo.';
