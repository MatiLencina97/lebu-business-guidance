-- Lebu 1.21.6 — historial/vigencia de gastos recurrentes.
-- Conserva las configuraciones anteriores dentro de la misma serie recurrente para que
-- un aumento o cambio de frecuencia no reescriba análisis de períodos previos.

alter table public.business_recurring_costs
  add column if not exists config_history jsonb not null default '[]'::jsonb;

comment on column public.business_recurring_costs.config_history is
  'Timeline de configuraciones históricas del recurrente. Cada entrada contiene effectiveFrom, amount, frequency y paymentSchedule.';

alter table public.business_recurring_costs
  drop constraint if exists business_recurring_costs_config_history_is_array;

alter table public.business_recurring_costs
  add constraint business_recurring_costs_config_history_is_array
  check (jsonb_typeof(config_history) = 'array');
